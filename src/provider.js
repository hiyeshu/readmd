/**
 * [INPUT]: chrome.storage.local 读取配置，background.js 的 fetch / 火山代理消息
 * [OUTPUT]: ReadmdProvider — provider 工厂、错误标准化、translate/translateBatch 能力
 * [POS]: 翻译管线的网络层与错误模型中心，被 translator.js 和 content.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 常量 ──

const ERROR_CODES = Object.freeze({
  ABORTED: 'ABORTED',
  NO_TEXT: 'NO_TEXT',
  AUTH: 'AUTH',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  NETWORK: 'NETWORK',
  UNKNOWN: 'UNKNOWN'
});

const LLM_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/';
const LLM_DEFAULT_MODEL = 'glm-4-flash';
const LLM_MAX_RETRIES = 3;
const LLM_TEMPERATURE = 0.2;
const LLM_SYSTEM_PROMPT = '你是 Markdown 翻译器。把输入翻成简体中文。只返回译文，不要解释，不要加引号，不要补充说明。保留类似 {{MD0}} 的占位符不变。';
const LLM_BATCH_SYSTEM_PROMPT = '你是 Markdown 翻译器。用户会给你一个 JSON 对象，里面有 texts 数组。把每个元素翻成简体中文，按原顺序返回 JSON 对象 {"translations":["...", "..."]}。translations 长度必须和输入完全一致。不要输出解释，不要输出 Markdown 代码块，不要输出额外字段。保留类似 {{MD0}} 的占位符不变。';
const LLM_BATCH_MAX_ITEMS = 12;
const LLM_BATCH_MAX_TOTAL_CHARS = 6000;
const VOLCENGINE_MAX_ITEMS = 16;
const VOLCENGINE_MAX_TOTAL_LENGTH = 5000;

// ── 工具函数 ──

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const trim = (value) => (typeof value === 'string' ? value.trim() : '');

function createError(code, message, extra = {}) {
  const error = new Error(message || '翻译失败');
  error.code = ERROR_CODES[code] || ERROR_CODES.UNKNOWN;
  error.readmd = true;
  Object.assign(error, extra);
  return error;
}

function isAbortError(error) {
  return !!error && (error.code === ERROR_CODES.ABORTED || error.name === 'AbortError');
}

function httpError(label, status, detail = '') {
  if (status === 401 || status === 403) {
    return createError(ERROR_CODES.AUTH, `${label}鉴权失败`, { status, detail });
  }
  if (status === 408 || status === 504) {
    return createError(ERROR_CODES.TIMEOUT, `${label}请求超时`, { status, detail });
  }
  if (status === 429) {
    return createError(ERROR_CODES.RATE_LIMIT, `${label}限流，请稍后重试`, { status, detail });
  }
  if (status >= 500) {
    return createError(ERROR_CODES.NETWORK, `${label}服务暂时不可用`, { status, detail });
  }
  return createError(ERROR_CODES.NETWORK, `${label}请求失败：HTTP ${status}${detail ? ` ${detail}` : ''}`, { status, detail });
}

function normalizeError(error) {
  if (!error) {
    return createError(ERROR_CODES.UNKNOWN, '翻译失败');
  }
  if (error.readmd && error.code) {
    return error;
  }
  if (isAbortError(error)) {
    return createError(ERROR_CODES.ABORTED, '翻译已取消', { cause: error });
  }

  const message = trim(error.message || String(error));

  if (/NO_TRANSLATABLE_TEXT|NO_TEXT/i.test(message)) {
    return createError(ERROR_CODES.NO_TEXT, '没有可翻译的文本', { cause: error });
  }
  if (/api key|accesskey|secretkey|unauthorized|forbidden|鉴权|未配置|invalid api key|llm api key/i.test(message)) {
    return createError(ERROR_CODES.AUTH, message || '鉴权失败', { cause: error });
  }
  if (/429|rate limit|too many requests|限流|服务繁忙/i.test(message)) {
    return createError(ERROR_CODES.RATE_LIMIT, message || '服务繁忙，请稍后重试', { cause: error });
  }
  if (/timeout|timed out|超时/i.test(message)) {
    return createError(ERROR_CODES.TIMEOUT, message || '翻译超时', { cause: error });
  }
  if (/failed to fetch|network|econn|enotfound|http 5\d{2}|http 0|网络|暂时不可用/i.test(message)) {
    return createError(ERROR_CODES.NETWORK, message || '网络连接失败', { cause: error });
  }
  return createError(ERROR_CODES.UNKNOWN, message || '翻译失败', { cause: error });
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeBaseUrl(value, fallback) {
  const normalized = trim(value) || fallback;
  return normalized.replace(/\/+$/, '');
}

function buildChatUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl, LLM_DEFAULT_BASE_URL);
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

function chunkBatchTexts(texts) {
  const chunks = [];
  let current = [];
  let length = 0;

  for (const text of texts) {
    const itemLength = text.length;
    if (
      current.length > 0 &&
      (current.length >= LLM_BATCH_MAX_ITEMS || length + itemLength > LLM_BATCH_MAX_TOTAL_CHARS)
    ) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(text);
    length += itemLength;
  }

  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

function extractText(result) {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return trim(content);
  }
  if (Array.isArray(content)) {
    return trim(content.map((part) => trim(part?.text || part?.content)).filter(Boolean).join(''));
  }
  return '';
}

function shouldRetry(error) {
  const normalized = normalizeError(error);
  return [ERROR_CODES.RATE_LIMIT, ERROR_CODES.TIMEOUT, ERROR_CODES.NETWORK].includes(normalized.code);
}

function bgFetch(url, options) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'fetch', url, options }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(createError(ERROR_CODES.NETWORK, chrome.runtime.lastError.message));
      }
      if (response?.error) {
        return reject(normalizeError(new Error(response.error)));
      }
      resolve({
        ok: response?.ok,
        status: response?.status,
        text: () => Promise.resolve(response?.text || '')
      });
    });
  });
}

// ── FreeProvider：Google Web + MyMemory 降级链 ──

class FreeProvider {
  async translate(text) {
    const services = [() => this._google(text), () => this._myMemory(text)];
    let lastError = null;

    for (const request of services) {
      try {
        const translated = await request();
        if (translated && translated.trim() && translated.trim() !== text.trim()) {
          return translated;
        }
      } catch (error) {
        lastError = normalizeError(error);
      }
    }

    throw lastError || createError(ERROR_CODES.NETWORK, '免费翻译暂时不可用');
  }

  async translateBatch(texts) {
    const results = [];
    for (const text of texts) {
      results.push(await this.translate(text));
    }
    return results;
  }

  async _google(text) {
    const query = new URLSearchParams();
    query.append('client', 'gtx');
    query.append('sl', 'auto');
    query.append('tl', 'zh-CN');
    query.append('hl', 'zh-CN');
    query.append('ie', 'UTF-8');
    query.append('oe', 'UTF-8');
    query.append('otf', '1');
    query.append('ssel', '0');
    query.append('tsel', '0');
    query.append('kc', '7');
    query.append('q', text);
    ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'].forEach((key) => query.append('dt', key));

    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
    });
    if (!response.ok) {
      throw httpError('Google 翻译', response.status);
    }

    const data = await response.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map((item) => (typeof item?.[0] === 'string' ? item[0] : '')).join('')
      : '';
    if (!translated.trim()) {
      throw createError(ERROR_CODES.UNKNOWN, 'Google 返回为空');
    }
    return decodeHtmlEntities(translated);
  }

  async _myMemory(text) {
    const query = new URLSearchParams({ q: text, langpair: 'en|zh-CN' });
    const response = await fetch(`https://api.mymemory.translated.net/get?${query}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      throw httpError('MyMemory', response.status);
    }

    const data = await response.json();
    const translated = trim(data?.responseData?.translatedText);
    if (!translated || translated === text || translated === text.toUpperCase()) {
      throw createError(ERROR_CODES.UNKNOWN, 'MyMemory 返回为空');
    }
    return decodeHtmlEntities(translated);
  }
}

// ── VolcengineProvider：火山引擎机器翻译 ──

class VolcengineProvider {
  constructor(config) {
    this.config = config;
  }

  async translate(text) {
    const results = await this._request([text]);
    return results[0];
  }

  async translateBatch(texts) {
    if (!texts.length) {
      return [];
    }
    const chunks = this._chunk(texts);
    const results = [];
    for (const chunk of chunks) {
      results.push(...await this._request(chunk));
    }
    return results;
  }

  async _request(textList) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'volcengine-translate',
          texts: textList,
          config: this.config
        },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(createError(ERROR_CODES.NETWORK, chrome.runtime.lastError.message));
          }
          if (response?.error) {
            return reject(normalizeError(new Error(response.error)));
          }
          resolve(response?.translations || []);
        }
      );
    });
  }

  _chunk(texts) {
    const chunks = [];
    let current = [];
    let length = 0;

    for (const text of texts) {
      if (text.length > VOLCENGINE_MAX_TOTAL_LENGTH) {
        throw createError(ERROR_CODES.UNKNOWN, `火山引擎单段文本超过 ${VOLCENGINE_MAX_TOTAL_LENGTH} 字符限制`);
      }
      if (
        current.length > 0 &&
        (current.length >= VOLCENGINE_MAX_ITEMS || length + text.length > VOLCENGINE_MAX_TOTAL_LENGTH)
      ) {
        chunks.push(current);
        current = [];
        length = 0;
      }
      current.push(text);
      length += text.length;
    }

    if (current.length) {
      chunks.push(current);
    }
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
    if (!this.apiKey) {
      throw createError(ERROR_CODES.AUTH, 'LLM API Key 还没配置');
    }

    let lastError = null;
    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        return await this._request(text);
      } catch (error) {
        lastError = normalizeError(error);
        if (!shouldRetry(lastError) || attempt === LLM_MAX_RETRIES) {
          break;
        }
        await sleep(400 * Math.pow(2, attempt - 1));
      }
    }
    throw lastError || createError(ERROR_CODES.UNKNOWN, 'LLM 请求失败');
  }

  async translateBatch(texts) {
    if (!texts.length) {
      return [];
    }
    if (!this.apiKey) {
      throw createError(ERROR_CODES.AUTH, 'LLM API Key 还没配置');
    }

    const chunks = chunkBatchTexts(texts);
    const results = [];

    for (const chunk of chunks) {
      let lastError = null;
      for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
        try {
          results.push(...await this._batchRequest(chunk));
          lastError = null;
          break;
        } catch (error) {
          lastError = normalizeError(error);
          if (!shouldRetry(lastError) || attempt === LLM_MAX_RETRIES) {
            break;
          }
          await sleep(400 * Math.pow(2, attempt - 1));
        }
      }
      if (lastError) {
        throw lastError;
      }
    }

    return results;
  }

  async _request(text) {
    const response = await bgFetch(buildChatUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: LLM_SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: LLM_TEMPERATURE,
        stream: false
      })
    });

    const raw = await response.text();
    const parsed = JSON.parse(raw || '{}');
    const detail = trim(parsed.error?.message);
    if (!response.ok) {
      throw httpError('LLM', response.status, detail);
    }

    const translated = extractText(parsed);
    if (!translated) {
      throw createError(ERROR_CODES.UNKNOWN, 'LLM 返回为空');
    }
    return translated;
  }

  async _batchRequest(texts) {
    const response = await bgFetch(buildChatUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: LLM_BATCH_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ texts }) }
        ],
        temperature: LLM_TEMPERATURE,
        stream: false,
        response_format: { type: 'json_object' }
      })
    });

    const raw = await response.text();
    const parsed = JSON.parse(raw || '{}');
    const detail = trim(parsed.error?.message);
    if (!response.ok) {
      throw httpError('LLM', response.status, detail);
    }

    const content = extractText(parsed);
    if (!content) {
      throw createError(ERROR_CODES.UNKNOWN, 'LLM 批量返回为空');
    }

    const result = JSON.parse(content);
    if (!Array.isArray(result.translations)) {
      throw createError(ERROR_CODES.UNKNOWN, 'LLM 批量返回缺少 translations 数组');
    }
    if (result.translations.length !== texts.length) {
      throw createError(ERROR_CODES.UNKNOWN, `LLM 批量返回数量不对：期望 ${texts.length}，实际 ${result.translations.length}`);
    }

    return result.translations.map((item, index) => {
      const translated = typeof item === 'string' ? item.trim() : '';
      if (!translated) {
        throw createError(ERROR_CODES.UNKNOWN, `LLM 批量第 ${index + 1} 条返回为空`);
      }
      return translated;
    });
  }
}

// ── 配置加载 + 工厂 ──

async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        'provider',
        'llmApiKey',
        'llmBaseUrl',
        'llmModel',
        'volcengineAccessKeyId',
        'volcengineSecretKey',
        'volcengineRegion'
      ],
      (result) => {
        resolve({
          provider: result.provider || 'free',
          apiKey: result.llmApiKey || '',
          baseUrl: result.llmBaseUrl || LLM_DEFAULT_BASE_URL,
          model: result.llmModel || LLM_DEFAULT_MODEL,
          volcengine: {
            accessKeyId: result.volcengineAccessKeyId || '',
            secretKey: result.volcengineSecretKey || '',
            region: result.volcengineRegion || 'cn-north-1'
          }
        });
      }
    );
  });
}

async function createProvider() {
  const config = await loadConfig();
  if (config.provider === 'volcengine' && config.volcengine.accessKeyId && config.volcengine.secretKey) {
    return new VolcengineProvider(config.volcengine);
  }
  if (config.provider === 'llm' && config.apiKey) {
    return new LlmProvider(config);
  }
  return new FreeProvider();
}

window.ReadmdProvider = {
  ERROR_CODES,
  FreeProvider,
  VolcengineProvider,
  LlmProvider,
  createError,
  normalizeError,
  isAbortError,
  createProvider,
  loadConfig
};
