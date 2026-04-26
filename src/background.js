/**
 * [INPUT]: chrome.runtime 消息
 * [OUTPUT]: 配置代理、LLM fetch 代理、火山翻译代理、Options 页打开
 * [POS]: MV3 Service Worker，消息路由 + 网络代理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 火山翻译常量 ──

const VOLCENGINE_ENDPOINT = 'https://translate.volcengineapi.com/';
const VOLCENGINE_HOST = 'translate.volcengineapi.com';
const VOLCENGINE_QUERY = 'Action=TranslateText&Version=2020-06-01';
const VOLCENGINE_SERVICE = 'translate';
const VOLCENGINE_MAX_ITEMS = 16;
const VOLCENGINE_MAX_TOTAL_LENGTH = 5000;
const VOLCENGINE_MAX_RETRIES = 3;

// ── 快捷键命令 ──

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-translate') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle-translate' });
    });
  }
});

// ── 消息路由 ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'fetch') {
    doFetch(msg.url, msg.options).then(sendResponse);
    return true;
  }
  if (msg.type === 'volcengine-translate') {
    handleVolcengineTranslate(msg.texts, msg.config).then(sendResponse);
    return true;
  }
  return false;
});

// ── LLM fetch 代理 ──

async function doFetch(url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.message };
  }
}

// ── 火山翻译代理 ──

async function handleVolcengineTranslate(texts, config) {
  try {
    const { accessKeyId, secretKey, region = 'cn-north-1' } = config;
    if (!accessKeyId || !secretKey) throw new Error('火山引擎 AccessKeyId / SecretKey 未配置');
    const chunks = chunkVolcengineTexts(texts);
    const translations = [];
    for (const chunk of chunks) {
      const result = await volcengineRequest(chunk, accessKeyId, secretKey, region);
      translations.push(...result);
    }
    if (translations.length !== texts.length) {
      throw new Error(`火山引擎返回数量不对：期望 ${texts.length}，实际 ${translations.length}`);
    }
    return { translations };
  } catch (e) {
    return { error: e.message };
  }
}

function chunkVolcengineTexts(texts) {
  const chunks = [];
  let cur = [], len = 0;
  for (const t of texts) {
    if (t.length > VOLCENGINE_MAX_TOTAL_LENGTH) {
      throw new Error(`火山引擎单段文本超过 ${VOLCENGINE_MAX_TOTAL_LENGTH} 字符限制`);
    }
    if (cur.length > 0 && (cur.length >= VOLCENGINE_MAX_ITEMS || len + t.length > VOLCENGINE_MAX_TOTAL_LENGTH)) {
      chunks.push(cur);
      cur = []; len = 0;
    }
    cur.push(t); len += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function volcengineRequest(texts, accessKeyId, secretKey, region) {
  let lastError = null;
  for (let attempt = 1; attempt <= VOLCENGINE_MAX_RETRIES; attempt++) {
    try {
      return await volcengineDoRequest(texts, accessKeyId, secretKey, region);
    } catch (e) {
      lastError = e;
      if (!/火山引擎限流|火山引擎内部错误|HTTP 429|HTTP 5\d{2}/.test(e.message) || attempt === VOLCENGINE_MAX_RETRIES) break;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError || new Error('火山引擎请求失败');
}

async function volcengineDoRequest(texts, accessKeyId, secretKey, region) {
  const body = JSON.stringify({ TargetLanguage: 'zh', TextList: texts });
  const payloadHash = await sha256Hex(body);
  const headers = await volcengineSign(accessKeyId, secretKey, region, 'POST', '/', VOLCENGINE_QUERY, payloadHash);
  headers['Content-Type'] = 'application/json; charset=utf-8';

  const res = await fetch(`${VOLCENGINE_ENDPOINT}?${VOLCENGINE_QUERY}`, { method: 'POST', headers, body });
  const raw = await res.text();
  const parsed = JSON.parse(raw || '{}');

  const metadataError = parsed?.ResponseMetadata?.Error;
  if (metadataError?.Code) {
    throw volcengineApiError(metadataError, parsed?.ResponseMetadata?.RequestId);
  }
  if (!res.ok) {
    throw new Error(`火山引擎失败：HTTP ${res.status}${raw ? ` ${raw}` : ''}`);
  }

  const translationList = Array.isArray(parsed?.TranslationList) ? parsed.TranslationList : [];
  if (translationList.length !== texts.length) {
    throw new Error(`火山引擎返回数量不对：期望 ${texts.length}，实际 ${translationList.length}`);
  }
  return translationList.map((item, i) => {
    const t = (item?.Translation || '').trim();
    if (!t) throw new Error(`火山引擎第 ${i + 1} 条返回为空`);
    return t;
  });
}

function volcengineApiError(error, requestId) {
  const code = String(error?.Code || '');
  const message = error?.Message || '';
  const suffix = requestId ? `，RequestId: ${requestId}` : '';
  if (code === '-400') return new Error(`火山引擎参数错误：${message || '请检查请求内容'}${suffix}`);
  if (code === '-415') return new Error(`火山引擎不支持这个语向：${message || '请检查语言配置'}${suffix}`);
  if (code === '-429') return new Error(`火山引擎限流：${message || '请求过于频繁'}${suffix}`);
  if (code === '-500' || code.startsWith('-5')) return new Error(`火山引擎内部错误：${message || '请稍后重试'}${suffix}`);
  return new Error(`火山引擎错误 ${code || 'unknown'}：${message || '未知错误'}${suffix}`);
}

// ── 火山签名（HMAC-SHA256，Web Crypto API）──

async function volcengineSign(accessKeyId, secretKey, region, method, uri, query, payloadHash) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const xDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const host = VOLCENGINE_HOST;
  const canonicalHeaders = `host:${host}\nx-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const signedHeaders = 'host;x-content-sha256;x-date';
  const canonicalRequest = [method, uri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${date}/${region}/${VOLCENGINE_SERVICE}/request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const signingKey = await hmacChain(secretKey, [date, region, VOLCENGINE_SERVICE, 'request']);
  const signature = await hmacHex(signingKey, stringToSign);

  return {
    'Host': host,
    'X-Date': xDate,
    'X-Content-Sha256': payloadHash,
    'Authorization': `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

async function hmacChain(key, parts) {
  let k = new TextEncoder().encode(key);
  for (const part of parts) {
    k = await hmacRaw(k, part);
  }
  return k;
}

async function hmacRaw(keyBytes, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function hmacHex(keyBytes, data) {
  const raw = await hmacRaw(keyBytes, data);
  return Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
