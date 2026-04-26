/**
 * [INPUT]: chrome.storage.local 读取配置
 * [OUTPUT]: FreeProvider, LlmProvider — 两种翻译 provider
 * [POS]: 翻译管线的网络层，被 translator.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 常量 ──

const LLM_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/';
const LLM_DEFAULT_MODEL = 'glm-4-flash';
const LLM_MAX_RETRIES = 3;
const LLM_TEMPERATURE = 0.2;
const LLM_SYSTEM_PROMPT = '你是 Markdown 翻译器。把输入翻成简体中文。只返回译文，不要解释，不要加引号，不要补充说明。保留类似 {{MD0}} 的占位符不变。';
const LLM_BATCH_SYSTEM_PROMPT = '你是 Markdown 翻译器。用户会给你一个 JSON 对象，里面有 texts 数组。把每个元素翻成简体中文，按原顺序返回 JSON 对象 {"translations":["...", "..."]}。translations 长度必须和输入完全一致。不要输出解释，不要输出 Markdown 代码块，不要输出额外字段。保留类似 {{MD0}} 的占位符不变。';
const LLM_BATCH_MAX_ITEMS = 12;
const LLM_BATCH_MAX_TOTAL_CHARS = 6000;

// ── 工具函数 ──

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const trim = (v) => (typeof v === 'string' ? v.trim() : '');

function decodeHtmlEntities(text) {
  return text
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function normalizeBaseUrl(value, fallback) {
  const n = trim(value) || fallback;
  return n.replace(/\/+$/, '');
}

function buildChatUrl(baseUrl) {
  const n = normalizeBaseUrl(baseUrl, LLM_DEFAULT_BASE_URL);
  return /\/chat\/completions$/i.test(n) ? n : `${n}/chat/completions`;
}

function chunkBatchTexts(texts) {
  const chunks = [];
  let cur = [], len = 0;
  for (const t of texts) {
    if (cur.length > 0 && (cur.length >= LLM_BATCH_MAX_ITEMS || len + t.length > LLM_BATCH_MAX_TOTAL_CHARS)) {
      chunks.push(cur);
      cur = []; len = 0;
    }
    cur.push(t); len += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function extractText(result) {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === 'string') return trim(content);
  if (Array.isArray(content)) return trim(content.map(p => trim(p?.text || p?.content)).filter(Boolean).join(''));
  return '';
}

function shouldRetry(err) {
  return /429|5\d{2}|timeout|timed out|ECONNRESET|ENOTFOUND|Failed to fetch/i.test(err.message);
}

// ── Background fetch 代理（LLM 用，绕过 host_permissions 限制）──

function bgFetch(url, options) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'fetch', url, options }, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (r.error) return reject(new Error(r.error));
      resolve({ ok: r.ok, status: r.status, text: () => Promise.resolve(r.text) });
    });
  });
}

// ── FreeProvider：Google Web + MyMemory 降级链 ──

class FreeProvider {
  async translate(text) {
    const services = [() => this._google(text), () => this._myMemory(text)];
    let last = null;
    for (const fn of services) {
      try {
        const r = await fn();
        if (r && r.trim() && r.trim() !== text.trim()) return r;
      } catch (e) { last = e; }
    }
    throw new Error(`免费翻译暂时不可用：${last?.message || '所有服务失败'}`);
  }

  async translateBatch(texts) {
    const results = [];
    for (const t of texts) results.push(await this.translate(t));
    return results;
  }

  async _google(text) {
    const q = new URLSearchParams();
    q.append('client', 'gtx'); q.append('sl', 'auto'); q.append('tl', 'zh-CN'); q.append('hl', 'zh-CN');
    q.append('ie', 'UTF-8'); q.append('oe', 'UTF-8');
    q.append('otf', '1'); q.append('ssel', '0'); q.append('tsel', '0'); q.append('kc', '7');
    q.append('q', text);
    ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'].forEach(k => q.append('dt', k));
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?${q}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
    });
    if (!res.ok) throw new Error(`Google 翻译失败：HTTP ${res.status}`);
    const data = await res.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map(item => (typeof item?.[0] === 'string' ? item[0] : '')).join('')
      : '';
    if (!translated.trim()) throw new Error('Google 返回为空');
    return decodeHtmlEntities(translated);
  }

  async _myMemory(text) {
    const q = new URLSearchParams({ q: text, langpair: 'en|zh-CN' });
    const res = await fetch(`https://api.mymemory.translated.net/get?${q}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`MyMemory 失败：HTTP ${res.status}`);
    const data = await res.json();
    const translated = trim(data?.responseData?.translatedText);
    if (!translated || translated === text || translated === text.toUpperCase()) throw new Error('MyMemory 返回为空');
    return decodeHtmlEntities(translated);
  }
}

// ── VolcengineProvider：火山引擎机器翻译 ──

const VOLCENGINE_MAX_ITEMS = 16;
const VOLCENGINE_MAX_TOTAL_LENGTH = 5000;

class VolcengineProvider {
  constructor(config) {
    this.config = config; // { accessKeyId, secretKey, region }
  }

  async translate(text) {
    const results = await this._request([text]);
    return results[0];
  }

  async translateBatch(texts) {
    if (!texts.length) return [];
    const chunks = this._chunk(texts);
    const results = [];
    for (const chunk of chunks) {
      results.push(...await this._request(chunk));
    }
    return results;
  }

  async _request(textList) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'volcengine-translate',
        texts: textList,
        config: this.config
      }, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (r.error) return reject(new Error(r.error));
        resolve(r.translations);
      });
    });
  }

  _chunk(texts) {
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
}

// ── LlmProvider：OpenAI 兼容 API ──

class LlmProvider {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || LLM_DEFAULT_BASE_URL;
    this.model = config.model || LLM_DEFAULT_MODEL;
  }

  async translate(text) {
    if (!this.apiKey) throw new Error('LLM API Key 还没配置');
    let last = null;
    for (let i = 1; i <= LLM_MAX_RETRIES; i++) {
      try { return await this._request(text); }
      catch (e) {
        last = e;
        if (!shouldRetry(e) || i === LLM_MAX_RETRIES) break;
        await sleep(400 * Math.pow(2, i - 1));
      }
    }
    throw last || new Error('LLM 请求失败');
  }

  async translateBatch(texts) {
    if (!texts.length) return [];
    if (!this.apiKey) throw new Error('LLM API Key 还没配置');
    const chunks = chunkBatchTexts(texts);
    const results = [];
    for (const chunk of chunks) {
      let last = null;
      for (let i = 1; i <= LLM_MAX_RETRIES; i++) {
        try {
          results.push(...await this._batchRequest(chunk));
          last = null; break;
        } catch (e) {
          last = e;
          if (!shouldRetry(e) || i === LLM_MAX_RETRIES) break;
          await sleep(400 * Math.pow(2, i - 1));
        }
      }
      if (last) throw last;
    }
    return results;
  }

  async _request(text) {
    const res = await bgFetch(buildChatUrl(this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: LLM_SYSTEM_PROMPT }, { role: 'user', content: text }],
        temperature: LLM_TEMPERATURE, stream: false
      })
    });
    const raw = await res.text();
    const parsed = JSON.parse(raw || '{}');
    const errMsg = trim(parsed.error?.message);
    if (!res.ok) throw new Error(`LLM 请求失败：HTTP ${res.status}${errMsg ? ` ${errMsg}` : ''}`);
    const translated = extractText(parsed);
    if (!translated) throw new Error('LLM 返回为空');
    return translated;
  }

  async _batchRequest(texts) {
    const res = await bgFetch(buildChatUrl(this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: LLM_BATCH_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ texts }) }],
        temperature: LLM_TEMPERATURE, stream: false,
        response_format: { type: 'json_object' }
      })
    });
    const raw = await res.text();
    const parsed = JSON.parse(raw || '{}');
    const errMsg = trim(parsed.error?.message);
    if (!res.ok) throw new Error(`LLM 批量请求失败：HTTP ${res.status}${errMsg ? ` ${errMsg}` : ''}`);
    const content = extractText(parsed);
    if (!content) throw new Error('LLM 批量返回为空');
    const result = JSON.parse(content);
    if (!Array.isArray(result.translations)) throw new Error('LLM 批量返回缺少 translations 数组');
    if (result.translations.length !== texts.length) {
      throw new Error(`LLM 批量返回数量不对：期望 ${texts.length}，实际 ${result.translations.length}`);
    }
    return result.translations.map((item, i) => {
      const t = typeof item === 'string' ? item.trim() : '';
      if (!t) throw new Error(`LLM 批量第 ${i + 1} 条返回为空`);
      return t;
    });
  }
}

// ── 配置加载 + 工厂 ──

async function loadConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'provider', 'llmApiKey', 'llmBaseUrl', 'llmModel',
      'volcengineAccessKeyId', 'volcengineSecretKey', 'volcengineRegion'
    ], (r) => {
      resolve({
        provider: r.provider || 'free',
        apiKey: r.llmApiKey || '',
        baseUrl: r.llmBaseUrl || LLM_DEFAULT_BASE_URL,
        model: r.llmModel || LLM_DEFAULT_MODEL,
        volcengine: {
          accessKeyId: r.volcengineAccessKeyId || '',
          secretKey: r.volcengineSecretKey || '',
          region: r.volcengineRegion || 'cn-north-1'
        }
      });
    });
  });
}

async function createProvider() {
  const cfg = await loadConfig();
  if (cfg.provider === 'volcengine' && cfg.volcengine.accessKeyId && cfg.volcengine.secretKey) {
    return new VolcengineProvider(cfg.volcengine);
  }
  if (cfg.provider === 'llm' && cfg.apiKey) {
    return new LlmProvider(cfg);
  }
  return new FreeProvider();
}

window.ReadmdProvider = { FreeProvider, VolcengineProvider, LlmProvider, createProvider, loadConfig };
