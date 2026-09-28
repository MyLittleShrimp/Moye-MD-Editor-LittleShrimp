import { Transaction } from '@codemirror/state';
import { undo, redo, undoDepth, redoDepth, selectAll, isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import DOMPurify from 'dompurify';
import { cleanMarkdown, preparePaste } from './paste.js';

export function installInteractions({ view, bridge, getCurrent, isActive, send, toast, format, find, onRenamed, closeOtherMenus }) {
  const menu = document.createElement('div');
  menu.id = 'context-menu'; menu.className = 'popup-menu context-menu'; menu.hidden = true;
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '编辑操作');
  document.body.append(menu);
  const dialog = document.createElement('dialog'); dialog.id = 'rename-dialog';
  dialog.innerHTML = `<form id="rename-form"><h2 id="rename-title">重命名文件</h2><p id="rename-note"></p><label for="rename-input">文件名</label><input id="rename-input" name="name" autocomplete="off" spellcheck="false" required maxlength="255"><p id="rename-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" id="rename-cancel">取消</button><button type="submit" class="button primary" id="rename-submit">重命名</button></div></form>`;
  dialog.setAttribute('aria-labelledby', 'rename-title'); document.body.append(dialog);
  const input = dialog.querySelector('input'), error = dialog.querySelector('#rename-error'), submit = dialog.querySelector('#rename-submit');
  let context = null, epoch = 0, sequence = 0, renaming = false;
  const pending = new Map();
  function closeMenu(restore = false) { menu.hidden = true; if (restore) (context?.field || context?.returnFocus || view.contentDOM).focus(); }
  function snapshot() { return { doc: view.state.doc, selection: view.state.selection, epoch }; }
  function sameDocument(snap) { return snap.epoch === epoch && snap.doc === view.state.doc; }
  function insideCode() {
    for (let node = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1); node; node = node.parent)
      if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(node.name)) return true;
    return false;
  }
  function paste(text, html = '', plain = false, snap = snapshot()) {
    if (!sameDocument(snap)) { toast('文档已经变化，请重新选择粘贴位置。'); return; }
    const result = preparePaste({ text, html, plain, inCode: insideCode() }, DOMPurify);
    if (!result.text) { toast('剪贴板中没有可粘贴的文字。'); return; }
    view.dispatch(view.state.replaceSelection(result.text), { annotations: [Transaction.userEvent.of('input.paste'), isolateHistory.of('full')], scrollIntoView: true });
    view.focus();
    if (result.changed) toast(result.rich ? '已将标题、列表等格式转换为 Markdown。可用 Ctrl+Z 撤销。' : '已整理粘贴内容的 Markdown 格式。原样粘贴请用 Ctrl+Shift+V。');
  }
  function requestClipboard(type, data, callback) {
    if (!bridge) { toast('请在桌面程序中使用剪贴板。'); return; }
    const id = String(++sequence);
    const timeout = setTimeout(() => { if (pending.delete(id)) toast('剪贴板操作超时，请重试。'); }, 5000);
    pending.set(id, { callback, timeout }); bridge.postMessage({ type, id, ...data });
  }
  function writeClipboard(text, then) { if (text) requestClipboard('clipboardWrite', { text }, () => { then?.(); }); }
  function fieldEdit(field, from, to, text, original) {
    if (!field.isConnected || field.value !== original) { toast('输入内容已变化，请重新操作。'); return; }
    field.setRangeText(text, from, to, 'end'); field.dispatchEvent(new Event('input', { bubbles: true })); field.focus();
  }
  function clipboardAction(action, plain = false, ctx = context || { kind: 'editor' }) {
    const snap = snapshot();
    if (ctx.kind === 'field') {
      const field = ctx.field, original = field.value, from = field.selectionStart, to = field.selectionEnd;
      if (action === 'paste') requestClipboard('clipboardRead', {}, m => fieldEdit(field, from, to, m.text || '', original));
      else writeClipboard(original.slice(from, to), action === 'cut' ? () => fieldEdit(field, from, to, '', original) : null);
      return;
    }
    if (action === 'paste') {
      requestClipboard('clipboardRead', {}, m => {
        if (!sameDocument(snap) || !view.state.selection.eq(snap.selection)) { toast('文档或选区已变化，请重新粘贴。'); return; }
        paste(m.text, m.html, plain, snap);
      });
      return;
    }
    const text = ctx.kind === 'preview' ? ctx.selected : view.state.selection.ranges.map(r => view.state.sliceDoc(r.from, r.to)).join('\n');
    writeClipboard(text, action === 'cut' ? () => {
      if (!sameDocument(snap) || !view.state.selection.eq(snap.selection)) { toast('已复制；文档或选区已变化，没有剪切文字。'); return; }
      view.dispatch(view.state.replaceSelection(''), { annotations: [Transaction.userEvent.of('delete.cut'), isolateHistory.of('full')] }); view.focus();
    } : ctx.kind === 'editor' ? () => view.focus() : null);
  }
  function repair() {
    const range = view.state.selection.main;
    const from = range.empty ? 0 : range.from, to = range.empty ? view.state.doc.length : range.to;
    const raw = view.state.sliceDoc(from, to);
    const fixed = cleanMarkdown(raw, { explicit: true });
    if (fixed === raw) { toast('没有发现需要整理的标题符号、特殊空格或外层 Markdown 代码块。'); return; }
    view.dispatch({ changes: { from, to, insert: fixed }, selection: { anchor: from, head: from + fixed.length }, annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] });
    view.focus(); toast('已整理 Markdown 格式。可按 Ctrl+Z 撤销。');
  }
  function openRename() {
    closeMenu(); closeOtherMenus(); if (!isActive() || dialog.open) return;
    input.value = getCurrent().name; input.disabled = false; submit.disabled = false; error.textContent = '';
    dialog.querySelector('#rename-note').textContent = getCurrent().path ? '在当前文件夹内重命名；未保存的文字会继续保留。' : '为新文档命名，保存时再选择存放位置。';
    dialog.showModal(); input.focus(); const dot = input.value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }
  dialog.querySelector('#rename-form').onsubmit = event => {
    event.preventDefault(); if (renaming || !input.value.trim()) return;
    if (!bridge) { error.textContent = '请在墨页桌面程序中重命名。'; return; }
    renaming = true; submit.disabled = true; input.disabled = true; error.textContent = '';
    send('rename', { name: input.value });
  };
  dialog.querySelector('#rename-cancel').onclick = () => { if (!renaming) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (renaming) event.preventDefault(); });
  dialog.addEventListener('close', () => closeMenu());
  function makeItem(label, action, shortcut = '', enabled = true) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.disabled = !enabled;
    const title = document.createElement('span'); title.className = 'menu-item-label'; title.textContent = label;
    const key = document.createElement('span'); key.textContent = shortcut; button.append(title, key);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.onclick = () => { closeMenu(); action(); }; menu.append(button);
  }
  function separator() { const hr = document.createElement('hr'); hr.setAttribute('role', 'separator'); menu.append(hr); }
  function showContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#context-menu')) return;
    const field = target.closest('input:not([type=checkbox]),textarea');
    const inEditor = !!target.closest('#editor'), inPreview = !!target.closest('#preview-scroll');
    const inFile = !!target.closest('#file-name,#rename-button,#current-document');
    if (!field && (!isActive() || (!inEditor && !inPreview && !inFile))) return;
    event.preventDefault(); event.stopPropagation(); closeOtherMenus(); closeMenu(); menu.replaceChildren();
    (field?.closest('dialog') || document.body).append(menu);
    context = { kind: field ? 'field' : inEditor ? 'editor' : inPreview ? 'preview' : 'file', field, selected: window.getSelection()?.toString() || '', returnFocus: target.closest('button') };
    if (inEditor && view.state.selection.main.empty && event.clientX) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null) view.dispatch({ selection: { anchor: pos } });
    }
    const selected = field ? field.selectionEnd > field.selectionStart : inPreview ? !!context.selected : !view.state.selection.main.empty;
    if (inEditor) {
      makeItem('撤销', () => { undo(view); view.focus(); }, 'Ctrl Z', undoDepth(view.state) > 0);
      makeItem('重做', () => { redo(view); view.focus(); }, 'Ctrl Y', redoDepth(view.state) > 0); separator();
    }
    if (inEditor || field || inPreview) {
      if (!inPreview) makeItem('剪切', () => clipboardAction('cut'), 'Ctrl X', selected && !field?.readOnly);
      makeItem('复制', () => clipboardAction('copy'), 'Ctrl C', selected);
      if (!inPreview) {
        makeItem('粘贴', () => clipboardAction('paste'), 'Ctrl V', !field?.readOnly);
        if (inEditor) makeItem('粘贴为纯文本', () => clipboardAction('paste', true), 'Ctrl Shift V');
        makeItem('删除选中文字', () => {
          if (field) fieldEdit(field, field.selectionStart, field.selectionEnd, '', field.value);
          else { view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete' }); view.focus(); }
        }, 'Delete', selected && !field?.readOnly);
      }
      makeItem('全选', () => {
        if (field) { field.focus(); field.select(); }
        else if (inPreview) { const range = document.createRange(); range.selectNodeContents(document.querySelector('#preview')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
        else { selectAll(view); view.focus(); }
      }, 'Ctrl A');
    }
    if (field) { /* The focused text field uses only text editing commands. */ }
    else if (inEditor) {
      separator(); makeItem('查找与替换', find, 'Ctrl F');
      makeItem('加粗', () => format('bold'), 'Ctrl B');
      makeItem('设为一级标题', () => format('heading1')); makeItem('设为二级标题', () => format('heading'));
      makeItem('整理 Markdown 格式', repair); separator();
    } else if (inPreview) { separator(); makeItem('复制 Markdown 源码', () => writeClipboard(view.state.doc.toString())); separator(); }
    if (!field) {
      makeItem('重命名文件…', openRename, 'F2');
      makeItem('保存', () => send('save'), 'Ctrl S'); makeItem('另存为…', () => send('saveAs'), 'Ctrl Shift S');
      if (inFile) { separator(); makeItem('复制文件路径', () => writeClipboard(getCurrent().path), '', !!getCurrent().path); makeItem('在文件夹中显示', () => send('reveal'), '', !!getCurrent().path); }
    }
    menu.style.left = '0px'; menu.style.top = '0px'; menu.hidden = false;
    const bounds = target.getBoundingClientRect();
    const x = event.clientX || bounds.left + 12, y = event.clientY || bounds.top + 16;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.querySelector('button:enabled')?.focus({ preventScroll: true });
  }
  document.addEventListener('contextmenu', showContext);
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) closeMenu(); });
  window.addEventListener('resize', () => closeMenu());
  document.addEventListener('scroll', e => { if (!menu.contains(e.target)) closeMenu(); }, true);
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); return; }
    const items = [...menu.querySelectorAll('button:enabled')], index = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  document.querySelector('#file-name').addEventListener('click', openRename);
  document.querySelector('#rename-button').addEventListener('click', openRename);
  document.querySelector('#current-document').addEventListener('dblclick', openRename);
  document.querySelector('#rename-menu-item').addEventListener('click', openRename);
  document.addEventListener('keydown', e => {
    if (e.isComposing || document.querySelector('dialog[open]')) return;
    if (e.key === 'F2' && isActive()) { e.preventDefault(); openRename(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v' && view.hasFocus) { e.preventDefault(); clipboardAction('paste', true, { kind: 'editor' }); }
  }, true);
  return {
    pasteEvent(event) {
      if (!event.clipboardData) return false;
      event.preventDefault();
      paste(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'));
      return true;
    },
    documentChanged() { epoch++; closeMenu(); if (dialog.open) dialog.close(); },
    handleMessage(m) {
      if (m.type === 'clipboardResult') {
        const request = pending.get(m.id); if (!request) return;
        pending.delete(m.id); clearTimeout(request.timeout);
        if (m.ok) request.callback(m); else toast(m.message || '剪贴板操作失败。');
      } else if (m.type === 'renamed' || m.type === 'renameError') {
        renaming = false; submit.disabled = false; input.disabled = false;
        if (m.type === 'renamed') { dialog.close(); onRenamed(m); view.focus(); }
        else { error.textContent = m.message; input.focus(); }
      }
    },
  };
}
