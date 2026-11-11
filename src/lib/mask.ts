// Alpha-mask math. Everything here works on plain typed arrays so it can run
// in workers and be unit-tested without a browser.
//
// Subject preservation rule: these functions only ever change ALPHA. Source
// RGB is copied through untouched for every pixel that stays visible.

export type Mask = Uint8Array;

/** Model output is raw logits; convert to 0..255 foreground probability. */
export function logitsToMask(logits: Float32Array): Mask {
  const out = new Uint8Array(logits.length);
  for (let i = 0; i < logits.length; i++) out[i] = Math.round(255 / (1 + Math.exp(-logits[i])));
  return out;
}

/**
 * Bilinear resize of a single-channel mask using pixel-centre alignment.
 * Used to bring the model's 1024x1024 prediction back to the original image size.
 */
export function resizeMaskBilinear(src: Mask, sw: number, sh: number, dw: number, dh: number): Mask {
  const out = new Uint8Array(dw * dh);
  if (sw === dw && sh === dh) { out.set(src); return out; }
  const sx = sw / dw, sy = sh / dh;
  // Precompute horizontal taps once per column.
  const x0s = new Int32Array(dw), x1s = new Int32Array(dw), fxs = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), sw - 1);
    const x0 = Math.floor(fx);
    x0s[x] = x0; x1s[x] = Math.min(x0 + 1, sw - 1); fxs[x] = fx - x0;
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), sh - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, sh - 1), wy = fy - y0;
    const r0 = y0 * sw, r1 = y1 * sw, o = y * dw;
    for (let x = 0; x < dw; x++) {
      const wx = fxs[x], a = x0s[x], b = x1s[x];
      const top = src[r0 + a] + (src[r0 + b] - src[r0 + a]) * wx;
      const bot = src[r1 + a] + (src[r1 + b] - src[r1 + a]) * wx;
      out[o + x] = Math.round(top + (bot - top) * wy);
    }
  }
  return out;
}

export interface RefineOptions {
  /** Snap near-certain values (≤4 → 0, ≥251 → 255) to remove faint haze and pinholes. */
  cleanup: boolean;
  /** 0 = model's soft edge as-is; 100 = much crisper edge. */
  hardness: number;
}

export const DEFAULT_REFINE: RefineOptions = { cleanup: true, hardness: 0 };

/** Conservative tone curve on the mask; it never moves an edge more than the model's own uncertainty band. */
export function refineMask(mask: Mask, opts: RefineOptions): Mask {
  const lut = new Uint8Array(256);
  const k = 1 + Math.max(0, Math.min(100, opts.hardness)) / 20; // 1..6
  for (let v = 0; v < 256; v++) {
    let a = v;
    if (k !== 1) a = Math.round(Math.min(1, Math.max(0, (v / 255 - 0.5) * k + 0.5)) * 255);
    if (opts.cleanup) { if (a <= 4) a = 0; else if (a >= 251) a = 255; }
    lut[v] = a;
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = lut[mask[i]];
  return out;
}

/**
 * Builds the RGBA cutout: alpha = sourceAlpha × mask. RGB is copied unchanged
 * except where the result is fully transparent (invisible), where it is zeroed
 * so the PNG compresses better.
 */
export function applyMask(rgba: Uint8ClampedArray | Uint8Array, mask: Mask): Uint8ClampedArray {
  const n = mask.length;
  if (rgba.length !== n * 4) throw new Error('Mask and image sizes differ');
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = mask[i] === 255 ? rgba[j + 3] : ((rgba[j + 3] * mask[i] + 127) / 255) | 0;
    if (a === 0) continue;
    out[j] = rgba[j]; out[j + 1] = rgba[j + 1]; out[j + 2] = rgba[j + 2]; out[j + 3] = a;
  }
  return out;
}

export interface Box { x: number; y: number; w: number; h: number }

/** Bounding box of pixels with alpha above `threshold`; null when nothing is visible. */
export function alphaBounds(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 8): Box | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface MaskStats { coverage: number; uncertain: number }

export function maskStats(mask: Mask): MaskStats {
  let fg = 0, mid = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v > 127) fg++;
    if (v > 32 && v < 223) mid++;
  }
  return { coverage: fg / mask.length, uncertain: mid / mask.length };
}

/** Human-readable warnings when the prediction looks unreliable. */
export function maskWarnings(s: MaskStats): string[] {
  const w: string[] = [];
  if (s.coverage < 0.003) w.push('No clear subject was found. Try a photo where the item stands out, or restore it with the brush.');
  else if (s.coverage > 0.97) w.push('Almost the whole photo was kept as foreground. Check the result and erase leftovers with the brush.');
  if (s.uncertain > 0.2) w.push('The model was unsure about large areas. Review the edges before using this cutout.');
  return w;
}

export type BrushMode = 'restore' | 'erase';

export interface Stroke {
  mode: BrushMode;
  /** Radius in source-image pixels. */
  radius: number;
  /** 0..1 — share of the radius that is fully opaque before the soft falloff. */
  hardness: number;
  /** Flat [x0, y0, x1, y1, ...] list in source-image pixels. */
  points: number[];
}

/** Paints one stroke into the mask in place. Returns the touched box (for partial redraws). */
export function applyStroke(mask: Mask, width: number, height: number, s: Stroke): Box | null {
  const pts = s.points;
  if (pts.length < 2) return null;
  const r = Math.max(0.5, s.radius);
  const inner = r * Math.max(0, Math.min(1, s.hardness));
  const spacing = Math.max(1, r / 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const dab = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const f = d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-6, r - inner);
        const i = y * width + x;
        if (s.mode === 'restore') { const v = Math.round(255 * f); if (v > mask[i]) mask[i] = v; }
        else { const v = Math.round(255 * (1 - f)); if (v < mask[i]) mask[i] = v; }
      }
    }
  };
  dab(pts[0], pts[1]);
  for (let k = 2; k + 1 < pts.length; k += 2) {
    const ax = pts[k - 2], ay = pts[k - 1], bx = pts[k], by = pts[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
    for (let t = 1; t <= steps; t++) dab(ax + (bx - ax) * t / steps, ay + (by - ay) * t / steps);
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Full mask pipeline: model mask → original size → refine → manual strokes. */
export function buildFinalMask(
  modelMask: Mask, modelSize: number, width: number, height: number,
  refine: RefineOptions, strokes: Stroke[],
): Mask {
  const up = resizeMaskBilinear(modelMask, modelSize, modelSize, width, height);
  const m = refineMask(up, refine);
  for (const s of strokes) applyStroke(m, width, height, s);
  return m;
}
