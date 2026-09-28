// Capture the production UI with an isolated document fixture, never a user's window.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('dist');
const out = path.resolve('docs/images');
const work = path.resolve('.build/media');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(work, { recursive: true });
const server = createServer((req, res) => {
  const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0])));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = fs.readFileSync(file);
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const failures = [];
page.on('pageerror', err => failures.push(err.message));
await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
await page.addInitScript(() => {
  const handlers = [];
  Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: {
    postMessage: () => {},
    addEventListener: (_name, fn) => handlers.push(fn),
  } } });
  window.receiveNative = data => handlers.forEach(fn => fn({ data }));
});
async function shot(name, directory = out) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(280);
  await page.screenshot({ path: path.join(directory, name + '.png'), animations: 'disabled' });
  console.log('Captured: ' + name);
}
async function load(content, name = '留一点空间，给文字.md') {
  await page.evaluate(m => window.receiveNative(m), { type: 'document', content, name, path: 'C:\\Writing\\' + name, encoding: 'UTF-8', newline: 'LF' });
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.moye);
  await shot('welcome', work);
  const sample = fs.readFileSync('examples/留一点空间，给文字.md', 'utf8').replaceAll('\r\n', '\n');
  await load(sample);
  await page.locator('#preview h1').waitFor();
  await shot('editor-light');
  await page.locator('button[data-mode=preview]').click();
  await shot('preview');
  await page.locator('button[data-mode=split]').click();
  await page.locator('#theme-button').click();
  await shot('editor-dark');
  await page.locator('#theme-button').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.locator('.cm-content').click({ button: 'right', position: { x: 285, y: 230 } });
  await page.locator('#context-menu').waitFor();
  await shot('context-menu');
  await page.keyboard.press('Escape');
  await page.locator('#file-name').click();
  await page.locator('#rename-dialog').waitFor();
  await page.locator('#rename-input').fill('今天的灵感.md');
  await shot('rename');
  await page.locator('#rename-cancel').click();
  await load('', '灵感摘录.md');
  await shot('paste-before', work);
  await page.locator('.cm-content').evaluate(el => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '把灵感留下来\n标题、加粗、列表，也一起保留。\n随手记录\n慢慢整理\n继续书写');
    clipboard.setData('text/html', '<h1>把灵感留下来</h1><p><strong>标题、加粗、列表</strong>，也一起保留。</p><h2>今天的三件小事</h2><ul><li>随手记录</li><li>慢慢整理</li><li>继续书写</li></ul><blockquote>文字，就在你选择的地方。</blockquote>');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  await page.locator('#preview h1').waitFor();
  await page.waitForTimeout(3700);
  await page.locator('button[data-mode=split]').focus();
  await shot('paste-after', work);
  await load(sample);
  await page.locator('#theme-button').click();
  await page.locator('button[data-mode=preview]').click();
  await page.locator('#focus-button').click();
  await shot('focus', work);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Screenshots complete; no script errors.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
