/**
 * [INPUT]: chrome.storage.local
 * [OUTPUT]: Options 页交互逻辑
 * [POS]: 配置界面，独立页面
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const $ = (id) => document.getElementById(id);

$('provider').addEventListener('change', () => {
  const v = $('provider').value;
  $('volcengineFields').classList.toggle('show', v === 'volcengine');
  $('llmFields').classList.toggle('show', v === 'llm');
});

$('save').addEventListener('click', () => {
  const data = {
    provider: $('provider').value,
    llmApiKey: $('apiKey').value.trim(),
    llmBaseUrl: $('baseUrl').value.trim(),
    llmModel: $('model').value.trim(),
    volcengineAccessKeyId: $('volcAccessKeyId').value.trim(),
    volcengineSecretKey: $('volcSecretKey').value.trim(),
    volcengineRegion: $('volcRegion').value.trim()
  };
  chrome.storage.local.set(data, () => {
    $('saved').style.display = 'inline';
    setTimeout(() => { $('saved').style.display = 'none'; }, 2000);
  });
});

chrome.storage.local.get([
  'provider', 'llmApiKey', 'llmBaseUrl', 'llmModel',
  'volcengineAccessKeyId', 'volcengineSecretKey', 'volcengineRegion'
], (r) => {
  $('provider').value = r.provider || 'free';
  $('apiKey').value = r.llmApiKey || '';
  $('baseUrl').value = r.llmBaseUrl || '';
  $('model').value = r.llmModel || '';
  $('volcAccessKeyId').value = r.volcengineAccessKeyId || '';
  $('volcSecretKey').value = r.volcengineSecretKey || '';
  $('volcRegion').value = r.volcengineRegion || '';
  $('provider').dispatchEvent(new Event('change'));
});
