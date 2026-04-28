/**
 * [INPUT]: ReadmdPanel, ReadmdTranslator, ReadmdProvider
 * [OUTPUT]: 自执行 + window.ReadmdContent helpers — 页面识别、会话状态、按钮注入、翻译任务协调
 * [POS]: 扩展入口与单一状态源，协调 panel / translator / GitHub 页面同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const UI_PREF_KEY = 'readmd:ui';
const BUTTON_ID = 'readmd-btn';
const DEFAULT_UI_STATE = Object.freeze({
  open: false,
  mode: 'preview',
  width: 420
});
const MARKDOWN_NAME_RE = /\.(md|markdown|mdown|mkdn|mkd|mdwn|mdtxt|mdtext|qmd|mdx)$/i;

function normalizeMode(mode) {
  return mode === 'source' ? 'source' : 'preview';
}

function clampWidth(width) {
  const numeric = Number(width) || DEFAULT_UI_STATE.width;
  return Math.max(320, Math.min(Math.round(window.innerWidth * 0.7), Math.round(numeric)));
}

function isBlobPath(pathname) {
  return /\/blob\//.test(pathname || '');
}

function looksLikeMarkdownName(value) {
  if (!value) {
    return false;
  }
  const target = String(value).split('?')[0].split('#')[0];
  return MARKDOWN_NAME_RE.test(target) || /(^|\/)README(\.[^/]+)?$/i.test(target);
}

function extractFilename(pathname) {
  const parts = String(pathname || '').split('/');
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function buildRepoContext(pathname) {
  const match = String(pathname || '').match(/^\/([^/]+)\/([^/]+)\//);
  return match ? `${match[1]}/${match[2]}` : '';
}

function buildPageKey(href) {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return href || '';
  }
}

function toAbsoluteUrl(value, baseHref) {
  if (!value) {
    return '';
  }
  try {
    return new URL(value, baseHref).href;
  } catch {
    return value;
  }
}

function buildPageContext(input) {
  const href = input?.href || '';
  const pathname = input?.pathname || '';
  if (!isBlobPath(pathname)) {
    return null;
  }

  const filename = extractFilename(pathname);
  const rawHref = toAbsoluteUrl(input?.rawHref || '', href || (typeof location !== 'undefined' ? location.href : ''));
  const hasMarkdownPreview = !!input?.hasMarkdownPreview;
  const hasSourceLines = !!input?.hasSourceLines;
  const isMarkdown = hasMarkdownPreview || looksLikeMarkdownName(filename) || looksLikeMarkdownName(rawHref);

  if (!isMarkdown && !hasSourceLines) {
    return null;
  }

  return {
    blobUrl: toAbsoluteUrl(href, href),
    rawHref,
    repoContext: buildRepoContext(pathname),
    viewMode: normalizeMode(input?.viewMode),
    pageKey: buildPageKey(href),
    filename,
    fallbackMarkdown: input?.fallbackMarkdown || ''
  };
}

function isVisible(element) {
  return !!element && !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

function findRawLink(root = document) {
  const selectors = [
    'a[data-testid="raw-button"]',
    'a[href*="/raw/"]'
  ];

  for (const selector of selectors) {
    const candidates = Array.from(root.querySelectorAll(selector));
    const link = candidates.find(isVisible) || candidates[0];
    if (link) {
      return link;
    }
  }
  return null;
}

function findPreviewRoot(root = document) {
  return Array.from(root.querySelectorAll('.markdown-body')).find(isVisible) || null;
}

function getSourceLineElements(root = document) {
  const selectors = ['td[data-line-number] + td', '.blob-code-inner', '.react-code-text'];
  const seen = new Set();
  const elements = [];

  selectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((element) => {
      if (seen.has(element) || !isVisible(element)) {
        return;
      }
      seen.add(element);
      elements.push(element);
    });
  });

  return elements;
}

function extractSourceMarkdown(root = document) {
  return getSourceLineElements(root)
    .map((element) => (element.innerText || element.textContent || '').replace(/\u00a0/g, ''))
    .join('\n')
    .trimEnd();
}

function detectViewMode(root = document) {
  if (findPreviewRoot(root)) {
    return 'preview';
  }
  if (getSourceLineElements(root).length) {
    return 'source';
  }
  return 'preview';
}

function readPageContext(root = document) {
  const previewRoot = findPreviewRoot(root);
  const sourceLines = getSourceLineElements(root);
  return buildPageContext({
    href: location.href,
    pathname: location.pathname,
    rawHref: findRawLink(root)?.href || '',
    hasMarkdownPreview: !!previewRoot,
    hasSourceLines: sourceLines.length > 0,
    viewMode: previewRoot ? 'preview' : (sourceLines.length ? 'source' : 'preview'),
    fallbackMarkdown: sourceLines.length ? extractSourceMarkdown(root) : ''
  });
}

function findButtonAnchor(root = document) {
  const rawLink = findRawLink(root);
  if (!rawLink) {
    return null;
  }
  return rawLink.closest('li, div') || rawLink;
}

function findMountContainer(root = document) {
  const blob = root.querySelector('[class*="blobContainer"]');
  if (blob?.parentElement && getComputedStyle(blob.parentElement).display === 'flex') {
    return blob.parentElement;
  }

  const start = findPreviewRoot(root) || getSourceLineElements(root)[0];
  if (!start) {
    return null;
  }

  let element = start.parentElement;
  while (element && element !== document.body) {
    const styles = getComputedStyle(element);
    if (styles.display === 'flex' && styles.flexDirection === 'row') {
      return element;
    }
    element = element.parentElement;
  }

  return start.parentElement || null;
}

window.ReadmdContent = {
  normalizeMode,
  looksLikeMarkdownName,
  buildRepoContext,
  buildPageKey,
  buildPageContext
};

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  (function bootstrapReadmd() {
    const runtime = {
      pageContext: null,
      panel: null,
      button: null,
      prefs: { ...DEFAULT_UI_STATE },
      state: createSessionState(null, DEFAULT_UI_STATE),
      job: null,
      syncTimer: 0,
      observer: null
    };

    init();

    async function init() {
      runtime.prefs = await loadUiPrefs();
      syncFromDom();
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
      document.addEventListener('keydown', onKeydown, true);
      document.addEventListener('turbo:load', scheduleSync);
      window.addEventListener('resize', onWindowResize);

      runtime.observer = new MutationObserver(scheduleSync);
      runtime.observer.observe(document.body, { childList: true, subtree: true });
    }

    function createSessionState(context, prefs) {
      return {
        pageKey: context?.pageKey || '',
        open: false,
        mode: normalizeMode(context?.viewMode || prefs.mode),
        width: clampWidth(prefs.width),
        phase: 'idle',
        markdown: '',
        previewHtml: '',
        previewPending: false,
        jobId: 0,
        error: null
      };
    }

    function onRuntimeMessage(message) {
      if (message.type === 'toggle-translate' && runtime.pageContext) {
        togglePanel();
      }
    }

    function onKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.code === 'KeyY') {
        event.preventDefault();
        event.stopPropagation();
        if (runtime.pageContext) {
          togglePanel();
        }
      }
    }

    function onWindowResize() {
      if (!runtime.state.open) {
        return;
      }
      const width = clampWidth(runtime.state.width);
      if (width === runtime.state.width) {
        return;
      }
      runtime.state.width = width;
      runtime.panel?.render(runtime.state);
      saveUiPrefs({ width });
    }

    function scheduleSync() {
      if (runtime.syncTimer) {
        return;
      }
      runtime.syncTimer = window.setTimeout(() => {
        runtime.syncTimer = 0;
        syncFromDom();
      }, 120);
    }

    async function loadUiPrefs() {
      return new Promise((resolve) => {
        chrome.storage.local.get(UI_PREF_KEY, (result) => {
          const raw = result?.[UI_PREF_KEY] || {};
          resolve({
            open: !!raw.open,
            mode: normalizeMode(raw.mode),
            width: clampWidth(raw.width)
          });
        });
      });
    }

    function saveUiPrefs(patch) {
      runtime.prefs = {
        ...runtime.prefs,
        ...patch,
        mode: normalizeMode((patch && patch.mode) || runtime.prefs.mode),
        width: clampWidth((patch && patch.width) || runtime.prefs.width)
      };
      chrome.storage.local.set({ [UI_PREF_KEY]: runtime.prefs });
    }

    function syncFromDom() {
      const context = readPageContext(document);
      if (!context) {
        teardownUnavailablePage();
        return;
      }

      const pageChanged = context.pageKey !== runtime.pageContext?.pageKey;
      runtime.pageContext = context;

      if (pageChanged) {
        cancelJob();
        destroyPanel(false);
        removeButton();
        runtime.state = createSessionState(context, runtime.prefs);
      }

      ensureButton(context);

      if (runtime.state.open) {
        ensurePanel(context);
        if (context.viewMode !== runtime.state.mode) {
          setMode(context.viewMode, true);
        } else {
          runtime.panel?.render(runtime.state);
        }
      } else if (runtime.prefs.open) {
        openPanel(true);
      }
    }

    function teardownUnavailablePage() {
      runtime.pageContext = null;
      cancelJob();
      destroyPanel(false);
      removeButton();
      runtime.state = createSessionState(null, runtime.prefs);
    }

    function ensureButton(context) {
      const anchor = findButtonAnchor(document);
      const rawLink = findRawLink(document);
      if (!anchor || !rawLink) {
        return;
      }

      if (!runtime.button) {
        runtime.button = document.createElement('button');
        runtime.button.id = BUTTON_ID;
        runtime.button.type = 'button';
        runtime.button.textContent = '中';
        runtime.button.className = rawLink.className || 'btn btn-sm';
        runtime.button.style.marginLeft = '8px';
        runtime.button.setAttribute('aria-label', '翻译为中文 (Ctrl/Command+Shift+Y)');
        runtime.button.addEventListener('click', togglePanel);
      }

      runtime.button.className = rawLink.className || runtime.button.className;

      if (!runtime.button.isConnected) {
        anchor.insertAdjacentElement('afterend', runtime.button);
      }

      runtime.button.dataset.pageKey = context.pageKey;
      runtime.button.setAttribute('aria-pressed', runtime.state.open ? 'true' : 'false');
    }

    function removeButton() {
      if (!runtime.button) {
        return;
      }
      runtime.button.remove();
    }

    function ensurePanel(context) {
      const mount = findMountContainer(document);
      if (!mount) {
        return null;
      }

      if (!runtime.panel) {
        runtime.panel = new window.ReadmdPanel().create(mount).bindActions({
          onClose: () => closePanel(true),
          onRetry: retryCurrentJob,
          onOpenOptions: openOptionsPage,
          onModeChange: (mode) => setMode(mode, true),
          onResize: (width, persist) => {
            runtime.state.width = clampWidth(width);
            if (persist) {
              saveUiPrefs({ width: runtime.state.width });
            }
          }
        });
      } else {
        runtime.panel.create(mount);
      }

      runtime.panel.render(runtime.state);
      return runtime.panel;
    }

    function destroyPanel(focusButton) {
      if (!runtime.panel) {
        return;
      }
      runtime.panel.destroy();
      runtime.panel = null;
      if (focusButton && runtime.button?.isConnected) {
        runtime.button.focus();
      }
    }

    function togglePanel() {
      if (runtime.state.open) {
        closePanel(true);
      } else {
        openPanel(false);
      }
    }

    function openPanel(fromRestore) {
      const context = runtime.pageContext || readPageContext(document);
      if (!context) {
        return;
      }

      runtime.pageContext = context;
      runtime.state.open = true;
      runtime.state.mode = normalizeMode(context.viewMode || runtime.state.mode);
      runtime.state.error = null;

      const panel = ensurePanel(context);
      if (!panel) {
        runtime.state.open = false;
        return;
      }

      runtime.button?.setAttribute('aria-pressed', 'true');
      if (!fromRestore) {
        saveUiPrefs({ open: true, mode: runtime.state.mode, width: runtime.state.width });
      } else {
        saveUiPrefs({ open: true });
      }
      startTranslation(context);
    }

    function closePanel(persist) {
      cancelJob();
      runtime.state = {
        ...runtime.state,
        open: false,
        phase: 'idle',
        markdown: '',
        previewHtml: '',
        previewPending: false,
        error: null
      };
      runtime.button?.setAttribute('aria-pressed', 'false');
      destroyPanel(true);
      if (persist) {
        saveUiPrefs({ open: false });
      }
    }

    function retryCurrentJob() {
      if (!runtime.pageContext || !runtime.state.open) {
        return;
      }
      startTranslation(runtime.pageContext);
    }

    function setMode(mode, persist) {
      const nextMode = normalizeMode(mode);
      if (runtime.state.mode === nextMode) {
        return;
      }
      runtime.state.mode = nextMode;
      runtime.panel?.render(runtime.state);
      if (persist) {
        saveUiPrefs({ mode: nextMode });
      }
    }

    function cancelJob() {
      if (runtime.job?.controller) {
        runtime.job.controller.abort();
      }
      runtime.job = null;
    }

    function startTranslation(context) {
      cancelJob();

      const jobId = runtime.state.jobId + 1;
      const controller = new AbortController();
      runtime.job = { id: jobId, controller, pageKey: context.pageKey };
      runtime.state = {
        ...runtime.state,
        pageKey: context.pageKey,
        phase: 'loading',
        markdown: '',
        previewHtml: '',
        previewPending: false,
        jobId,
        error: null
      };
      runtime.panel?.render(runtime.state);

      window.ReadmdTranslator.translateMarkdown(
        {
          ...context,
          fallbackMarkdown: context.viewMode === 'source' ? extractSourceMarkdown(document) : context.fallbackMarkdown
        },
        {
          onProgress: (markdown, meta) => {
            if (!isActiveJob(jobId, context.pageKey)) {
              return;
            }

            runtime.state = {
              ...runtime.state,
              markdown,
              phase: meta.done ? 'ready' : 'partial',
              previewPending: !!meta.done,
              error: null
            };
            runtime.panel?.render(runtime.state);

            if (meta.done) {
              requestPreviewHtml(jobId, markdown, context.repoContext);
            }
          }
        },
        controller.signal
      ).catch((error) => {
        if (!isActiveJob(jobId, context.pageKey)) {
          return;
        }
        const normalized = window.ReadmdProvider.normalizeError(error);
        if (normalized.code === window.ReadmdProvider.ERROR_CODES.ABORTED) {
          return;
        }
        runtime.state = {
          ...runtime.state,
          phase: 'error',
          previewPending: false,
          error: buildErrorState(normalized)
        };
        runtime.panel?.render(runtime.state);
      });
    }

    function isActiveJob(jobId, pageKey) {
      return runtime.job && runtime.job.id === jobId && runtime.job.pageKey === pageKey && runtime.state.open;
    }

    function requestPreviewHtml(jobId, markdown, repoContext) {
      chrome.runtime.sendMessage(
        {
          type: 'github-markdown',
          markdown,
          context: repoContext
        },
        (response) => {
          if (!isActiveJob(jobId, runtime.pageContext?.pageKey || '')) {
            return;
          }

          if (chrome.runtime.lastError || !response?.ok || !response.html) {
            runtime.state = {
              ...runtime.state,
              previewPending: false
            };
            runtime.panel?.render(runtime.state);
            return;
          }

          runtime.state = {
            ...runtime.state,
            previewHtml: response.html,
            previewPending: false
          };
          runtime.panel?.render(runtime.state);
        }
      );
    }

    function buildErrorState(error) {
      const code = error?.code || window.ReadmdProvider.ERROR_CODES.UNKNOWN;

      if (code === window.ReadmdProvider.ERROR_CODES.NO_TEXT) {
        return {
          title: '没有可翻译的文本',
          message: '这个文件主要是代码、空内容，或者当前视图拿不到可翻译的自然语言。',
          retryable: false,
          openOptions: false
        };
      }
      if (code === window.ReadmdProvider.ERROR_CODES.AUTH) {
        return {
          title: '翻译服务配置有问题',
          message: '当前 provider 的鉴权失败了，请检查 API Key 或切换翻译方式。',
          retryable: false,
          openOptions: true
        };
      }
      if (code === window.ReadmdProvider.ERROR_CODES.TIMEOUT) {
        return {
          title: '翻译超时',
          message: '服务响应太慢了，这次没有在时限内完成。',
          retryable: true,
          openOptions: false
        };
      }
      if (code === window.ReadmdProvider.ERROR_CODES.RATE_LIMIT) {
        return {
          title: '服务繁忙',
          message: '请求频率过高或上游限流了，稍后重试会更稳。',
          retryable: true,
          openOptions: false
        };
      }
      if (code === window.ReadmdProvider.ERROR_CODES.NETWORK) {
        return {
          title: '网络连接失败',
          message: '原文获取或翻译请求没有成功完成，请检查网络后重试。',
          retryable: true,
          openOptions: false
        };
      }
      return {
        title: '翻译失败',
        message: error?.message || '这次翻译没有成功完成，请再试一次。',
        retryable: true,
        openOptions: false
      };
    }

    function openOptionsPage() {
      chrome.runtime.sendMessage({ type: 'openOptions' });
    }
  })();
}
