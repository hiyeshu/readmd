# Readmd — GitHub Markdown 双语阅读器

浏览器扩展。在 GitHub 上阅读英文 Markdown 时，右侧展开中文翻译面板。
不是网页汉化，是技术文档翻译——保留代码块、表格、公式，只翻自然语言。

## 核心体验

| 元素 | 设计 |
|------|------|
| 触发 | 文件预览页顶部工具栏"中"按钮；快捷键 Ctrl/Cmd+Shift+T |
| 面板 | 主内容区右侧，可拖拽调宽度（300px–60%），记忆偏好 |
| 内容 | 中文 Markdown 渲染（预览模式）或 Markdown 源码（源码模式） |
| 同步 | 左侧切"预览/源码"时，右侧自动同步 |
| 滚动 | 两栏独立滚动，不强制同步 |
| 默认 | 收起。刷新或路由切换后保持上次展开/收起状态 |

## 技术路线

Chrome Manifest V3 浏览器扩展。

| 组件 | 职责 |
|------|------|
| Content Script | 注入按钮、构建右侧面板、提取文本、DOM 克隆与替换、监听视图切换 |
| Background Service Worker | API 代理（fetch 不受 CORS）、配置读取、缓存读写 |
| Options Page | Provider 配置（API Key、Base URL、Model） |

数据流：

```
用户点击"中" → 检测当前视图 → 提取可翻译文本 → 去重
    ↓ sendMessage
Background → provider.translateBatch() → fetch(API)
    ↓
Content Script → 构建 Shadow DOM → 插入翻译后的渲染内容
```

## 平台适配（首期）

| 平台 | 场景 | 原文提取容器 |
|------|------|-------------|
| GitHub | Markdown 文件预览 | `.markdown-body` |
| GitHub | Markdown 文件源码 | `.blob-wrapper .blob-code` |

GitLab 后续扩展。

## 翻译与格式保护

复用 md-translator-zh 核心逻辑：

- `MarkdownProcessor.protectFormatting()` — 保护 `**`、`*`、`` ` ``、链接等标记
- `translationProviders` — 三个 Provider，改为 fetch + Web Crypto
- `translationManager` — 批量调度、重试、缓存

跳过不译：代码块（`pre > code`）、行内代码、链接 URL。

## 缓存

`chrome.storage.local`，key 为 `md5(原文)`，namespace 为 `provider:zh-CN`。

## 样式策略

右侧面板内部用 Shadow DOM 隔离：

- 面板外壳（边框、拖拽把手、按钮栏）：扩展 CSS
- 面板内容（Markdown 渲染）：复制 GitHub `.markdown-body` 基础样式，中文渲染与原文视觉一致

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| GitHub DOM 变更 | 防御性检测，找不到容器时静默失败 |
| SPA 路由切换 | MutationObserver + history 监听，内容变化自动收起面板 |
| 大文件性能 | 首期不解决，未来可分片渲染 |
| 私有仓库/企业版 | 用户有权限看到的内容扩展才能看到，无额外风险 |

## 与 VS Code 扩展的关系

互补：

- **md-translator-zh**（VS Code）：编辑时翻译，输出新文件
- **Readmd**（浏览器）：阅读时翻译，不修改文件



api已有参考：，/Users/yeshu/Desktop/yeshu/md-translator-zh

## UI 设计规格

### "中"触发按钮
- 位置：GitHub 文件工具栏（Raw/Blame/Edit 同行）末尾
- 样式：复用 GitHub 原生按钮样式，文字"中"
- 快捷键：Ctrl/Cmd+Shift+T
- 窗口 < 768px 时隐藏（全屏覆盖模式通过快捷键触发）

### 翻译面板
- 桌面（≥768px）：右侧面板，固定 400px 宽，v2 可拖拽
- 移动（<768px）：全屏覆盖，header 加「← 返回原文」按钮
- 打开动画：右侧滑入 200ms ease-out，GitHub 主内容区同步收窄
- 关闭动画：滑出 150ms ease-in
- 左边缘阴影：`rgba(0,0,0,0.08) -1px 0 0 0, rgba(0,0,0,0.04) -4px 0 8px 0`

### 面板 Header（32px 高）
- 左侧：「预览 | 源码」tab 切换
  - Active tab：Geist 14px weight 600，#171717，底部 2px #171717 指示线
  - Inactive tab：Geist 14px weight 500，#666666
- 右侧：关闭按钮（X），16px，#666666，hover #171717
- 底部：shadow-border `rgba(0,0,0,0.08) 0px 0px 0px 1px`

### 面板内容区
- 背景：#ffffff
- 翻译文本：PingFang SC / Microsoft YaHei，16px，#171717，行高 1.6
- 代码块：Geist Mono 14px，#fafafa 背景，shadow-border
- 独立滚动，与左侧原文不联动

### 交互状态

| 状态 | 用户看到什么 |
|------|-------------|
| 加载中 | 3 行灰色骨架屏（#ebebeb），脉冲动画 0.8s |
| 流式渲染 | 已翻译段落逐批出现，底部"翻译中..."灰色文字 |
| 完成 | 完整中文 Markdown 渲染 |
| 缓存命中 | 直接渲染，无骨架屏 |
| 空文档 | "这个文件是空的"，#666666 |
| 纯代码 | "没有可翻译的文本"，#666666 |
| 网络错误 | "网络连接失败" + [重试] 按钮 |
| API Key 无效 | "API Key 无效" + [前往设置] 按钮 |
| 超时 | "翻译超时" + [重试] 按钮 |
| 429 限流 | 静默重试，3 次失败后 "服务繁忙，请稍后重试" |
| 部分失败 | 成功段落正常，失败段落显示 "此段翻译失败 [重试]" |

### 首次使用
- 默认提供免费翻译额度，零配置即可使用
- 免费额度用完后面板显示"免费额度已用完" + [前往设置] 按钮
- Options 页配置自定义 Provider

### 无障碍
- 面板 role="complementary"，aria-label="中文翻译"
- Tab/关闭按钮支持键盘导航
- 面板打开时 focus 移入，关闭时 focus 返回触发按钮

## 成功标准

- [ ] GitHub 任意 Markdown 文件页，点击"中"3 秒内显示右侧面板
- [ ] 左侧切"预览/源码"时右侧自动同步
- [ ] 代码块、表格、链接、图片在右侧面板完全保留格式
- [ ] 宽度可拖拽调整，记忆偏好
