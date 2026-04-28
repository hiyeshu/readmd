/**
 * [INPUT]: ReadmdMarkdown, ReadmdProvider, ReadmdCache
 * [OUTPUT]: translateMarkdown(pageContext, handlers, signal) — 可取消的翻译调度入口
 * [POS]: 翻译管线的调度层，被 content.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const BATCH_SIZE = 8;
const FETCH_TIMEOUT = 20000;

function resolveRawUrl(pageContext) {
  const rawHref = pageContext?.rawHref || '';
  const blobUrl = pageContext?.blobUrl || (typeof location !== 'undefined' ? location.href : '');
  if (!rawHref) {
    return '';
  }
  try {
    return new URL(rawHref, blobUrl).href;
  } catch {
    return rawHref;
  }
}

function throwIfAborted(signal) {
  const provider = window.ReadmdProvider;
  if (signal?.aborted) {
    throw provider.createError(provider.ERROR_CODES.ABORTED, '翻译已取消');
  }
}

function statusToError(label, status) {
  const provider = window.ReadmdProvider;
  if (status === 401 || status === 403) {
    return provider.createError(provider.ERROR_CODES.AUTH, `${label}鉴权失败`, { status });
  }
  if (status === 408 || status === 504) {
    return provider.createError(provider.ERROR_CODES.TIMEOUT, `${label}请求超时`, { status });
  }
  if (status === 429) {
    return provider.createError(provider.ERROR_CODES.RATE_LIMIT, `${label}限流，请稍后重试`, { status });
  }
  if (status >= 500) {
    return provider.createError(provider.ERROR_CODES.NETWORK, `${label}服务暂时不可用`, { status });
  }
  return provider.createError(provider.ERROR_CODES.NETWORK, `${label}请求失败：HTTP ${status}`, { status });
}

async function fetchTextWithTimeout(url, options, ms, signal) {
  const provider = window.ReadmdProvider;
  const controller = new AbortController();
  let timedOut = false;

  const abortForwarder = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      throw provider.createError(provider.ERROR_CODES.ABORTED, '翻译已取消');
    }
    signal.addEventListener('abort', abortForwarder, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  try {
    const response = await fetch(url, {
      ...options,
      credentials: options?.credentials || 'include',
      signal: controller.signal
    });
    if (!response.ok) {
      throw statusToError('原文获取', response.status);
    }
    return await response.text();
  } catch (error) {
    if (timedOut) {
      throw provider.createError(provider.ERROR_CODES.TIMEOUT, '原文获取超时');
    }
    if (provider.isAbortError(error) || signal?.aborted) {
      throw provider.createError(provider.ERROR_CODES.ABORTED, '翻译已取消');
    }
    throw provider.normalizeError(error);
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', abortForwarder);
    }
  }
}

async function fetchRawMarkdown(pageContext, signal) {
  const provider = window.ReadmdProvider;
  const rawUrl = resolveRawUrl(pageContext);

  if (rawUrl) {
    return fetchTextWithTimeout(rawUrl, {}, FETCH_TIMEOUT, signal);
  }
  if (pageContext?.fallbackMarkdown) {
    return pageContext.fallbackMarkdown;
  }
  throw provider.createError(provider.ERROR_CODES.NETWORK, '当前页面无法获取 Markdown 原文');
}

function emitProgress(handlers, markdown, meta) {
  handlers?.onProgress?.(markdown, meta);
}

function buildNamespace(config, cache) {
  if (config.provider === 'llm') {
    return cache.makeNamespace(config.provider, config.model || 'default');
  }
  if (config.provider === 'volcengine') {
    return cache.makeNamespace(config.provider, 'machine');
  }
  return cache.makeNamespace(config.provider, 'free');
}

async function translateMarkdown(pageContext, handlers = {}, signal) {
  const providerApi = window.ReadmdProvider;
  const { extractTextNodes, reconstructMarkdown } = window.ReadmdMarkdown;
  const cache = window.ReadmdCache;

  try {
    throwIfAborted(signal);
    const config = await providerApi.loadConfig();
    const namespace = buildNamespace(config, cache);
    const rawMarkdown = await fetchRawMarkdown(pageContext, signal);

    if (!rawMarkdown || !rawMarkdown.trim()) {
      throw providerApi.createError(providerApi.ERROR_CODES.NO_TEXT, '没有可翻译的文本');
    }

    const fileKey = cache.fileCacheKey(namespace, rawMarkdown);
    const fileCached = await cache.get(fileKey);
    if (fileCached) {
      emitProgress(handlers, fileCached, {
        done: true,
        fromCache: true,
        rawMarkdown
      });
      return fileCached;
    }

    const nodes = extractTextNodes(rawMarkdown);
    if (!nodes.length) {
      throw providerApi.createError(providerApi.ERROR_CODES.NO_TEXT, '没有可翻译的文本');
    }

    const provider = await providerApi.createProvider();
    const translated = nodes.map((node) => ({ ...node }));
    const uncached = [];

    for (const node of nodes) {
      throwIfAborted(signal);
      const textKey = cache.textCacheKey(namespace, node.value);
      const hit = await cache.get(textKey);
      if (hit) {
        translated[node.index] = { ...node, value: hit };
      } else {
        uncached.push(node);
      }
    }

    if (uncached.length && uncached.length !== nodes.length) {
      emitProgress(handlers, reconstructMarkdown(rawMarkdown, translated), {
        done: false,
        fromCache: true,
        rawMarkdown
      });
    }

    for (let offset = 0; offset < uncached.length; offset += BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = uncached.slice(offset, offset + BATCH_SIZE);
      const texts = batch.map((node) => node.value);

      let results;
      try {
        results = await provider.translateBatch(texts);
      } catch (batchError) {
        results = [];
        for (const text of texts) {
          throwIfAborted(signal);
          try {
            results.push(await provider.translate(text));
          } catch {
            results.push(text);
          }
        }
      }

      const persistTasks = [];
      batch.forEach((node, index) => {
        const translatedText = results[index];
        translated[node.index] = { ...node, value: translatedText };
        persistTasks.push(cache.set(cache.textCacheKey(namespace, node.value), translatedText));
      });
      await Promise.all(persistTasks);

      emitProgress(handlers, reconstructMarkdown(rawMarkdown, translated), {
        done: false,
        fromCache: false,
        rawMarkdown
      });
    }

    const finalMarkdown = reconstructMarkdown(rawMarkdown, translated);
    await cache.set(fileKey, finalMarkdown);
    emitProgress(handlers, finalMarkdown, {
      done: true,
      fromCache: false,
      rawMarkdown
    });
    return finalMarkdown;
  } catch (error) {
    throw providerApi.normalizeError(error);
  }
}

window.ReadmdTranslator = {
  translateMarkdown,
  resolveRawUrl,
  fetchTextWithTimeout
};
