import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { cleanMarkdown, preparePaste } from '../src/paste.js';
import { createRenderer } from '../src/render.js';
const window = new JSDOM('').window, purify = createDOMPurify(window);
const paste = options => preparePaste(options, purify);
const render = createRenderer(purify);
test('rendered HTML headings and formatting become actual Markdown', () => {
  const result = paste({ text: '标题\n重点\n第一项', html: '<h2>标题</h2><p><strong>重点</strong></p><ul><li>第一项</li></ul>' });
  assert.ok(result.rich); assert.match(result.text, /^## 标题/); assert.match(result.text, /\*\*重点\*\*/); assert.match(result.text, /-\s+第一项/);
  assert.equal(render(result.text).headings[0].text, '标题');
});
test('CF_HTML selected fragment is converted without clipboard headers', () => {
  const result = paste({ text: '标题\n正文', html: 'Version:1.0\r\nStartHTML:000123\r\n<html><body>unselected<!--StartFragment--><h1>标题</h1><p>正文</p><!--EndFragment-->unselected</body></html>' });
  assert.equal(result.text, '# 标题\n\n正文');
});
test('GFM table, strike and checkbox rich clipboard formats survive conversion', () => {
  const result = paste({ text: 'A B 1 2', html: '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><p><del>删除</del></p><ul><li><input type="checkbox" checked>完成</li></ul>' });
  assert.match(result.text, /\| A \| B \|/); assert.match(result.text, /~~删除~~/); assert.match(result.text, /\[x\]/);
});
test('Markdown copied from a syntax-highlighted source remains unchanged', () => {
  const text = '# 标题\n\n**重点**\n\n- item\n\n```js\nlet x = 1;\n```';
  assert.equal(paste({ text, html: '<pre><code><span># 标题</span>...</code></pre>' }).text, text);
});
test('common pasted heading and list prefix artifacts are repaired', () => {
  const text = '\u200b##\u00a0标题\n＃＃第二节\n#中文标题\n-\u00a0项目\n＞ 引用\n• 项目';
  assert.equal(paste({ text }).text, '## 标题\n## 第二节\n# 中文标题\n- 项目\n> 引用\n- 项目');
});
test('a single outer Markdown code fence unwraps, nested code stays intact', () => {
  const text = '````markdown\n# 标题\n\n```js\n#no-change\n```\n````';
  assert.equal(paste({ text }).text, '# 标题\n\n```js\n#no-change\n```');
  assert.equal(paste({ text: '```md\n# demo\n```\n\n正文' }).text, '```md\n# demo\n```\n\n正文');
});
test('plain paste and paste inside code preserve the original syntax', () => {
  const text = '```markdown\n＃＃标题\n```';
  assert.equal(paste({ text, plain: true, html: '<h2>标题</h2>' }).text, text);
  assert.equal(paste({ text, inCode: true }).text, text);
});
test('format repair leaves fenced/indented code and front matter alone', () => {
  const source = '---\ntitle: x\n#注释\n---\n\n```python\n#注释\n```\n\n    #注释\n\n\t#注释\n\n##标题';
  assert.equal(cleanMarkdown(source, { explicit: true }), source.replace('##标题', '## 标题'));
});
test('literal escaped headings only change via explicit repair', () => {
  assert.equal(paste({ text: '\\# Heading\n#hashtag' }).text, '\\# Heading\n#hashtag');
  assert.equal(cleanMarkdown('\\# Heading\n##Heading', { explicit: true }), '# Heading\n## Heading');
});
test('zero-width joiners and spacing in ordinary prose survive', () => {
  const source = 'emoji 👩‍💻\nhello\u00a0world\n内\u200b文'; assert.equal(paste({ text: source }).text, source);
});
test('scripts, active HTML and dangerous links never become executable markup', () => {
  const result = paste({ text: '标题', html: '<h1>标题</h1><script>bad()</script><iframe src="https://example.com"></iframe><a href="javascript:alert(1)">safe text</a><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(result.text, /script|iframe|javascript:|onerror/);
});
test('public lyric-style fixture preserves section labels, hard-break spaces, and every word on paste', () => {
  const text = fs.readFileSync(new URL('./fixtures/line-breaks.md', import.meta.url), 'utf8');
  assert.equal(paste({ text }).text, text);
  const result = render(text, null, { preserveLineBreaks: true });
  const verse = [...result.fragment.querySelectorAll('p')].find(p => p.textContent.startsWith('[Verse 2]'));
  assert.equal(verse.querySelectorAll('br').length, 4);
  assert.ok(verse.textContent.includes('第一行保留在这里\n第二行继续写下去'));
  assert.equal(result.headings.length, 0); // Plain section labels should not be guessed as Markdown headings.
});
test('line-break preview preference does not change source or forced hard breaks', () => {
  const raw = 'one\ntwo  \nthree';
  assert.equal(render(raw).fragment.querySelectorAll('br').length, 1);
  assert.equal(render(raw, null, { preserveLineBreaks: true }).fragment.querySelectorAll('br').length, 2);
});
