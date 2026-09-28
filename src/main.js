import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import DOMPurify from 'dompurify';
import { createIcons, FilePlus2, FolderOpen, Save, ChevronDown, FileText, PanelLeft, PanelLeftClose, Search, Moon, Sun, List, Clock3, ArrowUpRight, Bold, Italic, Heading2, Link, Code2, ListChecks, Quote, Table2, Undo2, Redo2, Maximize2, Minimize2, X, Check, ArrowLeft, Keyboard, MoreHorizontal, ShieldCheck, Feather, Image, Download, Ellipsis, RotateCcw } from 'lucide';
import { createRenderer, wordCount } from './render.js';
import { installInteractions } from './interactions.js';
import './style.css';

const icons = { FilePlus2, FolderOpen, Save, ChevronDown, FileText, PanelLeft, PanelLeftClose, Search, Moon, Sun, List, Clock3, ArrowUpRight, Bold, Italic, Heading2, Link, Code2, ListChecks, Quote, Table2, Undo2, Redo2, Maximize2, Minimize2, X, Check, ArrowLeft, Keyboard, MoreHorizontal, ShieldCheck, Feather, Image, Download, Ellipsis, RotateCcw };
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.65 } });
const $ = (selector) => document.querySelector(selector);
const render = createRenderer(DOMPurify);
const bridge = window.chrome?.webview;
let view, interactions, savedText = '', active = false, current = { name: '未命名.md', path: null, encoding: 'UTF-8', newline: 'CRLF', imageBase: null };
let mode = localStorage.getItem('moye-mode') || 'split';
if (!['edit', 'split', 'preview'].includes(mode)) mode = 'split';
let sidebar = localStorage.getItem('moye-sidebar') !== 'false', focusMode = false;
let preserveLineBreaks = localStorage.getItem('moye-line-breaks') !== 'false';
let recentPaths = [], outline = [], renderTimer, toastTimer, syncing = false;
const theme = new Compartment();
let dark = localStorage.getItem('moye-theme') === 'dark';
document.documentElement.dataset.theme = dark ? 'dark' : 'light';

document.querySelector('#app').innerHTML = `
<header class="app-header">
  <button class="brand" id="home-button" title="墨页 · 本地 Markdown 编辑器" aria-label="墨页帮助">
    <span class="brand-mark">${icon('feather')}</span><span class="brand-name">墨页<span>MOYE</span></span>
  </button>
  <div class="header-divider"></div>
  <div class="document-identity"><span class="file-symbol">${icon('file-text')}</span><button id="file-name" title="点击重命名 · F2">一个安静的书写空间</button><button id="rename-button" class="icon-button document-only" title="重命名文件 · F2" aria-label="重命名文件">${icon('more-horizontal')}</button><span id="dirty-dot" hidden></span><span id="local-badge">本地文件</span></div>
  <div class="header-actions">
    <button class="button subtle" data-command="new" title="新建 · Ctrl+N">${icon('file-plus-2')}<span>新建</span></button>
    <button class="button subtle" data-command="open" title="打开 · Ctrl+O">${icon('folder-open')}<span>打开</span></button>
    <div class="save-group document-only"><button class="button primary" data-command="save" title="保存 · Ctrl+S">${icon('save')}<span>保存</span></button><button class="save-chevron" id="save-options" title="更多保存选项" aria-label="更多保存选项" aria-expanded="false">${icon('chevron-down')}</button></div>
  </div>
</header>
<main class="shell">
  <aside class="sidebar">
    <div class="sidebar-top"><span>工作空间</span><button class="icon-button" id="hide-sidebar" title="收起侧栏 · Ctrl+\\" aria-label="收起侧栏">${icon('panel-left-close')}</button></div>
    <button class="nav-item active" id="current-document">${icon('file-text')}<span>开始书写</span><span class="tiny-dot"></span></button>
    <div class="sidebar-section"><div class="section-label">${icon('list')}<span>文档大纲</span><span id="heading-count"></span></div><nav id="outline" aria-label="文档大纲"><p class="sidebar-empty">用标题，让想法有迹可循。</p></nav></div>
    <div class="sidebar-section recent-section"><div class="section-label">${icon('clock-3')}<span>最近打开</span></div><div id="recent-files"></div></div>
    <div class="sidebar-bottom"><span class="offline-dot"></span><span>只在本地，安心书写</span>${icon('shield-check')}</div>
  </aside>
  <section class="workspace">
    <div id="welcome" class="welcome">
      <div class="welcome-content">
        <div class="eyebrow"><span></span> JUST YOU & YOUR WORDS</div>
        <div class="welcome-illustration" aria-hidden="true"><div class="paper paper-back"></div><div class="paper paper-front"><span class="paper-heading"></span><span></span><span></span><span class="paper-short"></span><div class="paper-check">✓<span></span></div><div class="paper-check">✓<span></span></div><div class="paper-signature">m.</div></div><div class="floating-feather">${icon('feather')}</div><span class="illustration-dot"></span></div>
        <h1>留一点空间，给文字。</h1>
        <p>打开一份文档，或从空白开始。<br>你的文字，就在你选择的地方。</p>
        <div class="welcome-actions"><button class="button primary large" data-command="open">${icon('folder-open')}打开 Markdown 文件<span class="key-hint">Ctrl O</span></button><button class="button secondary large" data-command="new">${icon('file-plus-2')}新建文档</button></div>
        <div class="drop-hint">也可以把文件拖到这里 <span>·</span> .md / .markdown / 纯文本</div>
        <div class="welcome-rule"></div>
        <div class="welcome-details"><span>${icon('file-text')}直接读写原文件</span><span>${icon('shield-check')}无需账户与网络</span><span>${icon('feather')}专注每一次表达</span></div>
      </div>
      <button class="welcome-help" id="welcome-help">第一次使用？看看快捷键 ${icon('arrow-up-right')}</button>
    </div>
    <div id="document-area" hidden>
      <div class="editor-toolbar">
        <div class="toolbar-left"><button class="icon-button show-sidebar" id="show-sidebar" title="展开侧栏" aria-label="展开侧栏">${icon('panel-left')}</button><button class="icon-button" id="undo" title="撤销 · Ctrl+Z" aria-label="撤销">${icon('undo-2')}</button><button class="icon-button" id="redo" title="重做 · Ctrl+Y" aria-label="重做">${icon('redo-2')}</button><span class="toolbar-separator"></span><button class="icon-button format-button" data-format="heading" title="二级标题" aria-label="插入标题">${icon('heading-2')}</button><button class="icon-button format-button" data-format="bold" title="加粗 · Ctrl+B" aria-label="加粗">${icon('bold')}</button><button class="icon-button format-button" data-format="italic" title="斜体 · Ctrl+I" aria-label="斜体">${icon('italic')}</button><button class="icon-button format-button" data-format="quote" title="引用" aria-label="引用">${icon('quote')}</button><button class="icon-button format-button" data-format="task" title="待办清单" aria-label="待办清单">${icon('list-checks')}</button><button class="icon-button format-button" data-format="link" title="链接 · Ctrl+K" aria-label="插入链接">${icon('link')}</button><button class="icon-button format-button" data-format="code" title="代码块" aria-label="插入代码块">${icon('code-2')}</button><button class="icon-button format-button" data-format="table" title="表格" aria-label="插入表格">${icon('table-2')}</button></div>
        <div class="view-switch" role="group" aria-label="编辑视图"><button data-mode="edit" title="编辑 · Ctrl+1">编辑</button><button data-mode="split" title="双栏 · Ctrl+2">双栏</button><button data-mode="preview" title="预览 · Ctrl+3">预览</button></div>
        <div class="toolbar-right"><button class="icon-button" id="search-button" title="查找与替换 · Ctrl+F" aria-label="查找与替换">${icon('search')}</button><button class="icon-button" id="focus-button" title="专注模式 · F11" aria-label="专注模式">${icon('maximize-2')}</button></div>
      </div>
      <div id="external-banner" hidden>原文件在外部发生了变化。保存时会再次确认。<button data-command="reload">重新载入</button><button id="dismiss-external" aria-label="关闭提示">${icon('x')}</button></div>
      <div class="editor-panes" id="panes">
        <section class="source-pane"><div class="pane-label"><span>MARKDOWN</span><span>每个想法，都值得落笔</span></div><div id="editor"></div></section>
        <div class="pane-divider" aria-hidden="true"></div>
        <section class="preview-pane"><div class="pane-label"><span>PREVIEW</span><button id="line-breaks-toggle" title="按原文显示每一行；关闭则使用标准 Markdown 段落换行" aria-pressed="true">保留换行</button><span id="preview-state">实时预览<span class="live-dot"></span></span></div><div class="preview-scroll" id="preview-scroll"><article id="preview" class="markdown-body"></article></div></section>
      </div>
    </div>
    <footer class="statusbar"><div class="status-left"><span id="save-state"><span class="status-dot"></span>准备就绪</span><span class="status-divider"></span><span id="word-count">0 字</span><span id="line-count">1 行</span></div><div class="status-right"><span id="cursor-position" class="document-only">行 1，列 1</span><button id="encoding" class="status-button document-only" title="原文件编码">UTF-8</button><span id="newline" class="document-only">CRLF</span><span class="status-divider"></span><button class="icon-button small" id="theme-button" title="切换深浅主题" aria-label="切换深浅主题">${icon(dark ? 'sun' : 'moon')}</button><button class="icon-button small" id="help-button" title="快捷键与帮助" aria-label="快捷键与帮助">${icon('keyboard')}</button></div></footer>
  </section>
</main>
<div id="save-menu" class="popup-menu" hidden><button data-command="save">保存<span>Ctrl S</span></button><button data-command="saveAs">另存为…<span>Ctrl Shift S</span></button><button id="rename-menu-item">重命名文件…<span>F2</span></button><hr><button data-command="reveal">在文件夹中显示${icon('arrow-up-right')}</button></div>
<div id="encoding-menu" class="popup-menu" hidden><div class="menu-caption">重新以此编码打开</div><button data-encoding="65001">UTF-8</button><button data-encoding="54936">GB18030 / GBK</button><button data-encoding="1252">Windows-1252</button></div>
<div id="toast" role="status" hidden></div>
<div id="drop-overlay" hidden><div>${icon('folder-open')}松开，打开这份文档<span>直接编辑原文件</span></div></div>
<dialog id="help-dialog"><div class="dialog-top"><span class="brand-mark">${icon('feather')}</span><button class="icon-button" id="close-help" aria-label="关闭帮助">${icon('x')}</button></div><h2>少一些打扰，多一些书写。</h2><p class="help-intro">墨页是你的本地 Markdown 编辑器。没有仓库，没有账户。<br>打开的文件留在原处；只有点击保存，修改才会写入。</p><div class="shortcuts"><div>新建文档<kbd>Ctrl N</kbd></div><div>打开文件<kbd>Ctrl O</kbd></div><div>保存<kbd>Ctrl S</kbd></div><div>另存为<kbd>Ctrl Shift S</kbd></div><div>查找 / 替换<kbd>Ctrl F / H</kbd></div><div>加粗 / 斜体<kbd>Ctrl B / I</kbd></div><div>编辑 / 双栏 / 预览<kbd>Ctrl 1 / 2 / 3</kbd></div><div>专注模式<kbd>F11</kbd></div><div>显示 / 隐藏侧栏<kbd>Ctrl \\</kbd></div><div>撤销 / 重做<kbd>Ctrl Z / Y</kbd></div></div><p class="help-note">点击文件名或按 F2 重命名；右键使用剪切、复制、粘贴等操作。<br>Ctrl+V 保留网页格式，Ctrl+Shift+V 原样粘贴；右键可整理已有 Markdown 格式。<br>支持常用 Markdown、表格、任务列表、脚注和本地图片。<br>YAML 元数据保留在源码中。远程图片和外部链接不会联网打开。<br>LaTeX、Mermaid 和各笔记软件的专用语法按源码保留。</p><div class="help-footer"><span>墨页 MOYE</span><span>版本 1.1.0 · 为本地文件而生</span></div></dialog>
`;

const lightHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#456b56', fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#846548' },
  { tag: tags.strong, fontWeight: '650', color: '#3e604e' },
  { tag: tags.link, color: '#4b7d8f', textDecoration: 'underline' },
  { tag: tags.url, color: '#869890' },
  { tag: tags.monospace, color: '#ad7651' },
  { tag: tags.quote, color: '#7c8580', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: '#929b94' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);
const darkHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#aec7a2', fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#c9b798' },
  { tag: tags.strong, fontWeight: '650', color: '#c3d6b5' },
  { tag: tags.link, color: '#9ec5cb', textDecoration: 'underline' },
  { tag: tags.url, color: '#889c95' },
  { tag: tags.monospace, color: '#d6b28d' },
  { tag: tags.quote, color: '#9ea998', fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);
const themeExtension = () => [EditorView.theme({}, { dark }), syntaxHighlighting(dark ? darkHighlight : lightHighlight)];
const phraseTranslations = { 'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全选', 'match case': '区分大小写', 'regexp': '正则', 'by word': '全词', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'Go to line': '跳转到行' };
function extensions() {
  return [
    history(), drawSelection(), highlightActiveLine(), lineNumbers(), EditorView.lineWrapping,
    markdown({ base: markdownLanguage }), indentUnit.of('  '), search({ top: true }),
    EditorState.phrases.of(phraseTranslations), theme.of(themeExtension()),
    placeholder('从一个标题，或一句话开始…'),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑区', spellcheck: 'false' }),
    EditorView.domEventHandlers({ paste: event => interactions?.pasteEvent(event) || false }),
    keymap.of([{ key: 'Mod-b', run: () => { format('bold'); return true; } }, { key: 'Mod-i', run: () => { format('italic'); return true; } }, { key: 'Mod-k', run: () => { format('link'); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        bridge?.postMessage({ type: 'change', content: view.state.doc.toString() });
        updateStatus();
        clearTimeout(renderTimer); renderTimer = setTimeout(updatePreview, 170);
      }
      if (update.selectionSet || update.docChanged) updateCursor();
    }),
  ];
}
view = new EditorView({ state: EditorState.create({ doc: '', extensions: extensions() }), parent: $('#editor') });
window.moye = { content: () => view.state.doc.toString() };
interactions = installInteractions({
  view, bridge, getCurrent: () => current, isActive: () => active, send, toast, format,
  closeOtherMenus: closeMenus,
  find: () => { if (mode === 'preview') setMode('split'); openSearchPanel(view); },
  onRenamed: m => { current = { ...current, name: m.name, path: m.path }; updateStatus(); toast(m.path ? '文件已重命名为 ' + m.name : '已命名为 ' + m.name + '，保存时选择位置。'); },
});

function send(type, extras = {}) {
  closeMenus();
  if (!bridge) { toast('请使用墨页桌面程序打开和保存本地文件。'); return; }
  bridge.postMessage({ type, content: view.state.doc.toString(), ...extras });
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function dirty() { return view.state.doc.toString() !== savedText; }
function updateStatus() {
  const changed = dirty();
  $('#dirty-dot').hidden = !changed;
  $('#file-name').textContent = active ? current.name : '一个安静的书写空间';
  $('#file-name').title = (current.path || '尚未保存到磁盘') + (active ? '\n点击重命名 · F2' : '');
  $('#current-document span').textContent = active ? current.name : '开始书写';
  $('#current-document').title = current.path || '';
  $('#save-state').innerHTML = `<span class="status-dot ${changed ? 'unsaved' : ''}"></span>${!active ? '准备就绪' : changed ? '有未保存的修改' : current.path ? '所有修改已保存' : '新文档 · 尚未保存'}`;
  const text = view.state.doc.toString();
  $('#word-count').textContent = wordCount(text).toLocaleString() + ' 字';
  $('#line-count').textContent = view.state.doc.lines.toLocaleString() + ' 行';
  $('#encoding').textContent = current.encoding;
  $('#newline').textContent = current.newline;
  $('#local-badge').textContent = current.path ? '本地文件' : 'Markdown';
}
function updateCursor() { const pos = view.state.selection.main.head; const line = view.state.doc.lineAt(pos); $('#cursor-position').textContent = `行 ${line.number}，列 ${pos - line.from + 1}`; }
function updatePreview() {
  clearTimeout(renderTimer);
  const text = view.state.doc.toString();
  if (text.length > 2_000_000) {
    $('#preview').textContent = '这份文档较大，已暂停实时预览。你仍可编辑和保存全文。';
    outline = [];
  } else {
    const result = render(text, current.imageBase, { preserveLineBreaks });
    $('#preview').replaceChildren(result.fragment);
    outline = result.headings;
    if (!text.trim()) $('#preview').innerHTML = '<div class="empty-preview"><span>你的文字，会在这里呈现。</span><p>从左侧开始，写下第一个想法。</p></div>';
  }
  $('#heading-count').textContent = outline.length || '';
  const nav = $('#outline'); nav.replaceChildren();
  if (!outline.length) nav.innerHTML = '<p class="sidebar-empty">用标题，让想法有迹可循。</p>';
  for (const heading of outline) {
    const button = document.createElement('button');
    button.className = 'outline-item'; button.style.setProperty('--level', Math.min(heading.level - 1, 3));
    const hash = document.createElement('span'); hash.className = 'outline-hash'; hash.textContent = heading.level === 1 ? '#' : '·';
    const label = document.createElement('span'); label.textContent = heading.text;
    button.append(hash, label); button.title = heading.text;
    button.addEventListener('click', () => {
      document.querySelectorAll('.outline-item').forEach(b => b.classList.toggle('selected', b === button));
      const line = view.state.doc.line(Math.min(heading.line, view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 20 }) });
      document.getElementById(heading.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (mode !== 'preview') view.focus();
    });
    nav.append(button);
  }
}
function showDocument(message) {
  interactions?.documentChanged();
  active = true; current = { ...current, ...message }; savedText = message.content;
  view.setState(EditorState.create({ doc: message.content, extensions: extensions() }));
  $('#welcome').hidden = true; $('#document-area').hidden = false; document.body.classList.add('has-document');
  $('#external-banner').hidden = true;
  updateStatus(); updateCursor(); updatePreview(); setMode(mode); view.focus();
}
function renderRecent() {
  $('#recent-files').replaceChildren();
  if (!recentPaths.length) { $('#recent-files').innerHTML = '<p class="sidebar-empty">打开的文件会显示在这里。</p>'; return; }
  for (const path of recentPaths) {
    const button = document.createElement('button'); button.className = 'recent-item'; button.title = path;
    button.innerHTML = icon('file-text') + '<span></span>';
    button.querySelector('span').textContent = path.split(/[\\/]/).pop();
    button.addEventListener('click', () => send('openRecent', { path })); $('#recent-files').append(button);
  }
  refreshIcons();
}
bridge?.addEventListener('message', event => {
  const m = event.data;
  interactions?.handleMessage(m);
  if (m.type === 'document') showDocument(m);
  else if (m.type === 'saved') { current = { ...current, ...m }; savedText = m.content; $('#external-banner').hidden = true; updateStatus(); updatePreview(); toast('已保存到 ' + m.path); }
  else if (m.type === 'recent') { recentPaths = m.paths; renderRecent(); }
  else if (m.type === 'notice') toast(m.message);
  else if (m.type === 'external') $('#external-banner').hidden = !m.changed;
});
function setMode(value) {
  mode = value; localStorage.setItem('moye-mode', mode); $('#panes').dataset.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(button => { button.classList.toggle('selected', button.dataset.mode === mode); button.setAttribute('aria-pressed', button.dataset.mode === mode); });
  document.querySelectorAll('.format-button, #undo, #redo').forEach(button => button.disabled = mode === 'preview');
  if (mode !== 'preview') requestAnimationFrame(() => view.requestMeasure());
}
function setSidebar(value) { sidebar = value; localStorage.setItem('moye-sidebar', sidebar); document.body.classList.toggle('sidebar-hidden', !sidebar); view.requestMeasure(); }
function setFocus(value) { focusMode = value; document.body.classList.toggle('focus-mode', value); $('#focus-button').innerHTML = icon(value ? 'minimize-2' : 'maximize-2'); $('#focus-button').title = value ? '退出专注模式 · F11 / Esc' : '专注模式 · F11'; refreshIcons(); view.requestMeasure(); }
function format(kind) {
  if (!active) return;
  if (mode === 'preview') setMode('split');
  const range = view.state.selection.main; const selected = view.state.sliceDoc(range.from, range.to);
  let insert, from = range.from, to = range.to, selection;
  if (['heading', 'heading1', 'quote', 'task'].includes(kind)) {
    const start = view.state.doc.lineAt(from), end = view.state.doc.lineAt(to);
    from = start.from; to = end.to;
    const prefix = { heading: '## ', heading1: '# ', quote: '> ', task: '- [ ] ' }[kind];
    insert = view.state.sliceDoc(from, to).split('\n').map(line => prefix + (kind.startsWith('heading') ? line.replace(/^ {0,3}#{1,6}[ \t]+/, '') : line)).join('\n');
  } else if (kind === 'bold' || kind === 'italic') {
    const mark = kind === 'bold' ? '**' : '*'; const body = selected || '文字'; insert = mark + body + mark;
    selection = { anchor: from + mark.length, head: from + mark.length + body.length };
  } else if (kind === 'link') { insert = `[${selected || '链接文字'}](https://example.com)`; const start = from + (selected || '链接文字').length + 3; selection = { anchor: start, head: start + 19 }; }
  else if (kind === 'code') insert = '\n```\n' + (selected || '代码') + '\n```\n';
  else if (kind === 'table') insert = '\n| 标题 | 内容 |\n| --- | --- |\n| 项目 | 说明 |\n';
  view.dispatch({ changes: { from, to, insert }, selection: selection || { anchor: from + insert.length }, userEvent: 'input' }); view.focus();
}
function closeMenus() { $('#save-menu').hidden = true; $('#encoding-menu').hidden = true; $('#save-options').setAttribute('aria-expanded', 'false'); }
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => send(button.dataset.command)));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-format]').forEach(button => { button.addEventListener('mousedown', e => e.preventDefault()); button.addEventListener('click', () => format(button.dataset.format)); });
document.querySelectorAll('[data-encoding]').forEach(button => button.addEventListener('click', () => send('reopen', { codePage: button.dataset.encoding })));
$('#undo').onclick = () => { undo(view); view.focus(); }; $('#redo').onclick = () => { redo(view); view.focus(); };
$('#hide-sidebar').onclick = () => setSidebar(false); $('#show-sidebar').onclick = () => setSidebar(true);
$('#current-document').onclick = () => active ? view.focus() : send('new');
$('#search-button').onclick = () => { if (mode === 'preview') setMode('split'); openSearchPanel(view); };
$('#focus-button').onclick = () => setFocus(!focusMode);
$('#dismiss-external').onclick = () => $('#external-banner').hidden = true;
function updateLineBreakToggle() { $('#line-breaks-toggle').setAttribute('aria-pressed', String(preserveLineBreaks)); $('#line-breaks-toggle').textContent = preserveLineBreaks ? '保留换行 ✓' : '标准换行'; }
$('#line-breaks-toggle').onclick = () => { preserveLineBreaks = !preserveLineBreaks; localStorage.setItem('moye-line-breaks', String(preserveLineBreaks)); updateLineBreakToggle(); updatePreview(); };
updateLineBreakToggle();
$('#theme-button').onclick = () => { dark = !dark; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('moye-theme', dark ? 'dark' : 'light'); view.dispatch({ effects: theme.reconfigure(themeExtension()) }); $('#theme-button').innerHTML = icon(dark ? 'sun' : 'moon'); refreshIcons(); };
$('#save-options').onclick = e => { e.stopPropagation(); const show = $('#save-menu').hidden; closeMenus(); $('#save-menu').hidden = !show; $('#save-options').setAttribute('aria-expanded', String(show)); };
$('#encoding').onclick = e => { e.stopPropagation(); if (!current.path) { toast('新文件使用 UTF-8 编码。'); return; } const show = $('#encoding-menu').hidden; closeMenus(); $('#encoding-menu').hidden = !show; };
document.addEventListener('click', event => { if (!event.target.closest('.popup-menu')) closeMenus(); });
for (const selector of ['#help-button', '#home-button', '#welcome-help']) $(selector).onclick = () => $('#help-dialog').showModal();
$('#close-help').onclick = () => $('#help-dialog').close();
$('#help-dialog').onclick = event => { if (event.target === $('#help-dialog')) { const rect = $('#help-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('#help-dialog').close(); } };
document.addEventListener('keydown', event => {
  if (event.isComposing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { closeMenus(); if (focusMode) setFocus(false); }
  if (event.key === 'F11' && active) { event.preventDefault(); setFocus(!focusMode); }
  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();
  const commands = { n: 'new', o: 'open', s: event.shiftKey ? 'saveAs' : 'save' };
  if (commands[key]) { event.preventDefault(); if (key !== 's' || active) send(commands[key]); }
  if (['1', '2', '3'].includes(key) && active) { event.preventDefault(); setMode({ 1: 'edit', 2: 'split', 3: 'preview' }[key]); }
  if (key === '\\') { event.preventDefault(); setSidebar(!sidebar); }
  if ((key === 'f' || key === 'h') && active && mode === 'preview') { event.preventDefault(); setMode('split'); openSearchPanel(view); }
}, true);
$('#preview').addEventListener('click', event => {
  const link = event.target.closest('a'); if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    let id; try { id = decodeURIComponent(href.slice(1)); } catch { return; }
    const target = [...$('#preview').querySelectorAll('[id]')].find(el => el.id === id) || [...$('#preview').querySelectorAll('h1,h2,h3,h4,h5,h6')].find(el => el.textContent.toLowerCase().replace(/\s+/g, '-') === id);
    target?.scrollIntoView({ behavior: 'smooth' });
  } else toast('离线模式：外部链接不会打开。可在源码中复制链接。');
});
$('#preview').addEventListener('error', event => {
  if (event.target.tagName === 'IMG') { const note = document.createElement('span'); note.className = 'image-placeholder'; note.textContent = '▧ 图片未找到 · ' + (event.target.alt || '请检查相对路径'); event.target.replaceWith(note); }
}, true);
// Synchronize proportional positions without fighting manual preview scrolling.
view.scrollDOM.addEventListener('scroll', () => {
  if (mode !== 'split' || syncing) return;
  syncing = true;
  const source = view.scrollDOM, target = $('#preview-scroll');
  const max = source.scrollHeight - source.clientHeight;
  target.scrollTop = max > 0 ? source.scrollTop / max * (target.scrollHeight - target.clientHeight) : 0;
  requestAnimationFrame(() => syncing = false);
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragleave', event => { if (event.dataTransfer.types.includes('Files') && --dragDepth <= 0) $('#drop-overlay').hidden = true; });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files]; if (!files.length) return;
  if (files.length > 1) { toast('请一次拖入一个文件。'); return; }
  if (bridge?.postMessageWithAdditionalObjects) bridge.postMessageWithAdditionalObjects({ type: 'drop', content: view.state.doc.toString() }, [files[0]]);
  else toast('请点击“打开”选择本地文件。');
});
refreshIcons(); renderRecent(); setSidebar(sidebar); setMode(mode); updateStatus();
bridge?.postMessage({ type: 'ready' });
