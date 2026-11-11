// Confirms the patched model produces the same mask as the original
// (within 3/255: fp16 models differ slightly by evaluation order).
// Usage: node scripts/verify-patch.mjs <original.onnx> <patched.onnx> <image>
import ort from 'onnxruntime-node';
import sharp from 'sharp';

const [a, b, img] = process.argv.slice(2);
const S = 1024, mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
const px = await sharp(img).rotate().removeAlpha().resize(S, S, { fit: 'fill' }).raw().toBuffer();
const x = new Float32Array(3 * S * S);
for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) x[c * S * S + i] = (px[i * 3 + c] / 255 - mean[c]) / std[c];
const run = async m => {
  const s = await ort.InferenceSession.create(m, { logSeverityLevel: 3 });
  const o = await s.run({ input_image: new ort.Tensor('float32', x, [1, 3, S, S]) });
  return o.output_image.data;
};
const ya = await run(a), yb = await run(b);
// Compare in logits and in the 8-bit alpha the app actually uses.
const alpha = v => Math.round(255 / (1 + Math.exp(-v)));
let maxDiff = 0, maxAlpha = 0;
for (let i = 0; i < ya.length; i++) {
  maxDiff = Math.max(maxDiff, Math.abs(ya[i] - yb[i]));
  maxAlpha = Math.max(maxAlpha, Math.abs(alpha(ya[i]) - alpha(yb[i])));
}
console.log('max |Δlogit| =', maxDiff, ' max |Δalpha| (0-255) =', maxAlpha);
process.exit(maxAlpha <= 3 ? 0 : 1);
