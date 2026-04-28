# src/
> L2 | 父级: /CLAUDE.md

## 成员清单

- background.js: MV3 Service Worker。消息路由、LLM fetch 代理、GitHub Markdown 渲染代理、火山翻译签名代理、快捷键命令转发
- cache.js: 缓存与键模型。chrome.storage.local + LRU，提供文本缓存键、文件缓存键、namespace 构造
- content.js: 单一页面状态源。解析 GitHub Markdown 页、注入"中"按钮、挂载面板、取消/重试翻译、同步 UI 偏好
- markdown.js: 格式保护与重建层。抽取可翻译节点，保留标题/列表/表格/行内格式并按行元数据重建
- options.js: 设置页逻辑。读写 chrome.storage.local，provider 切换显隐
- panel.js: 状态驱动渲染器。`create/bindActions/render/destroy`，支持源码高亮、重试、前往设置、Esc 关闭、拖拽宽度
- provider.js: 翻译 provider 与错误模型中心。Free / Volcengine / LLM 三类实现，统一错误分类
- translator.js: 可取消翻译调度。优先 fetch Raw，命中文本/文件缓存，分批翻译并增量回调 UI

## 依赖关系

```
content.js → panel.js (状态驱动渲染)
content.js → translator.js (启动/取消翻译任务)
content.js → provider.js (错误分类与 Options 跳转)
translator.js → markdown.js (抽取与重建)
translator.js → provider.js (配置、provider、错误标准化)
translator.js → cache.js (文本/文件缓存)
provider.js → background.js (网络代理，via chrome.runtime.sendMessage)
background.js → content.js (快捷键命令，via chrome.tabs.sendMessage)
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
