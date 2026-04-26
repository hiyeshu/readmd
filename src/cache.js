/**
 * [INPUT]: chrome.storage.local
 * [OUTPUT]: ReadmdCache — get/set/clear，LRU 淘汰
 * [POS]: 翻译管线的持久层，被 translator.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 缓存配置 ──

const CACHE_PREFIX = 'readmd:';
const INDEX_KEY = 'readmd:_index';
const MAX_BYTES = 8 * 1024 * 1024;
const RESERVED_BYTES = 2 * 1024 * 1024;
const USABLE_BYTES = MAX_BYTES - RESERVED_BYTES;

// ── 简易 hash（djb2）替代 md5，无需 SubtleCrypto 的异步开销 ──

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function cacheKey(provider, model, text) {
  return CACHE_PREFIX + hash(`${provider}:${model}:${text}`);
}

// ── 索引操作 ──

async function loadIndex() {
  return new Promise(resolve => {
    chrome.storage.local.get(INDEX_KEY, (r) => resolve(r[INDEX_KEY] || {}));
  });
}

async function saveIndex(index) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [INDEX_KEY]: index }, resolve);
  });
}

// ── 公开接口 ──

async function get(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, (r) => resolve(r[key] ?? null));
  });
}

async function set(key, value) {
  const data = JSON.stringify(value);
  const size = key.length + data.length;
  const index = await loadIndex();
  await evictIfNeeded(index, size);
  index[key] = { ts: Date.now(), size };
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value, [INDEX_KEY]: index }, resolve);
  });
}

async function evictIfNeeded(index, incoming) {
  let total = Object.values(index).reduce((s, e) => s + (e.size || 0), 0) + incoming;
  if (total <= USABLE_BYTES) return;
  const sorted = Object.entries(index).sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = [];
  for (const [k, entry] of sorted) {
    if (total <= USABLE_BYTES) break;
    toRemove.push(k);
    total -= entry.size || 0;
    delete index[k];
  }
  if (toRemove.length) {
    await new Promise(resolve => chrome.storage.local.remove(toRemove, resolve));
  }
}

async function clear() {
  const index = await loadIndex();
  const keys = [...Object.keys(index), INDEX_KEY];
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

window.ReadmdCache = { get, set, clear, cacheKey };
