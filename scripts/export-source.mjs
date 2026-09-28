// A deterministic, allowlisted source export. Never copies caches or local documents.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release/github-ready/moye-source');
const roots = ['.editorconfig', '.gitattributes', '.gitignore', '.github', 'LICENSE', 'README.md', 'CHANGELOG.md', 'VERIFICATION.md', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'native', 'src', 'scripts', 'tests', 'examples', 'docs'];
const excluded = new Set(['__pycache__', '.DS_Store', 'Thumbs.db', 'Moye Intro.mp4']);
const entries = [];
function inspect(relative) {
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Refusing symlink: ' + relative);
  if (excluded.has(path.basename(relative)) || /\.(?:pyc|log|user)$/.test(relative)) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source).sort()) inspect(path.join(relative, name));
  } else {
    if (stat.size > 25*1024*1024) throw new Error('Review large source artifact: ' + relative);
    entries.push({ path: relative.replaceAll(path.sep, '/'), bytes: stat.size, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') });
  }
}
roots.forEach(inspect);
if (fs.existsSync(out)) {
  // Only this fixed generated directory may be replaced; no computed/user paths.
  if (path.resolve(out) !== path.resolve(root, 'release/github-ready/moye-source')) throw new Error('Invalid export path');
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });
for (const entry of entries) {
  const destination = path.join(out, entry.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, entry.path), destination);
}
fs.writeFileSync(path.join(out, 'SOURCE-MANIFEST.json'), JSON.stringify(entries, null, 2)+'\n');
console.log(`Exported ${entries.length} files (${(entries.reduce((n,e)=>n+e.bytes,0)/1024/1024).toFixed(2)} MiB) to ${out}`);
