/**
 * [INPUT]: ReadmdPanel, ReadmdTranslator
 * [OUTPUT]: 自执行 — 注入按钮、监听 Ctrl/Command+Shift+Y、嵌入面板到 GitHub flex-row 布局
 * [POS]: 扩展入口，胶水层，协调 panel 和 translator
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

(function () {
  let panel = null;
  let translating = false;

  // ── 检测 Markdown 文件页 ──

  function isFilePage() {
    return /\/blob\//.test(location.pathname);
  }

  function isMarkdownPage() {
    return !!document.querySelector('.markdown-body') && isFilePage();
  }

  // ── 找到 GitHub 内容区的 flex-row 容器（和 Outline 面板同级）──

  function findFlexRow() {
    const blob = document.querySelector('[class*="blobContainer"]');
    if (blob) {
      const parent = blob.parentElement;
      if (parent && getComputedStyle(parent).display === 'flex') return parent;
    }
    const md = document.querySelector('.markdown-body');
    if (!md) return null;
    let el = md;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (cs.display === 'flex' && cs.flexDirection === 'row') return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── 注入"中"按钮到工具栏 ──

  function injectButton() {
    if (document.getElementById('readmd-btn')) return;

    const rawLink = document.querySelector('a[href*="/raw/"]');
    if (!rawLink) return;

    // ── 跳过 BtnGroup，找到工具栏最外层 flex 行 ──
    let toolbar = rawLink.parentElement;
    while (toolbar && toolbar !== document.body) {
      const next = toolbar.parentElement;
      if (!next || next === document.body) break;
      const cs = getComputedStyle(next);
      if (cs.display === 'flex' && cs.flexDirection === 'row' && next.children.length >= 4) {
        toolbar = next;
        break;
      }
      toolbar = next;
    }
    if (!toolbar || toolbar === document.body) return;

    const btn = document.createElement('button');
    btn.id = 'readmd-btn';
    btn.textContent = '中';
    btn.className = 'btn btn-sm tooltipped tooltipped-n';
    btn.setAttribute('aria-label', '翻译为中文 (Ctrl/Command+Shift+Y)');
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', toggle);
    toolbar.appendChild(btn);
  }

  // ── 开关面板 ──

  async function toggle() {
    if (panel?.isOpen) { panel.close(); return; }

    const flexRow = findFlexRow();
    if (!flexRow) return;

    panel = new window.ReadmdPanel();
    panel.create(flexRow, () => { panel = null; });

    panel.showSkeleton();
    if (translating) return;
    translating = true;
    try {
      await window.ReadmdTranslator.translateMarkdown(location.href, (md, done) => {
        if (panel) panel.update(md, done);
      });
    } catch (e) {
      if (!panel) return;
      if (e.message === 'NO_TRANSLATABLE_TEXT') panel.showStatus('没有可翻译的文本');
      else if (/API Key/.test(e.message)) panel.showStatus('API Key 无效');
      else if (/timeout|abort/i.test(e.message)) panel.showStatus('翻译超时 — <button onclick="location.reload()">重试</button>');
      else panel.showStatus('网络连接失败 — <button onclick="location.reload()">重试</button>');
    } finally { translating = false; }
  }

  // ── 快捷键 Ctrl/Command+Shift+Y（chrome.commands 消息 + keydown fallback）──

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle-translate' && isFilePage()) toggle();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyY') {
      e.preventDefault();
      e.stopPropagation();
      if (isFilePage()) toggle();
    }
  }, true);

  // ── SPA 路由检测 ──

  function onNavigate() {
    if (panel?.isOpen) { panel.destroy(); panel = null; }
    setTimeout(() => { if (isFilePage()) injectButton(); }, 300);
  }

  document.addEventListener('turbo:load', onNavigate);
  new MutationObserver(() => {
    if (isFilePage() && !document.getElementById('readmd-btn')) injectButton();
  }).observe(document.body, { childList: true, subtree: true });

  if (isFilePage()) injectButton();
})();
