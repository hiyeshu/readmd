/**
 * [INPUT]: marked.js (window.marked), highlight.js (window.hljs), content.js 传入的状态与动作
 * [OUTPUT]: ReadmdPanel — create/bindActions/render/destroy，状态驱动的翻译面板
 * [POS]: 翻译管线的渲染层，被 content.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const PANEL_CSS = `
#readmd-panel {
  --readmd-width: 420px;
  flex: 0 0 var(--readmd-width);
  min-width: 320px;
  max-width: 70vw;
  margin-left: 16px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  border-radius: 10px;
  background: var(--readmd-surface, #ffffff);
  color: var(--readmd-fg, #171717);
  box-shadow: rgba(0, 0, 0, 0.08) 0 0 0 1px, rgba(0, 0, 0, 0.04) -4px 0 12px -8px;
}
#readmd-panel[data-theme="dark"] {
  --readmd-surface: #0d1117;
  --readmd-surface-muted: #151b23;
  --readmd-surface-soft: #161b22;
  --readmd-border: #3d444d;
  --readmd-fg: #f0f6fc;
  --readmd-muted: #9198a1;
  --readmd-code: #c9d1d9;
  --readmd-code-bg: #11161d;
}
#readmd-panel[data-theme="light"] {
  --readmd-surface: #ffffff;
  --readmd-surface-muted: #f6f8fa;
  --readmd-surface-soft: #f6f8fa;
  --readmd-border: #d0d7de;
  --readmd-fg: #171717;
  --readmd-muted: #656d76;
  --readmd-code: #24292e;
  --readmd-code-bg: #f6f8fa;
}

.readmd-resize {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  z-index: 3;
}
.readmd-resize:hover,
.readmd-resize.active {
  background: rgba(9, 105, 218, 0.18);
}

.readmd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--readmd-border);
  background: var(--readmd-surface-muted);
  flex-shrink: 0;
}
.readmd-toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.readmd-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.readmd-seg {
  display: inline-flex;
  padding: 2px;
  margin: 0;
  list-style: none;
  border-radius: 7px;
  background: rgba(175, 184, 193, 0.16);
  box-shadow: inset 0 0 0 1px var(--readmd-border);
}
.readmd-seg-btn,
.readmd-close,
.readmd-action {
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
}
.readmd-seg-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--readmd-muted);
}
.readmd-seg-btn[aria-current="true"] {
  color: var(--readmd-fg);
  background: var(--readmd-surface);
  box-shadow: rgba(0, 0, 0, 0.08) 0 0 0 1px;
}

.readmd-fileinfo {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--readmd-muted);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}

.readmd-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--readmd-muted);
}
.readmd-close:hover,
.readmd-seg-btn:hover:not([aria-current="true"]),
.readmd-action:hover {
  background: rgba(175, 184, 193, 0.16);
}

.readmd-content {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.readmd-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 16px;
}
.readmd-body.readmd-source {
  padding: 0;
}

.readmd-footer {
  min-height: 18px;
  padding: 8px 16px 12px;
  font-size: 12px;
  color: var(--readmd-muted);
  border-top: 1px solid transparent;
}
.readmd-footer[data-visible="true"] {
  border-top-color: var(--readmd-border);
}

.readmd-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.readmd-skeleton-line {
  height: 14px;
  border-radius: 6px;
  background: rgba(175, 184, 193, 0.2);
  animation: readmd-pulse 0.8s ease-in-out infinite alternate;
}
.readmd-skeleton-line:nth-child(1) { width: 92%; }
.readmd-skeleton-line:nth-child(2) { width: 74%; }
.readmd-skeleton-line:nth-child(3) { width: 88%; }
@keyframes readmd-pulse {
  from { opacity: 1; }
  to { opacity: 0.4; }
}

.readmd-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 20px;
  text-align: center;
}
.readmd-state-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--readmd-fg);
}
.readmd-state-text {
  font-size: 14px;
  color: var(--readmd-muted);
  line-height: 1.6;
  max-width: 320px;
}
.readmd-state-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.readmd-action {
  padding: 7px 12px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: rgba(0, 0, 0, 0.08) 0 0 0 1px;
}
.readmd-action.primary {
  background: var(--readmd-fg);
  color: var(--readmd-surface);
  box-shadow: none;
}

.readmd-lines {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 20px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
.readmd-ln {
  width: 1%;
  min-width: 44px;
  padding: 0 8px;
  text-align: right;
  vertical-align: top;
  color: var(--readmd-muted);
  background: var(--readmd-surface-soft);
  user-select: none;
  white-space: nowrap;
  border-right: 1px solid var(--readmd-border);
}
.readmd-lc {
  padding: 0 16px 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--readmd-code);
}

.readmd-body pre code.hljs {
  display: block;
  overflow-x: auto;
  padding: 16px;
}
.readmd-body code.hljs {
  padding: 3px 5px;
}
.readmd-body .hljs {
  color: var(--readmd-code);
  background: var(--readmd-code-bg);
}
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
.readmd-body .hljs-subst { color: var(--readmd-code); }
.readmd-body .hljs-section { color: #005cc5; font-weight: 700; }
.readmd-body .hljs-bullet { color: #735c0f; }
.readmd-body .hljs-emphasis { color: var(--readmd-code); font-style: italic; }
.readmd-body .hljs-strong { color: var(--readmd-code); font-weight: 700; }
.readmd-body .hljs-addition { color: #22863a; background-color: #f0fff4; }
.readmd-body .hljs-deletion { color: #b31d28; background-color: #ffeef0; }

#readmd-panel[data-theme="dark"] .readmd-body .hljs-doctag,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-keyword,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-meta .hljs-keyword,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-template-tag,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-template-variable,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-type,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-variable.language_ { color: #ff7b72; }
#readmd-panel[data-theme="dark"] .readmd-body .hljs-title,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-title.class_,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-title.class_.inherited__,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-title.function_ { color: #d2a8ff; }
#readmd-panel[data-theme="dark"] .readmd-body .hljs-attr,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-attribute,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-literal,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-meta,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-number,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-operator,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-selector-attr,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-selector-class,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-selector-id,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-variable { color: #79c0ff; }
#readmd-panel[data-theme="dark"] .readmd-body .hljs-meta .hljs-string,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-regexp,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-string { color: #a5d6ff; }
#readmd-panel[data-theme="dark"] .readmd-body .hljs-built_in,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-symbol { color: #ffa657; }
#readmd-panel[data-theme="dark"] .readmd-body .hljs-code,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-comment,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-formula { color: #8b949e; }
#readmd-panel[data-theme="dark"] .readmd-body .hljs-name,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-quote,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-selector-pseudo,
#readmd-panel[data-theme="dark"] .readmd-body .hljs-selector-tag { color: #7ee787; }
`;

const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

class ReadmdPanel {
  constructor() {
    this.el = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.fileInfoEl = null;
    this.actions = {};
    this.state = null;
    this._boundDelegatedClick = this._handleDelegatedClick.bind(this);
    this._boundKeydown = this._handleKeydown.bind(this);
  }

  create(container) {
    if (!document.getElementById('readmd-style')) {
      const style = document.createElement('style');
      style.id = 'readmd-style';
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }

    if (!this.el) {
      this.el = document.createElement('aside');
      this.el.id = 'readmd-panel';
      this.el.setAttribute('role', 'complementary');
      this.el.setAttribute('aria-label', '中文翻译');
      this.el.setAttribute('tabindex', '-1');
      this.el.innerHTML = `
        <div class="readmd-resize" data-readmd-action="resize"></div>
        <div class="readmd-toolbar">
          <div class="readmd-toolbar-left">
            <ul class="readmd-seg" aria-label="显示模式">
              <li><button class="readmd-seg-btn" data-readmd-action="mode" data-mode="preview">预览</button></li>
              <li><button class="readmd-seg-btn" data-readmd-action="mode" data-mode="source">源码</button></li>
            </ul>
            <span class="readmd-fileinfo"></span>
          </div>
          <div class="readmd-toolbar-right">
            <button class="readmd-close" data-readmd-action="close" aria-label="关闭">${CLOSE_SVG}</button>
          </div>
        </div>
        <div class="readmd-content">
          <div class="readmd-body markdown-body"></div>
          <div class="readmd-footer" data-visible="false"></div>
        </div>
      `;

      this.bodyEl = this.el.querySelector('.readmd-body');
      this.footerEl = this.el.querySelector('.readmd-footer');
      this.fileInfoEl = this.el.querySelector('.readmd-fileinfo');

      this.el.addEventListener('click', this._boundDelegatedClick);
      this.el.addEventListener('keydown', this._boundKeydown);
      this._setupResize();
    }

    if (this.el.parentElement !== container) {
      container.appendChild(this.el);
    }

    this._syncTheme();
    queueMicrotask(() => this.el?.focus());
    return this;
  }

  bindActions(actions) {
    this.actions = actions || {};
    return this;
  }

  render(state) {
    if (!this.el || !this.bodyEl || !this.footerEl) {
      return;
    }

    this.state = state;
    this._syncTheme();
    this.el.style.setProperty('--readmd-width', `${Math.round(state.width || 420)}px`);
    this._syncToolbar(state);

    if (state.error) {
      this._renderError(state.error);
      this._renderFooter('');
      return;
    }

    if (!state.markdown) {
      if (state.phase === 'loading') {
        this._renderSkeleton();
      } else {
        this._renderEmpty('准备翻译', '点击“中”开始翻译当前 Markdown。');
      }
      this._renderFooter('');
      return;
    }

    if (state.mode === 'source') {
      this._renderSource(state.markdown);
    } else {
      this._renderPreview(state.markdown, state.previewHtml);
    }

    if (state.phase === 'loading' || state.phase === 'partial') {
      this._renderFooter('翻译中...');
    } else if (state.previewPending && state.mode === 'preview') {
      this._renderFooter('排版优化中...');
    } else {
      this._renderFooter('');
    }
  }

  destroy() {
    if (!this.el) {
      return;
    }
    this.el.removeEventListener('click', this._boundDelegatedClick);
    this.el.removeEventListener('keydown', this._boundKeydown);
    this.el.remove();
    this.el = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.fileInfoEl = null;
    this.state = null;
  }

  _syncTheme() {
    if (!this.el) {
      return;
    }
    const colorMode = document.documentElement.getAttribute('data-color-mode');
    const isDark = colorMode === 'dark'
      || (colorMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    this.el.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  _syncToolbar(state) {
    this.el.querySelectorAll('.readmd-seg-btn').forEach((button) => {
      button.setAttribute('aria-current', button.dataset.mode === state.mode ? 'true' : 'false');
    });
    this.fileInfoEl.textContent = this._formatFileInfo(state.markdown);
  }

  _renderSkeleton() {
    this.bodyEl.className = 'readmd-body';
    this.bodyEl.innerHTML = `
      <div class="readmd-skeleton" aria-hidden="true">
        <div class="readmd-skeleton-line"></div>
        <div class="readmd-skeleton-line"></div>
        <div class="readmd-skeleton-line"></div>
      </div>
    `;
  }

  _renderEmpty(title, text) {
    this.bodyEl.className = 'readmd-body';
    this.bodyEl.innerHTML = `
      <div class="readmd-state">
        <div class="readmd-state-title">${this._escapeHtml(title)}</div>
        <div class="readmd-state-text">${this._escapeHtml(text)}</div>
      </div>
    `;
  }

  _renderError(error) {
    const retryButton = error.retryable
      ? '<button class="readmd-action primary" data-readmd-action="retry">重试</button>'
      : '';
    const optionsButton = error.openOptions
      ? '<button class="readmd-action" data-readmd-action="open-options">前往设置</button>'
      : '';

    this.bodyEl.className = 'readmd-body';
    this.bodyEl.innerHTML = `
      <div class="readmd-state">
        <div class="readmd-state-title">${this._escapeHtml(error.title || '翻译失败')}</div>
        <div class="readmd-state-text">${this._escapeHtml(error.message || '请稍后再试。')}</div>
        <div class="readmd-state-actions">${retryButton}${optionsButton}</div>
      </div>
    `;
  }

  _renderPreview(markdown, previewHtml) {
    this.bodyEl.className = 'readmd-body markdown-body';
    if (previewHtml) {
      this.bodyEl.innerHTML = previewHtml;
    } else if (typeof marked !== 'undefined') {
      this.bodyEl.innerHTML = marked.parse(markdown, { renderer: this._renderer() });
    } else {
      this.bodyEl.innerHTML = `<pre>${this._escapeHtml(markdown)}</pre>`;
    }
    this._highlightAll();
  }

  _renderSource(markdown) {
    const lines = markdown.split('\n');
    const highlighted = this._highlightMarkdown(markdown).split('\n');
    const rows = lines
      .map((line, index) => {
        const html = highlighted[index] ?? this._escapeHtml(line);
        return `<tr>
          <td class="readmd-ln">${index + 1}</td>
          <td class="readmd-lc">${html || '&nbsp;'}</td>
        </tr>`;
      })
      .join('');

    this.bodyEl.className = 'readmd-body readmd-source';
    this.bodyEl.innerHTML = `<table class="readmd-lines"><tbody>${rows}</tbody></table>`;
  }

  _renderFooter(text) {
    this.footerEl.textContent = text || '';
    this.footerEl.dataset.visible = text ? 'true' : 'false';
  }

  _renderer() {
    const renderer = new marked.Renderer();
    renderer.code = ({ text, lang }) => {
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      }
      return `<pre><code>${this._escapeHtml(text)}</code></pre>`;
    };
    return renderer;
  }

  _highlightAll() {
    if (typeof hljs === 'undefined') {
      return;
    }
    this.bodyEl.querySelectorAll('pre code:not(.hljs)').forEach((element) => {
      hljs.highlightElement(element);
    });
  }

  _highlightMarkdown(markdown) {
    if (typeof hljs === 'undefined' || !hljs.getLanguage('markdown')) {
      return this._escapeHtml(markdown);
    }
    try {
      return hljs.highlight(markdown, { language: 'markdown' }).value;
    } catch {
      return this._escapeHtml(markdown);
    }
  }

  _formatFileInfo(markdown) {
    if (!markdown) {
      return '';
    }
    const lines = markdown.split('\n');
    const loc = lines.filter((line) => line.trim()).length;
    const bytes = new Blob([markdown]).size;
    const size = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    return `${lines.length} 行 (${loc} loc) · ${size}`;
  }

  _handleDelegatedClick(event) {
    const target = event.target.closest('[data-readmd-action]');
    if (!target) {
      return;
    }

    const action = target.dataset.readmdAction;
    if (action === 'mode') {
      this.actions.onModeChange?.(target.dataset.mode);
      return;
    }
    if (action === 'close') {
      this.actions.onClose?.();
      return;
    }
    if (action === 'retry') {
      this.actions.onRetry?.();
      return;
    }
    if (action === 'open-options') {
      this.actions.onOpenOptions?.();
    }
  }

  _handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.actions.onClose?.();
    }
  }

  _setupResize() {
    const handle = this.el.querySelector('.readmd-resize');
    let startX = 0;
    let startWidth = 0;

    const onMove = (event) => {
      const delta = startX - event.clientX;
      const width = Math.max(320, Math.min(window.innerWidth * 0.7, startWidth + delta));
      this.el.style.setProperty('--readmd-width', `${Math.round(width)}px`);
      this.actions.onResize?.(width, false);
    };

    const onUp = (event) => {
      const delta = startX - event.clientX;
      const width = Math.max(320, Math.min(window.innerWidth * 0.7, startWidth + delta));
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.actions.onResize?.(width, true);
    };

    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      startX = event.clientX;
      startWidth = this.state?.width || this.el.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

window.ReadmdPanel = ReadmdPanel;
