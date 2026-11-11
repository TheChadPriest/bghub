// Model input preparation for BiRefNet (ImageNet mean/std, CHW float32).

export const MODEL_SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * Converts a MODEL_SIZE² RGBA buffer (already resized) into a normalized CHW tensor.
 * Transparent source pixels are flattened over white so the model sees a neutral backdrop;
 * the source alpha itself is re-applied to the final cutout, so nothing is lost.
 */
export function rgbaToTensor(rgba: Uint8ClampedArray | Uint8Array, size = MODEL_SIZE): Float32Array {
  const n = size * size;
  if (rgba.length !== n * 4) throw new Error(`Expected ${size}x${size} RGBA input`);
  const out = new Float32Array(3 * n);
  const scale = [1 / (255 * STD[0]), 1 / (255 * STD[1]), 1 / (255 * STD[2])];
  const bias = [-MEAN[0] / STD[0], -MEAN[1] / STD[1], -MEAN[2] / STD[2]];
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3];
    for (let c = 0; c < 3; c++) {
      const v = a === 255 ? rgba[j + c] : (rgba[j + c] * a + 255 * (255 - a)) / 255;
      out[c * n + i] = v * scale[c] + bias[c];
    }
  }
  return out;
}
