// Offline evaluation of the segmentation model on real photos (Node, onnxruntime-node).
// Usage: node scripts/model-eval.mjs <model.onnx> <outDir> <img...>
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
const [model, outDir, ...imgs] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const S = 1024, mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
const t0 = performance.now();
const session = await ort.InferenceSession.create(model, { logSeverityLevel: 3 });
console.log('init ms', Math.round(performance.now() - t0));
for (const f of imgs) {
  const img = sharp(f).rotate();
  const { data: rgb, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const small = await sharp(rgb, { raw: info }).resize(S, S, { fit: 'fill', kernel: 'linear' }).raw().toBuffer();
  const x = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) x[c * S * S + i] = (small[i * 3 + c] / 255 - mean[c]) / std[c];
  const t1 = performance.now();
  const out = await session.run({ input_image: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const y = out.output_image.data;
  let mn = Infinity, mx = -Infinity; for (const v of y) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const m8 = new Uint8Array(S * S); for (let i = 0; i < S * S; i++) m8[i] = Math.round(255 / (1 + Math.exp(-y[i])));
  const mask = await sharp(m8, { raw: { width: S, height: S, channels: 1 } }).resize(info.width, info.height, { kernel: 'linear', fit: 'fill' }).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) { rgba[i*4]=rgb[i*3]; rgba[i*4+1]=rgb[i*3+1]; rgba[i*4+2]=rgb[i*3+2]; rgba[i*4+3]=mask[i]; }
  const base = path.basename(f, path.extname(f));
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(outDir, base + '.png'));
  // preview over checker-ish gray for inspection
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).flatten({ background: '#3a8f3a' }).resize(800).jpeg().toFile(path.join(outDir, base + '_preview.jpg'));
  console.log(base, info.width + 'x' + info.height, 'raw range', mn.toFixed(2), mx.toFixed(2), 'infer ms', Math.round(performance.now() - t1));
}
