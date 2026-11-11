// Post-build sanity checks for static hosting.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const LIMIT = 25 * 1024 * 1024; // Cloudflare Pages per-file limit
const problems = [];
let files = 0, bytes = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    const size = fs.statSync(p).size;
    files++; bytes += size;
    const rel = path.relative(dist, p).replaceAll('\\', '/');
    if (size > LIMIT) problems.push(`${rel} is ${(size / 1048576).toFixed(1)} MiB (limit 25 MiB)`);
    if (/\.(js|mjs|html|css|json)$/.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8');
      if (/https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(text) && !rel.includes('ort-')) problems.push(`${rel} references localhost`);
    }
  }
}
walk(dist);
for (const must of ['index.html', 'bin/manifest.json', '_headers', 'favicon.svg']) {
  if (!fs.existsSync(path.join(dist, must))) problems.push(`missing ${must}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'bin/manifest.json'), 'utf8'));
for (const p of [...manifest.model.parts, ...manifest.ort.webgpu.parts, ...manifest.ort.wasm.parts, manifest.ort.webgpu.mjs, manifest.ort.wasm.mjs]) {
  if (!fs.existsSync(path.join(dist, p))) problems.push(`manifest references missing ${p}`);
}
console.log(`dist: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB`);
if (problems.length) { console.error('check-dist FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('check-dist: ok');
