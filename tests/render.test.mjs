import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { createRenderer, wordCount } from '../src/render.js';
const window = new JSDOM('').window;
const render = createRenderer(createDOMPurify(window));
const html = (text, base) => { const r = render(text, base); const el = window.document.createElement('div'); el.append(r.fragment); return { ...r, el }; };
test('common Markdown and GFM structures render', () => {
  const { el, headings } = html('# 标题\n\n**粗体** *斜体* ~~删除~~\n\n- [x] 完成\n- [ ] 待办\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```');
  assert.equal(el.querySelector('h1').textContent, '标题'); assert.equal(headings[0].line, 1);
  assert.ok(el.querySelector('strong')); assert.ok(el.querySelector('em')); assert.ok(el.querySelector('s'));
  assert.equal(el.querySelectorAll('input[disabled]').length, 2); assert.ok(el.querySelector('table')); assert.ok(el.querySelector('pre code'));
});
test('front matter is excluded from preview without losing outline line positions', () => {
  const { el, headings, frontMatter } = html('---\ntitle: secret\n---\n\n# Visible\n\nText');
  assert.ok(frontMatter); assert.ok(!el.textContent.includes('secret')); assert.equal(headings[0].line, 5);
});
test('footnote markup renders with anchors', () => {
  const { el } = html('正文[^1]\n\n[^1]: 脚注说明'); assert.ok(el.textContent.includes('脚注说明')); assert.ok(el.querySelector('a.footnote-ref') || el.querySelector('.footnote-ref a'));
});
test('script, event handler, form, SVG and embedded document payloads are removed', () => {
  const { el } = html('<script>window.pwned=1</script><img src=x onerror=alert(1)><iframe src="https://example.com"></iframe><svg onload=alert(1)></svg><form><input value=bad><button>go</button></form><p style="background:url(https://example.com)">safe</p>');
  assert.equal(el.querySelectorAll('script,iframe,svg,form,button,input,[onerror],[style]').length, 0);
});
test('remote images cannot initiate requests and local paths are scoped', () => {
  const base = 'https://document.moye.local/token/';
  const { el } = html('![remote](https://example.com/tracker.png)\n![local](images/a.png)\n![escape](../secret.png)\n<img src="//example.com/a" srcset="https://example.com/a 1x">\n![encoded](%2e%2e/secret.png)', base);
  assert.equal(el.querySelectorAll('img').length, 1); assert.equal(el.querySelector('img').src, base + 'images/a.png'); assert.equal(el.querySelectorAll('.image-placeholder').length, 4);
});
test('Chinese relative image paths and safe embedded raster images remain usable', () => {
  const { el } = html('![中文](图片/示例.png)\n<img src="data:image/png;base64,YQ==">', 'https://document.moye.local/token/'); assert.equal(el.querySelectorAll('img').length, 2);
});
test('dangerous links and network-bearing attributes are stripped', () => {
  const { el } = html('<a href="javascript:alert(1)" ping="https://example.com/ping">bad</a><a href="https://example.com" target="_blank">link</a>');
  assert.equal(el.querySelector('a').getAttribute('href'), null); assert.equal(el.querySelectorAll('[ping],[target]').length, 0);
});
test('unsupported dialect source is never mutated and headings in code are not outline entries', () => {
  const source = '[[Wiki]]\n\n$$ x^2 $$\n\n```mermaid\n# not heading\ngraph TD; A-->B\n```\n\n## Real'; const before = source;
  const { el, headings } = html(source); assert.equal(source, before); assert.equal(headings.length, 1); assert.ok(el.textContent.includes('graph TD'));
});
test('Chinese and English words are counted without Markdown punctuation', () => { assert.equal(wordCount('# 你好，世界！Hello world 2026'), 7); assert.equal(wordCount(''), 0); });
