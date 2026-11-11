import { describe, expect, it } from 'vitest';
import { decode } from 'fast-png';
import {
  alphaBounds, applyMask, applyStroke, buildFinalMask, logitsToMask, maskStats, maskWarnings,
  refineMask, resizeMaskBilinear, DEFAULT_REFINE,
} from '../../src/lib/mask';
import { encodeRGBA, hasTransparency } from '../../src/lib/png';
import { rgbaToTensor } from '../../src/lib/preprocess';

/** w×h RGBA image: green square (fg) on grey (bg). */
function synthetic(w: number, h: number, box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const fg = x >= box.x0 * w && x < box.x1 * w && y >= box.y0 * h && y < box.y1 * h;
    rgba.set(fg ? [20, 110, 60, 255] : [235, 235, 235, 255], i * 4);
    mask[i] = fg ? 255 : 0;
  }
  return { rgba, mask };
}

describe('logitsToMask', () => {
  it('applies a sigmoid', () => {
    expect([...logitsToMask(new Float32Array([-20, 0, 20]))]).toEqual([0, 128, 255]);
  });
});

describe('resizeMaskBilinear', () => {
  it('upscales to the exact target size', () => {
    const m = resizeMaskBilinear(new Uint8Array(16).fill(200), 4, 4, 1919, 1081);
    expect(m.length).toBe(1919 * 1081);
    expect(m.every(v => v === 200)).toBe(true);
  });
  it('preserves a hard edge position when scaling', () => {
    const src = new Uint8Array(8 * 8);
    for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) src[y * 8 + x] = 255;
    const up = resizeMaskBilinear(src, 8, 8, 64, 64);
    const row = Array.from(up.subarray(32 * 64, 33 * 64));
    expect(row[0]).toBe(0);
    expect(row[63]).toBe(255);
    const mid = row.findIndex(v => v >= 128);
    expect(mid).toBeGreaterThanOrEqual(31);
    expect(mid).toBeLessThanOrEqual(33);
  });
  it('is an identity copy for equal sizes', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const out = resizeMaskBilinear(src, 2, 2, 2, 2);
    expect([...out]).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(src);
  });
});

describe('refineMask', () => {
  it('default settings only snap near-certain values', () => {
    const out = refineMask(new Uint8Array([0, 3, 4, 5, 128, 250, 251, 255]), DEFAULT_REFINE);
    expect([...out]).toEqual([0, 0, 0, 5, 128, 250, 255, 255]);
  });
  it('hardness steepens the edge around 50%', () => {
    const out = refineMask(new Uint8Array([64, 128, 192]), { cleanup: false, hardness: 100 });
    expect(out[0]).toBeLessThan(64);
    expect(Math.abs(out[1] - 128)).toBeLessThanOrEqual(4);
    expect(out[2]).toBeGreaterThan(192);
  });
  it('hardness 0 without cleanup is the identity', () => {
    const src = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...refineMask(src, { cleanup: false, hardness: 0 })]).toEqual([...src]);
  });
});

describe('applyMask (RGBA output)', () => {
  it('keeps foreground RGB exactly and makes background fully transparent', () => {
    const { rgba, mask } = synthetic(40, 30);
    const out = applyMask(rgba, mask);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 255) expect([...out.subarray(i * 4, i * 4 + 4)]).toEqual([20, 110, 60, 255]);
      else expect(out[i * 4 + 3]).toBe(0);
    }
  });
  it('multiplies with existing source alpha instead of flattening it', () => {
    const rgba = new Uint8ClampedArray([200, 10, 10, 128, 200, 10, 10, 255]);
    const out = applyMask(rgba, new Uint8Array([255, 128]));
    expect([...out]).toEqual([200, 10, 10, 128, 200, 10, 10, 128]);
  });
  it('rejects mismatched sizes', () => {
    expect(() => applyMask(new Uint8ClampedArray(8), new Uint8Array(3))).toThrow();
  });
});

describe('PNG export round trip', () => {
  it('produces a decodable RGBA PNG with identical pixels and dimensions', () => {
    const { rgba, mask } = synthetic(123, 77);
    const out = applyMask(rgba, mask);
    const png = encodeRGBA(out, 123, 77);
    const back = decode(png);
    expect(back.width).toBe(123);
    expect(back.height).toBe(77);
    expect(back.channels).toBe(4);
    expect(back.depth).toBe(8);
    expect(Buffer.from(back.data as Uint8Array).equals(Buffer.from(out))).toBe(true);
    expect(hasTransparency(back.data as Uint8Array)).toBe(true);
  });
  it('no unintended downscaling: full pipeline returns the original size', () => {
    const w = 3001, h = 1999;
    const model = new Uint8Array(1024 * 1024).fill(255);
    const m = buildFinalMask(model, 1024, w, h, DEFAULT_REFINE, []);
    expect(m.length).toBe(w * h);
  });
});

describe('alphaBounds', () => {
  it('finds the visible subject box', () => {
    const { rgba, mask } = synthetic(100, 80);
    expect(alphaBounds(applyMask(rgba, mask), 100, 80)).toEqual({ x: 25, y: 20, w: 50, h: 40 });
  });
  it('returns null for an empty cutout', () => {
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe('brush strokes', () => {
  it('erase lowers and restore raises only inside the brush', () => {
    const m = new Uint8Array(50 * 50).fill(255);
    const box = applyStroke(m, 50, 50, { mode: 'erase', radius: 5, hardness: 1, points: [25, 25] });
    expect(m[25 * 50 + 25]).toBe(0);
    expect(m[0]).toBe(255);
    expect(box).toEqual({ x: 20, y: 20, w: 11, h: 11 });
    applyStroke(m, 50, 50, { mode: 'restore', radius: 5, hardness: 1, points: [25, 25] });
    expect(m[25 * 50 + 25]).toBe(255);
  });
  it('interpolates between points', () => {
    const m = new Uint8Array(100 * 10);
    applyStroke(m, 100, 10, { mode: 'restore', radius: 2, hardness: 1, points: [5, 5, 95, 5] });
    for (let x = 5; x <= 95; x++) expect(m[5 * 100 + x]).toBe(255);
  });
  it('clips at the image edge', () => {
    const m = new Uint8Array(10 * 10);
    expect(() => applyStroke(m, 10, 10, { mode: 'restore', radius: 8, hardness: 0.5, points: [-3, -3, 12, 12] })).not.toThrow();
  });
  it('replaying strokes is deterministic (undo/redo safety)', () => {
    const model = Uint8Array.from({ length: 1024 * 1024 }, (_, i) => (i % 1024 > 512 ? 255 : 0));
    const strokes = [{ mode: 'erase' as const, radius: 10, hardness: 0.7, points: [600, 50, 700, 60] }];
    const a = buildFinalMask(model, 1024, 300, 200, DEFAULT_REFINE, strokes);
    const b = buildFinalMask(model, 1024, 300, 200, DEFAULT_REFINE, strokes);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('mask warnings', () => {
  it('flags empty, full and uncertain masks', () => {
    expect(maskWarnings(maskStats(new Uint8Array(100)))[0]).toMatch(/No clear subject/);
    expect(maskWarnings(maskStats(new Uint8Array(100).fill(255)))[0]).toMatch(/whole photo/);
    expect(maskWarnings(maskStats(new Uint8Array(100).fill(100)))).toEqual([expect.stringMatching(/No clear subject/), expect.stringMatching(/unsure/)]);
    const ok = new Uint8Array(100); ok.fill(255, 0, 40);
    expect(maskWarnings(maskStats(ok))).toEqual([]);
  });
});

describe('model input tensor', () => {
  it('normalizes with ImageNet mean/std in CHW order and flattens alpha over white', () => {
    const size = 2;
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255]);
    const t = rgbaToTensor(rgba, size);
    expect(t.length).toBe(12);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);       // R of red pixel
    expect(t[1]).toBeCloseTo((1 - 0.485) / 0.229, 4);       // transparent pixel → white
    expect(t[4 + 0]).toBeCloseTo((0 - 0.456) / 0.224, 4);   // G plane starts at n=4
  });
});
