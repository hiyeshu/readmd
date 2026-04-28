# Readmd - GitHub Markdown 中文双语阅读扩展
Chrome MV3 + Vanilla JS + marked.js + highlight.js

<directory>
src/ - 运行时核心，页面识别、翻译调度、面板渲染、缓存与配置 (8 文件: background, cache, content, markdown, options, panel, provider, translator)
lib/ - 第三方运行库与 GitHub 风格样式 (6 文件: marked, highlight, markdown css, highlight themes)
icons/ - 扩展图标资源 (1 文件: icon.png)
test/ - Node 原生回归测试，守住页面上下文、Markdown 重建、缓存键与错误分类 (1 文件: readmd.test.js)
</directory>

<config>
manifest.json - MV3 清单、权限、content scripts 顺序与快捷键
popup.html - 扩展弹窗，复用 options.js 进行 provider 配置
options.html - 独立设置页，维护翻译 provider 与密钥
DESIGN.md - 视觉方向参考与界面语言约束
ISSUES.md - 已知问题与排查记录
PLAN.md - 产品目标、交互规格与成功标准
</config>

架构决策
- `content.js` 是单一状态源：管理页面会话、按钮注入、面板挂载、任务取消、GitHub SPA 同步
- `translator.js` 只负责“拿原文 + 命中缓存 + 分批翻译 + 增量回调”，不再猜 URL，不再直接碰 UI
- `panel.js` 是纯渲染器：`create` / `bindActions` / `render` / `destroy`，由状态驱动
- 文件级缓存按 `provider/model + raw markdown hash` 命中，避免同路径内容更新后读旧译文
- 错误统一收口为 `NO_TEXT` / `AUTH` / `TIMEOUT` / `RATE_LIMIT` / `NETWORK` / `UNKNOWN`

开发规范
- 交互语言：中文
- 注释：中文 + ASCII 分块
- 测试：优先纯函数与无依赖回归测试，命令 `node --test readmd/test/*.test.js`

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
