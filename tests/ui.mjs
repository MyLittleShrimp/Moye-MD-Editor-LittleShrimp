import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('dist');
fs.mkdirSync('test-results', { recursive: true });
const server = createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const bytes = fs.readFileSync(file); res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'); res.end(bytes); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, deviceScaleFactor: 1 });
const errors = [], requests = [];
page.on('pageerror', err => errors.push(err.message));
page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:')) requests.push(req.url()); });
await page.addInitScript(() => {
  window.messages = []; window.nativeHandlers = []; window.testClipboard = { text: '', html: '' };
  Object.defineProperty(window, 'chrome', { value: { webview: {
    postMessage: m => {
      window.messages.push(m);
      if (m.type === 'clipboardWrite' || m.type === 'clipboardRead') {
        if (window.failClipboard) { queueMicrotask(() => window.receiveNative({ type: 'clipboardResult', id: m.id, ok: false, message: '测试：剪贴板不可用' })); return; }
        if (m.type === 'clipboardWrite') window.testClipboard = { text: m.text, html: '' };
        queueMicrotask(() => window.receiveNative({ type: 'clipboardResult', id: m.id, ok: true, ...window.testClipboard }));
      }
    },
    addEventListener: (name, handler) => window.nativeHandlers.push(handler),
  } }, configurable: true });
  window.receiveNative = m => window.nativeHandlers.forEach(fn => fn({ data: m }));
});
let checks = 0;
const check = (value, name) => { assert.ok(value, name); checks++; console.log('PASS:', name); };
const receive = message => page.evaluate(m => window.receiveNative(m), message);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.messages?.some(m => m.type === 'ready'));
  await page.screenshot({ path: 'test-results/welcome.png' });
  check(await page.locator('#welcome').isVisible(), 'welcome screen renders');
  check(await page.locator('svg').count() > 20, 'icons render');
  await page.locator('#welcome [data-command=open]').click();
  check(await page.evaluate(() => window.messages.at(-1).type === 'open'), 'Open sends native file-dialog command');
  await page.keyboard.press('Control+n');
  check(await page.evaluate(() => window.messages.at(-1).type === 'new'), 'New shortcut');
  const sample = fs.readFileSync('examples/慢一点，把想法写下来.md', 'utf8').replaceAll('\r\n', '\n');
  await receive({ type: 'document', content: sample, name: '慢一点，把想法写下来.md', path: 'D:\\Documents\\慢一点，把想法写下来.md', encoding: 'UTF-8', newline: 'LF', imageBase: 'https://document.moye.local/token/' });
  await page.locator('#preview h1').waitFor();
  check(await page.locator('.outline-item').count() === 4, 'outline reflects headings and ignores front matter');
  check(await page.locator('#preview table').count() === 1, 'GFM table renders in desktop layout');
  await page.screenshot({ path: 'test-results/editor-light.png' });
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n测试保存 😀');
  check(await page.locator('#dirty-dot').isVisible(), 'editing marks document unsaved');
  await page.keyboard.press('Control+s');
  check(await page.evaluate(() => window.messages.at(-1).type === 'save' && window.messages.at(-1).content.endsWith('测试保存 😀')), 'Save sends latest text including Unicode');
  const modified = await page.evaluate(() => window.moye.content());
  await receive({ type: 'saved', content: modified, name: '新文件.md', path: 'D:\\Documents\\新文件.md', encoding: 'UTF-8', newline: 'LF', imageBase: 'https://document.moye.local/token/' });
  check(await page.locator('#dirty-dot').isHidden(), 'save acknowledgement clears unsaved marker');
  await page.keyboard.press('Control+Shift+s');
  check(await page.evaluate(() => window.messages.at(-1).type === 'saveAs'), 'Save As shortcut');
  await page.keyboard.press('Control+z'); check(await page.locator('#dirty-dot').isVisible(), 'undo after save marks modified correctly');
  await page.keyboard.press('Control+y'); check(await page.locator('#dirty-dot').isHidden(), 'redo to saved content clears modified correctly');
  await page.locator('[data-mode=preview]').click(); check(await page.locator('.source-pane').isHidden(), 'preview-only mode');
  await page.keyboard.press('Control+f'); check(await page.locator('.cm-search').isVisible(), 'search from preview restores editor');
  await page.keyboard.press('Escape');
  await page.locator('[data-mode=edit]').click(); check(await page.locator('.preview-pane').isHidden(), 'edit-only mode');
  await page.locator('[data-mode=split]').click();
  await page.locator('#theme-button').click(); check(await page.locator('html').getAttribute('data-theme') === 'dark', 'dark theme');
  await page.screenshot({ path: 'test-results/editor-dark.png' });
  await page.locator('#focus-button').click(); check(await page.locator('.app-header').isHidden(), 'focus mode');
  await page.keyboard.press('Escape'); check(await page.locator('.app-header').isVisible(), 'Escape exits focus mode');
  await page.locator('#theme-button').click();
  await page.locator('#save-options').click(); check(await page.locator('#save-menu').isVisible(), 'Save menu');
  await page.locator('#save-menu [data-command=saveAs]').click(); check(await page.evaluate(() => window.messages.at(-1).type === 'saveAs'), 'Save As menu command');
  await page.locator('#help-button').click(); check(await page.locator('#help-dialog').isVisible(), 'help dialog'); await page.locator('#close-help').click();
  await page.setViewportSize({ width: 804, height: 540 });
  await page.screenshot({ path: 'test-results/editor-small.png' });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'minimum width avoids horizontal overflow');
  check(await page.locator('[data-command=save]').first().isVisible(), 'save button remains visible at minimum size');
  await page.setViewportSize({ width: 1240, height: 820 });
  const source = () => page.evaluate(() => window.moye.content());
  const load = content => receive({ type: 'document', content, name: '操作测试.md', path: 'D:\\Documents\\操作测试.md', encoding: 'UTF-8', newline: 'LF' });
  const pasteEvent = (text, html = '') => page.locator('.cm-content').evaluate((el, data) => {
    const clipboard = new DataTransfer(); clipboard.setData('text/plain', data.text); clipboard.setData('text/html', data.html);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, { text, html });
  const contextItem = name => page.locator('#context-menu').getByRole('menuitem', { name });
  await load('# 原稿\n\n可剪切文字'); await page.locator('.cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('.cm-content').click({ button: 'right' });
  check(await page.locator('#context-menu').isVisible(), 'editor has custom context menu');
  await page.screenshot({ path: 'test-results/context-menu.png' });
  await contextItem(/^复制\s*Ctrl C$/).click();
  check(await page.evaluate(() => window.testClipboard.text) === '# 原稿\n\n可剪切文字', 'right-click Copy preserves and copies the selection');
  await page.locator('.cm-content').click({ button: 'right' }); await contextItem(/^剪切/).click();
  check(await source() === '', 'right-click Cut deletes only after clipboard succeeds');
  await page.locator('.cm-content').click({ button: 'right' }); await contextItem(/^撤销/).click();
  check(await source() === '# 原稿\n\n可剪切文字', 'context-menu Undo restores cut text');
  await page.keyboard.press('Control+a'); await page.evaluate(() => window.failClipboard = true);
  await page.locator('.cm-content').click({ button: 'right' }); await contextItem(/^剪切/).click();
  check(await source() === '# 原稿\n\n可剪切文字', 'clipboard failure cannot delete selected text');
  await page.evaluate(() => window.failClipboard = false);
  await load(''); await pasteEvent('网页标题\n重点', '<h2>网页标题</h2><p><strong>重点</strong></p>');
  await page.waitForFunction(() => document.querySelector('#preview h2')?.textContent === '网页标题');
  check((await source()).startsWith('## 网页标题') && (await source()).includes('**重点**'), 'Ctrl+V paste handler retains rich headings and emphasis');
  await page.keyboard.press('Control+z'); check(await source() === '', 'converted paste is one undo step');
  await page.evaluate(() => window.testClipboard = { text: '＃＃原样', html: '<h2>原样</h2>' });
  await page.keyboard.press('Control+Shift+v'); check(await source() === '＃＃原样', 'Ctrl+Shift+V preserves raw pasted text');
  await load(''); await page.evaluate(() => window.testClipboard = { text: '菜单标题', html: '<h1>菜单标题</h1>' });
  await page.locator('.cm-content').click({ button: 'right' }); await contextItem(/^粘贴\s*Ctrl V$/).click();
  check(await source() === '# 菜单标题', 'right-click Paste uses native clipboard HTML');
  await load('```js\n\n```'); await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown');
  await pasteEvent('#中文注释'); check((await source()).includes('\n#中文注释\n'), 'pasting inside code never rewrites heading-like text');
  await load('\\# Heading\n＃＃标题'); await page.locator('.cm-content').click({ button: 'right' }); await contextItem('整理 Markdown 格式').click();
  check(await source() === '# Heading\n## 标题', 'explicit repair fixes escaped and full-width headings');
  await page.keyboard.press('Control+z'); check(await source() === '\\# Heading\n＃＃标题', 'explicit repair can be undone');
  await page.locator('#file-name').click(); check(await page.locator('#rename-dialog').isVisible(), 'clicking title opens rename dialog');
  await page.locator('#rename-input').fill('新的名称.md'); await page.locator('#rename-submit').click();
  check(await page.evaluate(() => window.messages.at(-1).type === 'rename' && window.messages.at(-1).name === '新的名称.md'), 'rename sends filename and latest content');
  await receive({ type: 'renameError', message: '同名文件已经存在' });
  check(await page.locator('#rename-error').textContent() === '同名文件已经存在' && await page.locator('#rename-dialog').isVisible(), 'rename errors remain visible without discarding edits');
  await page.locator('#rename-input').fill('另一名称.md'); await page.locator('#rename-submit').click();
  await receive({ type: 'renamed', name: '另一名称.md', path: 'D:\\Documents\\另一名称.md' });
  check(await page.locator('#file-name').textContent() === '另一名称.md' && await source() === '\\# Heading\n＃＃标题', 'rename updates title without replacing editor content');
  await page.keyboard.press('Control+y'); check(await source() === '# Heading\n## 标题', 'rename retains undo/redo history');
  await page.locator('#current-document').click({ button: 'right' }); await contextItem(/^重命名文件/).click();
  check(await page.locator('#rename-dialog').isVisible(), 'sidebar right-click exposes Rename'); await page.locator('#rename-cancel').click();
  await page.keyboard.press('F2'); check(await page.locator('#rename-dialog').isVisible(), 'F2 opens Rename'); await page.keyboard.press('Escape');
  await page.locator('[data-mode=preview]').click(); await page.locator('#preview').click({ button: 'right' });
  check(await contextItem('复制 Markdown 源码').isVisible() && await contextItem(/^剪切/).count() === 0, 'preview menu exposes read-only copy actions');
  await contextItem('复制 Markdown 源码').click(); check(await page.evaluate(() => window.testClipboard.text) === '# Heading\n## 标题', 'preview can copy original Markdown');
  await page.locator('[data-mode=split]').click();
  await load('换行演示\n\n[Verse 2]\n第一行保留在这里\n第二行继续写下去');
  check(await page.locator('#preview br').count() === 2, 'lyrics preserve each source line by default');
  await page.locator('#line-breaks-toggle').click();
  check(await page.locator('#preview br').count() === 0, 'standard Markdown line-break mode is available');
  await page.locator('#line-breaks-toggle').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home');
  await page.locator('.cm-content').dispatchEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 210 });
  await contextItem('设为一级标题').click();
  check((await source()).startsWith('# 换行演示'), 'plain song title can be explicitly set to H1');
  await page.locator('.cm-content').dispatchEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 210 });
  await contextItem('设为二级标题').click();
  check((await source()).startsWith('## 换行演示'), 'changing heading level replaces the old prefix');
  await page.locator('#file-name').click();
  await page.locator('#rename-input').click({ button: 'right' });
  check(await contextItem(/^粘贴\s*Ctrl V$/).isVisible(), 'rename field context menu remains above the modal');
  await page.keyboard.press('Escape'); await page.locator('#rename-cancel').click();
  await receive({ type: 'document', content: '# 离线\n\n![remote](https://example.com/tracking.png)\n\n<script>window.pwned=1</script>\n\n[external](https://example.com)', name: 'offline.md', path: 'D:\\offline.md', encoding: 'UTF-8', newline: 'LF', imageBase: 'https://document.moye.local/token/' });
  check(await page.locator('.image-placeholder').count() === 1, 'remote image has offline placeholder');
  check(!(await page.evaluate(() => window.pwned)), 'Markdown scripts do not execute');
  await page.locator('#preview a').click(); check(await page.locator('#toast').textContent() === '离线模式：外部链接不会打开。可在源码中复制链接。', 'external links remain offline');
  check(requests.length === 0, 'no remote network requests');
  check(errors.length === 0, 'no JavaScript exceptions: ' + errors.join('; '));
  console.log(`UI checks passed: ${checks}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
