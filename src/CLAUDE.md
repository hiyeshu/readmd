# src/
> L2 | 父级: /CLAUDE.md

## 成员清单

- content.js: 扩展入口，胶水层。注入"中"按钮、监听 Alt+T、协调 panel 和 translator、SPA 路由检测
- panel.js: 翻译面板 UI。创建/销毁/更新面板，预览/源码双模式，拖拽调宽，暗色适配，骨架屏
- translator.js: 翻译调度。fetch raw MD、调用 markdown.js 分离格式、分批翻译、流式回调
- markdown.js: 格式保护层。protectFormatting 将链接/图片/代码替换为占位符，restoreFormatting 还原
- provider.js: 翻译 provider。FreeTranslateProvider (Google) + LlmTranslateProvider (OpenAI 兼容)
- cache.js: 缓存层。chrome.storage.local + LRU 淘汰，双层缓存 (raw MD + 翻译结果)
- background.js: MV3 Service Worker。消息路由、LLM fetch 代理、火山翻译签名代理、快捷键命令转发
- options.js: 设置页逻辑。读写 chrome.storage.local，provider 切换显隐

## 依赖关系

```
content.js → panel.js (创建面板)
content.js → translator.js (启动翻译)
translator.js → markdown.js (格式保护)
translator.js → provider.js (翻译执行)
translator.js → cache.js (缓存读写)
provider.js → background.js (网络代理，via chrome.runtime.sendMessage)
background.js → content.js (快捷键命令，via chrome.tabs.sendMessage)
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
