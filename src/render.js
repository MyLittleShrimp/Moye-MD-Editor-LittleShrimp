import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';

const parser = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false })
  .use(footnote).use(taskLists, { enabled: false, label: false });

export function createRenderer(purify) {
  return function render(source, imageBase = null, { preserveLineBreaks = false } = {}) {
    // Front matter remains verbatim in the editor and on disk.
    let body = source;
    let frontMatter = '';
    const front = body.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/);
    if (front) { frontMatter = front[0]; body = body.slice(front[0].length); }
    const environment = {};
    const tokens = parser.parse(body, environment);
    const headings = [];
    const offset = frontMatter ? frontMatter.split('\n').length - 1 : 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open') {
        const id = 'heading-' + headings.length;
        tokens[i].attrSet('id', id);
        headings.push({ id, level: Number(tokens[i].tag.slice(1)), text: tokens[i + 1]?.children?.filter(t => t.type === 'text' || t.type === 'code_inline' || t.type === 'image').map(t => t.content).join('') || tokens[i + 1]?.content || '', line: (tokens[i].map?.[0] || 0) + offset + 1 });
      }
    }
    const html = purify.sanitize(parser.renderer.render(tokens, { ...parser.options, breaks: preserveLineBreaks }, environment), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'base', 'meta', 'link'],
      FORBID_ATTR: ['style', 'srcset', 'autofocus', 'formaction', 'contenteditable'],
      ALLOW_DATA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    for (const input of html.querySelectorAll('input')) {
      if (input.type !== 'checkbox') input.remove();
      else { input.disabled = true; input.removeAttribute('name'); input.removeAttribute('id'); }
    }
    for (const img of html.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      let allowed = null;
      if (/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(src)) allowed = src;
      else if (imageBase && src && !/^(?:[a-z][a-z\d+.-]*:|[\/\\])/i.test(src)) {
        try {
          const resolved = new URL(src.replaceAll('\\', '/'), imageBase);
          if (resolved.href.startsWith(imageBase)) allowed = resolved.href;
        } catch { /* Render an explicit placeholder for invalid paths. */ }
      }
      if (allowed) { img.src = allowed; img.loading = 'lazy'; }
      else {
        const note = html.ownerDocument.createElement('span');
        note.className = 'image-placeholder';
        note.textContent = '▧ ' + (img.alt || '图片') + (imageBase ? ' · 离线模式：仅显示当前文件夹内的图片' : ' · 保存文档后可显示本地图片');
        img.replaceWith(note);
      }
    }
    for (const a of html.querySelectorAll('a')) {
      a.removeAttribute('target'); a.removeAttribute('ping'); a.setAttribute('rel', 'noreferrer noopener');
    }
    return { fragment: html, headings, frontMatter: Boolean(frontMatter) };
  };
}

export function wordCount(text) {
  const chinese = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0;
  const words = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0;
  return chinese + words;
}
