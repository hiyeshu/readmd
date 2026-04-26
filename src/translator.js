/**
 * [INPUT]: ReadmdMarkdown, ReadmdProvider, ReadmdCache
 * [OUTPUT]: translateMarkdown(url, onBatch) — 翻译调度入口
 * [POS]: 翻译管线的调度层，被 content.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const BATCH_SIZE = 8;
const FETCH_TIMEOUT = 15000;

// ── 从 GitHub URL 解析 raw 地址 ──

function toRawUrl(pageUrl) {
  const m = pageUrl.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
  if (!m) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
}

// ── 带超时的 fetch ──

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

// ── 主调度 ──

async function translateMarkdown(pageUrl, onBatch) {
  const rawUrl = toRawUrl(pageUrl);
  if (!rawUrl) throw new Error('无法解析 GitHub 文件路径');

  const { loadConfig, createProvider } = window.ReadmdProvider;
  const { extractTextNodes, reconstructMarkdown } = window.ReadmdMarkdown;
  const cache = window.ReadmdCache;
  const cfg = await loadConfig();
  const ns = `${cfg.provider}:${cfg.model || 'free'}`;

  // ── 文件级缓存 ──
  const fileCacheKey = cache.cacheKey(ns, '', rawUrl);
  const fileCached = await cache.get(fileCacheKey);
  if (fileCached) { onBatch(fileCached, true); return fileCached; }

  const rawMd = await fetchWithTimeout(rawUrl, FETCH_TIMEOUT);
  const nodes = extractTextNodes(rawMd);
  if (!nodes.length) throw new Error('NO_TRANSLATABLE_TEXT');

  const provider = await createProvider();
  const translated = [...nodes];

  // ── 文本级缓存去重 ──
  const uncached = [];
  for (const n of nodes) {
    const textKey = cache.cacheKey(ns, '', n.value);
    const hit = await cache.get(textKey);
    if (hit) { translated[n.index] = { ...n, value: hit }; }
    else { uncached.push(n); }
  }

  if (uncached.length && nodes.length !== uncached.length) {
    onBatch(reconstructMarkdown(rawMd, translated), false);
  }

  // ── 分批翻译，batch 失败降级逐条 ──
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const texts = batch.map(n => n.value);
    let results;
    try {
      results = await provider.translateBatch(texts);
    } catch {
      results = [];
      for (const t of texts) {
        try { results.push(await provider.translate(t)); }
        catch { results.push(t); }
      }
    }
    batch.forEach((n, j) => {
      translated[n.index] = { ...n, value: results[j] };
      const textKey = cache.cacheKey(ns, '', n.value);
      cache.set(textKey, results[j]);
    });
    onBatch(reconstructMarkdown(rawMd, translated), false);
  }

  const final = reconstructMarkdown(rawMd, translated);
  await cache.set(fileCacheKey, final);
  onBatch(final, true);
  return final;
}

window.ReadmdTranslator = { translateMarkdown, toRawUrl };
