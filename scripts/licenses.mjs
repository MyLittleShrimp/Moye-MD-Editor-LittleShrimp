import fs from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
let output = 'MOYE / 墨页 — Third-party notices\n\n';
for (const [folder, info] of Object.entries(lock.packages)) {
  if (!folder || info.dev) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  output += `\n${'='.repeat(70)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || info.license || 'See license'}\n\n`;
  for (const file of fs.readdirSync(folder).filter(f => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f))) {
    if (fs.statSync(path.join(folder, file)).isFile()) output += fs.readFileSync(path.join(folder, file), 'utf8') + '\n';
  }
}
const sdk = '.build/webview2';
for (const file of fs.readdirSync(sdk).filter(f => /licen[cs]e|notice/i.test(f))) {
  if (fs.statSync(path.join(sdk, file)).isFile()) output += `\nMicrosoft WebView2 SDK — ${file}\n` + fs.readFileSync(path.join(sdk, file), 'utf8') + '\n';
}
fs.writeFileSync(path.join(process.argv[2] || 'release/Moye', 'THIRD-PARTY-NOTICES.txt'), output);
