/**
 * [INPUT]: chrome.storage.local
 * [OUTPUT]: ReadmdCache — UI/文本/文件缓存键构造与 LRU 持久化能力
 * [POS]: 翻译管线的持久层，被 translator.js 与 content.js 的偏好存储消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 缓存配置 ──

const CACHE_PREFIX = 'readmd:';
const INDEX_KEY = 'readmd:_index';
const MAX_BYTES = 8 * 1024 * 1024;
const RESERVED_BYTES = 2 * 1024 * 1024;
const USABLE_BYTES = MAX_BYTES - RESERVED_BYTES;

// ── 简易 hash（djb2）──

function hash(str) {
  let value = 5381;
  for (let index = 0; index < str.length; index++) {
    value = ((value << 5) + value + str.charCodeAt(index)) >>> 0;
  }
  return value.toString(36);
}

function makeNamespace(provider, model) {
  return `${provider || 'free'}:${model || 'default'}`;
}

function textCacheKey(namespace, text) {
  return `${CACHE_PREFIX}text:${hash(`${namespace}:${text}`)}`;
}

function fileCacheKey(namespace, rawMarkdown) {
  return `${CACHE_PREFIX}file:${hash(`${namespace}:${rawMarkdown}`)}`;
}

// ── 索引操作 ──

async function loadIndex() {
  return new Promise((resolve) => {
    chrome.storage.local.get(INDEX_KEY, (result) => resolve(result[INDEX_KEY] || {}));
  });
}

async function saveIndex(index) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [INDEX_KEY]: index }, resolve);
  });
}

// ── 公开接口 ──

async function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key] ?? null));
  });
}

async function set(key, value) {
  const data = JSON.stringify(value);
  const size = key.length + data.length;
  const index = await loadIndex();
  await evictIfNeeded(index, size);
  index[key] = { ts: Date.now(), size };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value, [INDEX_KEY]: index }, resolve);
  });
}

async function evictIfNeeded(index, incoming) {
  let total = Object.values(index).reduce((sum, entry) => sum + (entry.size || 0), 0) + incoming;
  if (total <= USABLE_BYTES) {
    return;
  }

  const entries = Object.entries(index).sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = [];

  for (const [key, entry] of entries) {
    if (total <= USABLE_BYTES) {
      break;
    }
    toRemove.push(key);
    total -= entry.size || 0;
    delete index[key];
  }

  if (toRemove.length) {
    await new Promise((resolve) => chrome.storage.local.remove(toRemove, resolve));
  }
}

async function clear() {
  const index = await loadIndex();
  const keys = [...Object.keys(index), INDEX_KEY];
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

window.ReadmdCache = {
  get,
  set,
  clear,
  hash,
  makeNamespace,
  textCacheKey,
  fileCacheKey,
  loadIndex,
  saveIndex
};
