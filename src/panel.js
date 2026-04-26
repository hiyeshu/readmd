/**
 * [INPUT]: marked.js (window.marked), highlight.js (window.hljs)
 * [OUTPUT]: ReadmdPanel — create/destroy/update，GitHub 原生风格翻译面板
 * [POS]: 翻译管线的渲染层，被 content.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 面板样式 ──

const PANEL_CSS = `
#readmd-panel {
  flex: 0 0 var(--readmd-width, 50vw);
  display: flex; flex-direction: column;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 6px;
  background: var(--bgColor-default, #fff);
  overflow: hidden;
  margin-left: 16px;
  min-width: 280px;
  max-width: 70vw;
}
#readmd-panel[data-theme="dark"] {
  background: var(--bgColor-default, #0d1117);
  border-color: var(--borderColor-default, #3d444d);
  color: var(--fgColor-default, #f0f6fc);
}

/* ── 拖拽手柄 ── */

.readmd-resize {
  position: absolute; left: -4px; top: 0; bottom: 0;
  width: 8px; cursor: col-resize; z-index: 10;
}
.readmd-resize:hover,
.readmd-resize.active {
  background: var(--fgColor-accent, #0969da);
  opacity: 0.3; border-radius: 4px;
}

/* ── 工具栏 ── */

.readmd-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px;
  background: var(--bgColor-muted, #f6f8fa);
  border-bottom: 1px solid var(--borderColor-default, #d1d9e0);
  flex-shrink: 0;
}
.readmd-toolbar-left { display: flex; align-items: center; gap: 8px; }
.readmd-toolbar-right { display: flex; align-items: center; gap: 4px; }

/* ── SegmentedControl ── */

.readmd-seg {
  display: inline-flex; list-style: none;
  background: var(--bgColor-neutral-muted, #e6eaef);
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 6px;
  padding: 2px; margin: 0;
}
.readmd-seg-btn {
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; cursor: pointer;
  font-size: 14px; font-weight: 400;
  color: var(--fgColor-default, #1f2328);
  padding: 2px 12px; border-radius: 5px; height: 24px;
}
.readmd-seg-btn[aria-current="true"] {
  background: var(--bgColor-default, #fff);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--borderColor-default, #d1d9e0);
}
.readmd-seg-btn:hover:not([aria-current="true"]) {
  background: rgba(175,184,193,0.2);
}

/* ── 文件信息 ── */

.readmd-fileinfo {
  font-size: 12px; color: var(--fgColor-muted, #656d76);
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}

/* ── 关闭按钮 ── */

.readmd-close {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 6px;
  background: var(--bgColor-default, #fff);
  cursor: pointer; color: var(--fgColor-muted, #656d76);
  flex-shrink: 0;
}
.readmd-close:hover { background: rgba(175,184,193,0.2); }

/* ── 暗色模式 ── */

[data-theme="dark"] .readmd-toolbar {
  background: var(--bgColor-muted, #151b23);
  border-color: var(--borderColor-default, #3d444d);
}
[data-theme="dark"] .readmd-seg {
  background: var(--bgColor-neutral-muted, #656c7633);
  border-color: var(--borderColor-default, #3d444d);
}
[data-theme="dark"] .readmd-seg-btn {
  color: var(--fgColor-default, #f0f6fc);
}
[data-theme="dark"] .readmd-seg-btn[aria-current="true"] {
  background: var(--bgColor-default, #0d1117);
  box-shadow: 0 0 0 1px var(--borderColor-default, #3d444d);
}
[data-theme="dark"] .readmd-close {
  border-color: var(--borderColor-default, #3d444d);
  background: var(--bgColor-default, #0d1117);
  color: var(--fgColor-muted, #9198a1);
}
[data-theme="dark"] .readmd-fileinfo {
  color: var(--fgColor-muted, #9198a1);
}

/* ── 内容区 ── */

.readmd-body {
  flex: 1; padding: 16px;
}

.readmd-body.readmd-source { padding: 0; }
.readmd-lines {
  width: 100%; border-collapse: collapse;
  font-size: 12px; line-height: 20px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}
.readmd-ln {
  width: 1%; min-width: 40px; padding: 0 8px;
  text-align: right; vertical-align: top;
  color: var(--fgColor-muted, #656d76);
  user-select: none; white-space: nowrap;
}
.readmd-lc {
  padding: 0 16px 0 8px;
  white-space: pre-wrap; word-break: break-word;
}

/* ── 骨架屏 ── */

.readmd-skeleton { display: flex; flex-direction: column; gap: 12px; }
.readmd-skeleton-line {
  height: 14px; border-radius: 4px;
  background: var(--bgColor-neutral-muted, #eee);
  animation: readmd-pulse 0.8s ease-in-out infinite alternate;
}
.readmd-skeleton-line:nth-child(1) { width: 90%; }
.readmd-skeleton-line:nth-child(2) { width: 65%; }
.readmd-skeleton-line:nth-child(3) { width: 80%; }
@keyframes readmd-pulse { from { opacity: 1; } to { opacity: 0.4; } }

/* ── 状态 ── */

.readmd-status {
  color: var(--fgColor-muted, #656d76); font-size: 14px;
  text-align: center; padding: 32px 16px;
}
.readmd-status button {
  color: var(--fgColor-accent, #0969da);
  background: none; border: none; cursor: pointer;
  text-decoration: underline; font-size: 14px;
}
.readmd-translating { color: var(--fgColor-muted, #656d76); font-size: 13px; padding: 8px 0; }

/* ── highlight.js 作用域 ── */

.readmd-body pre code.hljs { display: block; overflow-x: auto; padding: 16px; }
.readmd-body code.hljs { padding: 3px 5px; }
.readmd-body .hljs { color: #24292e; background: #f6f8fa; }
.readmd-body .hljs-doctag,
.readmd-body .hljs-keyword,
.readmd-body .hljs-meta .hljs-keyword,
.readmd-body .hljs-template-tag,
.readmd-body .hljs-template-variable,
.readmd-body .hljs-type,
.readmd-body .hljs-variable.language_ { color: #d73a49; }
.readmd-body .hljs-title,
.readmd-body .hljs-title.class_,
.readmd-body .hljs-title.class_.inherited__,
.readmd-body .hljs-title.function_ { color: #6f42c1; }
.readmd-body .hljs-attr,
.readmd-body .hljs-attribute,
.readmd-body .hljs-literal,
.readmd-body .hljs-meta,
.readmd-body .hljs-number,
.readmd-body .hljs-operator,
.readmd-body .hljs-selector-attr,
.readmd-body .hljs-selector-class,
.readmd-body .hljs-selector-id,
.readmd-body .hljs-variable { color: #005cc5; }
.readmd-body .hljs-meta .hljs-string,
.readmd-body .hljs-regexp,
.readmd-body .hljs-string { color: #032f62; }
.readmd-body .hljs-built_in,
.readmd-body .hljs-symbol { color: #e36209; }
.readmd-body .hljs-code,
.readmd-body .hljs-comment,
.readmd-body .hljs-formula { color: #6a737d; }
.readmd-body .hljs-name,
.readmd-body .hljs-quote,
.readmd-body .hljs-selector-pseudo,
.readmd-body .hljs-selector-tag { color: #22863a; }
.readmd-body .hljs-subst { color: #24292e; }
.readmd-body .hljs-section { color: #005cc5; font-weight: 700; }
.readmd-body .hljs-bullet { color: #735c0f; }
.readmd-body .hljs-emphasis { color: #24292e; font-style: italic; }
.readmd-body .hljs-strong { color: #24292e; font-weight: 700; }
.readmd-body .hljs-addition { color: #22863a; background-color: #f0fff4; }
.readmd-body .hljs-deletion { color: #b31d28; background-color: #ffeef0; }

/* ── dark mode ── */

@media (prefers-color-scheme: dark) {
  .readmd-body .hljs { color: #c9d1d9; background: #161b22; }
  .readmd-body .hljs-doctag,
  .readmd-body .hljs-keyword,
  .readmd-body .hljs-meta .hljs-keyword,
  .readmd-body .hljs-template-tag,
  .readmd-body .hljs-template-variable,
  .readmd-body .hljs-type,
  .readmd-body .hljs-variable.language_ { color: #ff7b72; }
  .readmd-body .hljs-title,
  .readmd-body .hljs-title.class_,
  .readmd-body .hljs-title.class_.inherited__,
  .readmd-body .hljs-title.function_ { color: #d2a8ff; }
  .readmd-body .hljs-attr,
  .readmd-body .hljs-attribute,
  .readmd-body .hljs-literal,
  .readmd-body .hljs-meta,
  .readmd-body .hljs-number,
  .readmd-body .hljs-operator,
  .readmd-body .hljs-selector-attr,
  .readmd-body .hljs-selector-class,
  .readmd-body .hljs-selector-id,
  .readmd-body .hljs-variable { color: #79c0ff; }
  .readmd-body .hljs-meta .hljs-string,
  .readmd-body .hljs-regexp,
  .readmd-body .hljs-string { color: #a5d6ff; }
  .readmd-body .hljs-built_in,
  .readmd-body .hljs-symbol { color: #ffa657; }
  .readmd-body .hljs-code,
  .readmd-body .hljs-comment,
  .readmd-body .hljs-formula { color: #8b949e; }
  .readmd-body .hljs-name,
  .readmd-body .hljs-quote,
  .readmd-body .hljs-selector-pseudo,
  .readmd-body .hljs-selector-tag { color: #7ee787; }
  .readmd-body .hljs-subst { color: #c9d1d9; }
  .readmd-body .hljs-section { color: #1f6feb; font-weight: 700; }
  .readmd-body .hljs-bullet { color: #f2cc60; }
  .readmd-body .hljs-emphasis { color: #c9d1d9; font-style: italic; }
  .readmd-body .hljs-strong { color: #c9d1d9; font-weight: 700; }
  .readmd-body .hljs-addition { color: #aff5b4; background-color: #033a16; }
  .readmd-body .hljs-deletion { color: #ffdcd7; background-color: #67060c; }
}
`;

const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

class ReadmdPanel {
  constructor() {
    this.el = null;
    this.bodyEl = null;
    this.markdown = '';
    this.isOpen = false;
    this.mode = 'preview';
    this._onClose = null;
    this._width = window.innerWidth * 0.5;
  }

  create(flexRowContainer, onClose) {
    if (this.el) return;
    this._onClose = onClose;

    if (!document.getElementById('readmd-style')) {
      const s = document.createElement('style');
      s.id = 'readmd-style';
      s.textContent = PANEL_CSS;
      document.head.appendChild(s);
    }

    this.el = document.createElement('div');
    this.el.id = 'readmd-panel';
    this.el.style.position = 'relative';
    this.el.setAttribute('role', 'complementary');
    this.el.setAttribute('aria-label', '中文翻译');

    // ── 同步 GitHub 主题 ──
    const colorMode = document.documentElement.getAttribute('data-color-mode');
    const darkTheme = document.documentElement.getAttribute('data-dark-theme');
    const lightTheme = document.documentElement.getAttribute('data-light-theme');
    const isDark = colorMode === 'dark' || (colorMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    this.el.setAttribute('data-theme', isDark ? 'dark' : 'light');

    this.el.innerHTML = `
      <div class="readmd-resize"></div>
      <div class="readmd-toolbar">
        <div class="readmd-toolbar-left">
          <ul class="readmd-seg">
            <li><button class="readmd-seg-btn" aria-current="true" data-mode="preview">预览</button></li>
            <li><button class="readmd-seg-btn" aria-current="false" data-mode="source">源码</button></li>
          </ul>
          <span class="readmd-fileinfo"></span>
        </div>
        <div class="readmd-toolbar-right">
          <button class="readmd-close" aria-label="关闭">${CLOSE_SVG}</button>
        </div>
      </div>
      <div class="readmd-body markdown-body"></div>`;

    flexRowContainer.appendChild(this.el);
    this.bodyEl = this.el.querySelector('.readmd-body');
    this.el.querySelector('.readmd-close').addEventListener('click', () => this.close());

    this.el.querySelectorAll('.readmd-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => this._switchMode(btn.dataset.mode));
    });

    this._setupResize();
    this.isOpen = true;
  }

  // ── 拖拽调整宽度 ──

  _setupResize() {
    const handle = this.el.querySelector('.readmd-resize');
    let startX, startW;

    const onMove = (e) => {
      const dx = startX - e.clientX;
      const w = Math.max(280, Math.min(window.innerWidth * 0.6, startW + dx));
      this._width = w;
      this.el.style.setProperty('--readmd-width', w + 'px');
    };

    const onUp = () => {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = this._width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── 模式切换 ──

  _switchMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.el.querySelectorAll('.readmd-seg-btn').forEach(btn => {
      btn.setAttribute('aria-current', btn.dataset.mode === mode ? 'true' : 'false');
    });
    this._render();
  }

  // ── 渲染 ──

  _render() {
    if (!this.markdown) return;
    if (this.mode === 'preview') {
      this.bodyEl.className = 'readmd-body markdown-body';
      this.bodyEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(this.markdown, { renderer: this._renderer() }) : this._esc(this.markdown);
      this._highlightAll();
    } else {
      this.bodyEl.className = 'readmd-body readmd-source';
      const table = document.createElement('table');
      table.className = 'readmd-lines';
      const lines = this.markdown.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td');
        tdNum.className = 'readmd-ln';
        tdNum.textContent = i + 1;
        const tdCode = document.createElement('td');
        tdCode.className = 'readmd-lc';
        tdCode.textContent = lines[i];
        tr.appendChild(tdNum);
        tr.appendChild(tdCode);
        table.appendChild(tr);
      }
      this.bodyEl.innerHTML = '';
      this.bodyEl.appendChild(table);
    }
    this._updateFileInfo();
  }

  _renderer() {
    const r = new marked.Renderer();
    r.code = ({ text, lang }) => {
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      }
      return `<pre><code>${this._esc(text)}</code></pre>`;
    };
    return r;
  }

  _highlightAll() {
    if (typeof hljs === 'undefined') return;
    this.bodyEl.querySelectorAll('pre code:not(.hljs)').forEach(el => {
      hljs.highlightElement(el);
    });
  }

  _updateFileInfo() {
    const info = this.el.querySelector('.readmd-fileinfo');
    if (!info || !this.markdown) return;
    const lines = this.markdown.split('\n');
    const loc = lines.filter(l => l.trim()).length;
    const bytes = new Blob([this.markdown]).size;
    const size = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    info.textContent = `${lines.length} 行 (${loc} loc) · ${size}`;
  }

  // ── 生命周期 ──

  close() {
    if (!this.el) return;
    this.el.remove();
    document.getElementById('readmd-style')?.remove();
    this.el = null; this.bodyEl = null; this.isOpen = false;
    this._onClose?.();
  }

  destroy() { if (this.isOpen) this.close(); }

  showSkeleton() {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = `<div class="readmd-skeleton">
      <div class="readmd-skeleton-line"></div><div class="readmd-skeleton-line"></div><div class="readmd-skeleton-line"></div>
    </div>`;
  }

  showStatus(html) {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = `<div class="readmd-status">${html}</div>`;
  }

  update(markdown, done) {
    this.markdown = markdown;
    this._render();
    if (!done) this.bodyEl.insertAdjacentHTML('beforeend', '<div class="readmd-translating">翻译中...</div>');
  }

  _esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}

window.ReadmdPanel = ReadmdPanel;
