# Readmd 待解决问题

## 1. Alt+T 快捷键在 macOS 上无效（已改为 Ctrl/Command+Shift+Y）

**现象**: 按 Option+T 无法触发翻译面板开关

**已尝试**:
- `document.addEventListener('keydown')` + `e.code === 'KeyT'` + capture phase — GitHub 页面吞事件
- `chrome.commands` API + `"suggested_key": { "default": "Alt+T", "mac": "Alt+T" }` — 仍无效
- `chrome.runtime.onMessage` 从 background 转发命令到 content script

**可能原因**:
- Chrome 在 Mac 上 `Alt` 键映射行为不确定，`default` 里的 `Alt` 可能被转成 Command
- GitHub 页面自身快捷键系统（`t` 打开文件搜索）可能干扰
- `chrome://extensions/shortcuts` 页面需要手动确认/设置快捷键
- macOS Option+T 产生特殊字符 `†`，可能影响事件传播

**处理**:
- 已把 manifest 快捷键改为 `Ctrl+Shift+Y` / macOS `Command+Shift+Y`
- 已把页面 fallback 监听同步改为 `Ctrl/Command+Shift+Y`
- 重新加载扩展后，仍建议在 `chrome://extensions/shortcuts` 确认没有被浏览器或其他扩展占用

## 2. 源码模式没有语法高亮

**现象**: 翻译面板"源码"模式行号正常，但内容全是纯黑色文本，没有 Markdown 语法着色（标题、链接、代码块等无颜色区分）

**原因**: 源码模式用 `textContent` 逐行填充，未做任何语法着色

**方案**:
- 用 highlight.js 的 `markdown` 语言对源码内容做高亮
- 或手写轻量正则着色（`#` 标题、`[]()` 链接、`` ` `` 代码、`**` 加粗）
- 左侧 GitHub 原生代码视图有着色，右侧应保持一致体验
