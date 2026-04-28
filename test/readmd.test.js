const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScripts(files, extra = {}) {
  const sandbox = {
    window: { innerWidth: 1440 },
    console,
    URL,
    URLSearchParams,
    Blob,
    setTimeout,
    clearTimeout,
    ...extra
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  files.forEach((file) => {
    const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  });

  return sandbox.window;
}

test('markdown 重建保留标题、列表、表格与代码块', () => {
  const { ReadmdMarkdown } = loadScripts(['src/markdown.js']);
  const markdown = [
    '# Title with [link](https://a.com)',
    '',
    '- item one',
    '- item two with `code` and **bold**',
    '',
    '| col1 | col2 |',
    '| --- | --- |',
    '| [a](u) | text |',
    '',
    '```js',
    'const a = 1',
    '```',
    '',
    'plain paragraph'
  ].join('\n');

  const translated = ReadmdMarkdown.extractTextNodes(markdown).map((node) => {
    const mapping = {
      'Title with [link](https://a.com)': '中文标题 {{MD0}}',
      'item one': '条目一',
      'item two with `code` and **bold**': '条目二，带有 {{MD0}} 和 {{MD1}}粗体{{MD2}}',
      col1: '列一',
      col2: '列二',
      '[a](u)': '{{MD0}}',
      text: '文本',
      'plain paragraph': '普通段落'
    };
    return { ...node, value: mapping[node.original] || node.value };
  });

  const result = ReadmdMarkdown.reconstructMarkdown(markdown, translated);

  assert.match(result, /^# 中文标题 \[link\]\(https:\/\/a\.com\)$/m);
  assert.match(result, /^- 条目一$/m);
  assert.match(result, /^- 条目二，带有 `code` 和 \*\*粗体\*\*$/m);
  assert.match(result, /^\| 列一 \| 列二 \|$/m);
  assert.match(result, /^\| \[a\]\(u\) \| 文本 \|$/m);
  assert.match(result, /```js\nconst a = 1\n```/);
  assert.match(result, /普通段落$/);
});

test('文件缓存键随原文内容变化而变化', () => {
  const { ReadmdCache } = loadScripts(['src/cache.js']);
  const namespace = ReadmdCache.makeNamespace('free', 'default');

  assert.equal(
    ReadmdCache.fileCacheKey(namespace, '# heading'),
    ReadmdCache.fileCacheKey(namespace, '# heading')
  );
  assert.notEqual(
    ReadmdCache.fileCacheKey(namespace, '# heading'),
    ReadmdCache.fileCacheKey(namespace, '# heading changed')
  );
});

test('页面上下文解析兼容带斜杠分支与源码视图', () => {
  const { ReadmdContent } = loadScripts(['src/content.js']);

  const context = ReadmdContent.buildPageContext({
    href: 'https://github.com/a/b/blob/feature/x/docs/README.md',
    pathname: '/a/b/blob/feature/x/docs/README.md',
    rawHref: '/a/b/raw/feature/x/docs/README.md',
    hasMarkdownPreview: false,
    hasSourceLines: true,
    viewMode: 'source'
  });

  assert.deepEqual(
    {
      repoContext: context.repoContext,
      viewMode: context.viewMode,
      pageKey: context.pageKey,
      rawHref: context.rawHref
    },
    {
      repoContext: 'a/b',
      viewMode: 'source',
      pageKey: 'https://github.com/a/b/blob/feature/x/docs/README.md',
      rawHref: 'https://github.com/a/b/raw/feature/x/docs/README.md'
    }
  );

  const previewContext = ReadmdContent.buildPageContext({
    href: 'https://github.com/a/b/blob/main/README',
    pathname: '/a/b/blob/main/README',
    rawHref: '/a/b/raw/main/README',
    hasMarkdownPreview: true,
    hasSourceLines: false,
    viewMode: 'preview'
  });

  assert.equal(previewContext.viewMode, 'preview');
  assert.equal(previewContext.filename, 'README');
});

test('错误分类覆盖鉴权、超时、限流和网络失败', () => {
  const { ReadmdProvider } = loadScripts(['src/provider.js']);

  assert.equal(
    ReadmdProvider.normalizeError(new Error('LLM API Key 还没配置')).code,
    ReadmdProvider.ERROR_CODES.AUTH
  );
  assert.equal(
    ReadmdProvider.normalizeError(new Error('原文获取超时')).code,
    ReadmdProvider.ERROR_CODES.TIMEOUT
  );
  assert.equal(
    ReadmdProvider.normalizeError(new Error('HTTP 429 rate limit')).code,
    ReadmdProvider.ERROR_CODES.RATE_LIMIT
  );
  assert.equal(
    ReadmdProvider.normalizeError(new Error('Failed to fetch')).code,
    ReadmdProvider.ERROR_CODES.NETWORK
  );
});
