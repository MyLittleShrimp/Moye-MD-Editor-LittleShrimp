import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import MarkdownIt from 'markdown-it';

const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
converter.use(gfm);
converter.addRule('gfmStrike', { filter: ['del', 's', 'strike'], replacement: content => '~~' + content + '~~' });
const blockParser = new MarkdownIt({ html: true });
converter.remove(['script', 'style', 'iframe', 'object', 'button', 'nav', 'form']);
converter.addRule('safeFencedCode', {
  filter: 'pre',
  replacement: (_content, node) => {
    const code = node.querySelector('code') || node;
    const language = (code.getAttribute('class') || '').match(/(?:language|lang)-([\w+-]+)/)?.[1] || '';
    const text = code.textContent.replace(/\n$/, '');
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map(s => s.length));
    const fence = '`'.repeat(longest + 1);
    return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
  },
});

export function cleanMarkdown(text, { explicit = false, unwrap = true } = {}) {
  let result = text.replace(/\r\n?/g, '\n');
  if (unwrap) {
    const lines = result.trim().split('\n');
    const first = lines[0]?.match(/^(`{3,}|~{3,})(?:markdown|md)\s*$/i);
    if (first && lines.length > 2) {
      const close = new RegExp('^' + first[1][0] + '{' + first[1].length + ',}\\s*$');
      if (lines.slice(1).findIndex(line => close.test(line)) === lines.length - 2) result = lines.slice(1, -1).join('\n');
    }
  }
  const protectedLines = new Set();
  for (const token of blockParser.parse(result, {})) {
    if (['fence', 'code_block', 'html_block'].includes(token.type) && token.map)
      for (let i = token.map[0]; i < token.map[1]; i++) protectedLines.add(i);
  }
  let fence = null, frontMatter = false;
  return result.split('\n').map((line, index) => {
    if (index === 0 && /^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.test(result)) { frontMatter = true; return line; }
    if (frontMatter) { if (index > 0 && /^(---|\.\.\.)$/.test(line)) frontMatter = false; return line; }
    if (protectedLines.has(index)) return line;
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (/^( {4}|\t)/.test(line)) return line;
    // Only repair structural prefixes, never zero-width joiners or spacing inside prose/code.
    let value = line.replace(/^([ \u00a0\u2007\u202f\u3000]{0,3})[\u200b\ufeff]+(?=[#＃>＞*+\-•])/u, '$1');
    value = value.replace(/^[\u00a0\u2007\u202f\u3000]{1,3}(?=[#＃>＞*+\-•])/u, '');
    if (explicit) value = value.replace(/^( {0,3})\\(#{1,6})(?=[\s\p{L}\p{N}])/u, '$1$2');
    value = value.replace(/^( {0,3})＃{1,6}(?!＃)/u, prefix => prefix.replaceAll('＃', '#'));
    value = value.replace(/^( {0,3}#{1,6})[\u00a0\u2007\u202f\u3000]+/u, '$1 ');
    value = value.replace(explicit ? /^( {0,3}#{1,6})(?=[\p{L}\p{N}])/u : /^( {0,3}#{1,6})(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/u, '$1 ');
    value = value.replace(/^( {0,3})＞[ \u00a0\u2007\u202f\u3000]*/u, '$1> ');
    value = value.replace(/^( {0,3}(?:>|[-+*]|\d+[.)]))[\u00a0\u2007\u202f\u3000]+/u, '$1 ');
    value = value.replace(/^( {0,3})[•－−][ \u00a0\u2007\u202f\u3000]+/u, '$1- ');
    return value;
  }).join('\n');
}

export function preparePaste({ text = '', html = '', plain = false, inCode = false }, purify) {
  const raw = text.replace(/\r\n?/g, '\n');
  if (plain || inCode) return { text: raw, changed: false, rich: false };
  let result = raw, rich = false;
  const looksLikeSource = /(^|\n) {0,3}(?:#{1,6}(?:\s|[\p{Script=Han}])|`{3,}|~{3,}|[-+*] |\d+[.)] |>|\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^\)]+\)/u.test(raw);
  if (html) {
    // Windows CF_HTML may include a byte-offset header. Prefer its selected fragment.
    const fragmentMatch = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
    const selectedHtml = fragmentMatch?.[1] || html.replace(/^[\s\S]*?(?=<(?:!doctype|html|body|div|p|h[1-6]|span|pre|table|ul|ol|strong|b)\b)/i, '');
    const fragment = purify.sanitize(selectedHtml, {
      USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'nav', 'video', 'audio', 'source', 'link', 'meta'],
      FORBID_ATTR: ['style', 'srcset'],
    });
    const renderedHeadings = [...fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(h => !/^\s*#{1,6}/.test(h.textContent));
    if ((!looksLikeSource || renderedHeadings) && fragment.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,pre,blockquote,table,strong,b,em,i,del,s,a[href],code')) {
      const container = fragment.ownerDocument.createElement('div'); container.append(fragment);
      result = converter.turndown(container); rich = true;
      // A lone source-code block copied from an app should stay source text, not gain an outer fence.
      const blocks = [...container.children];
      if (blocks.length === 1 && blocks[0].tagName === 'PRE' && raw) { result = raw; rich = false; }
    }
  }
  result = cleanMarkdown(result);
  return { text: result, changed: result !== raw, rich };
}
