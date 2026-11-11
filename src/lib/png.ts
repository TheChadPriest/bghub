// Lossless PNG encoding from straight RGBA. We encode ourselves (instead of
// canvas.toBlob) because canvases store premultiplied alpha, which would
// quantise the colours of semi-transparent edge pixels.

import { encode } from 'fast-png';

export function encodeRGBA(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, level = 6): Uint8Array {
  return encode({ width, height, data: rgba, channels: 4, depth: 8 }, { zlib: { level: level as 6 } });
}

export function hasTransparency(rgba: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
}
