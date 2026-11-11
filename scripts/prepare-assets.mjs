// Fetches the pinned segmentation model, verifies its checksum, rewrites the
// graph for browsers (scripts/patch-model.py), checks the rewritten model
// still produces the same masks (scripts/verify-patch.mjs), and splits it plus
// the ONNX Runtime WebAssembly binaries into <=20 MiB chunks under public/bin/.
// Static hosts cap file sizes (Cloudflare Pages: 25 MiB), and serving these
// from our own origin means no third-party requests at runtime.
//
// Usage: node scripts/prepare-assets.mjs        (uses .cache/ if present)
//        BGHUB_MODEL_FILE=path node scripts/...  (use a local copy of the model)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'bin');
const cacheDir = path.join(root, '.cache');
const CHUNK = 20 * 1024 * 1024;

export const MODEL = {
  id: 'onnx-community/BiRefNet_lite-ONNX',
  revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
  file: 'onnx/model_fp16.onnx',
  sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
  size: 114538221,
  license: 'MIT',
  inputSize: 1024,
};
const modelUrl = `https://huggingface.co/${MODEL.id}/resolve/${MODEL.revision}/${MODEL.file}`;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const patchScript = path.join(root, 'scripts', 'patch-model.py');
/** Identifies a patched model: upstream checksum + patch script contents. */
const patchStamp = () => `${MODEL.sha256}:${sha256(fs.readFileSync(patchScript))}`;

/** Upstream model → browser-ready model (see scripts/patch-model.py). */
async function getPatchedModel() {
  const patched = path.join(cacheDir, 'model_fp16_bghub.onnx');
  const stamp = path.join(cacheDir, 'model_fp16_bghub.stamp');
  if (fs.existsSync(patched) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === patchStamp()) {
    console.log('model: using cached patched model');
    return fs.readFileSync(patched);
  }
  const original = await getModelBytes();
  const src = path.join(cacheDir, 'model_fp16.onnx');
  if (!fs.existsSync(src)) fs.writeFileSync(src, original);
  console.log('model: rewriting graph for browsers (python scripts/patch-model.py)');
  const py = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(py, [patchScript, src, patched], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Model patch failed. Install Python 3 with `pip install onnx numpy`.');
  console.log('model: verifying patched output against the original');
  const v = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-patch.mjs'), src, patched, path.join(root, 'tests', 'fixtures', 'jacket.jpg')], { stdio: 'inherit' });
  if (v.status !== 0) throw new Error('Patched model output differs from the original.');
  fs.writeFileSync(stamp, patchStamp());
  return fs.readFileSync(patched);
}

async function getModelBytes() {
  const candidates = [process.env.BGHUB_MODEL_FILE, path.join(cacheDir, 'model_fp16.onnx')].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const b = fs.readFileSync(c);
      if (sha256(b) === MODEL.sha256) { console.log(`model: using ${c}`); return b; }
      console.warn(`model: ${c} has the wrong checksum, ignoring`);
    }
  }
  console.log(`model: downloading ${modelUrl}`);
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  if (sha256(b) !== MODEL.sha256) throw new Error('model checksum mismatch');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'model_fp16.onnx'), b);
  return b;
}

function writeChunks(buf, dir, prefix) {
  fs.mkdirSync(path.join(outDir, dir), { recursive: true });
  const parts = [];
  for (let off = 0, i = 0; off < buf.length; off += CHUNK, i++) {
    const name = `${dir}/${prefix}.part${String(i).padStart(2, '0')}.bin`;
    fs.writeFileSync(path.join(outDir, name), buf.subarray(off, off + CHUNK));
    parts.push(`bin/${name}`);
  }
  return parts;
}

const ortPkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
const ortDist = path.join(root, 'node_modules/onnxruntime-web/dist');

const manifestPath = path.join(outDir, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const ok = m.model?.stamp === patchStamp() && m.ort?.version === ortPkg.version && m.model.parts.every(p => fs.existsSync(path.join(root, 'public', p)));
  if (ok) { console.log('assets: up to date'); process.exit(0); }
}
fs.rmSync(outDir, { recursive: true, force: true });

const modelBytes = await getPatchedModel();
const modelSha = sha256(modelBytes);
const modelDir = `model-${modelSha.slice(0, 12)}`;
const manifest = {
  model: {
    id: MODEL.id, revision: MODEL.revision, sourceFile: MODEL.file, sourceSha256: MODEL.sha256, sourceUrl: modelUrl,
    license: MODEL.license, inputSize: MODEL.inputSize, patch: 'scripts/patch-model.py', stamp: patchStamp(),
    sha256: modelSha, size: modelBytes.length, parts: writeChunks(modelBytes, modelDir, 'birefnet-lite-fp16'),
  },
  ort: { version: ortPkg.version },
};
for (const [key, file] of [['webgpu', 'ort-wasm-simd-threaded.asyncify'], ['wasm', 'ort-wasm-simd-threaded']]) {
  const wasm = fs.readFileSync(path.join(ortDist, `${file}.wasm`));
  const dir = `ort-${ortPkg.version}`;
  const parts = writeChunks(wasm, dir, file);
  fs.copyFileSync(path.join(ortDist, `${file}.mjs`), path.join(outDir, dir, `${file}.mjs`));
  manifest.ort[key] = { sha256: sha256(wasm), size: wasm.length, parts, mjs: `bin/${dir}/${file}.mjs` };
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('assets: wrote', path.relative(root, manifestPath));
