import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { baseScale, canvasSize, coverRect, overflows, placeSubject, DEFAULT_PLACEMENT, FIT_MARGIN } from '../../src/lib/compose';
import { outputName, sanitizeBase, uniqueName } from '../../src/lib/filenames';
import { buildZip, planZipNames } from '../../src/lib/zip';
import { summarize } from '../../src/lib/batch';
import { mulberry32, makeNoise } from '../../src/features/studio/textures';

const subject = { x: 10, y: 20, w: 400, h: 200 };

describe('placement', () => {
  it('fit mode preserves aspect ratio and respects the margin', () => {
    const d = placeSubject(1000, 1000, subject, DEFAULT_PLACEMENT);
    expect(d.w / d.h).toBeCloseTo(2, 6);
    expect(d.w).toBeCloseTo(1000 * (1 - 2 * FIT_MARGIN), 6);
    expect(d.x + d.w / 2).toBeCloseTo(500);
    expect(overflows(1000, 1000, d)).toBe(false);
  });
  it('original mode keeps 1:1 pixels; scale multiplies both sides', () => {
    const d = placeSubject(1000, 1000, subject, { mode: 'original', scale: 1.5, offsetX: 0, offsetY: 0 });
    expect(d.w).toBe(600);
    expect(d.h).toBe(300);
  });
  it('offsets move the centre by a fraction of the canvas', () => {
    const d = placeSubject(800, 600, subject, { mode: 'fit', scale: 1, offsetX: 0.25, offsetY: -0.1 });
    expect(d.x + d.w / 2).toBeCloseTo(600);
    expect(d.y + d.h / 2).toBeCloseTo(240);
  });
  it('reports overflow when the subject is bigger than the canvas', () => {
    expect(overflows(100, 100, placeSubject(100, 100, subject, { mode: 'original', scale: 1, offsetX: 0, offsetY: 0 }))).toBe(true);
    expect(baseScale('fit', 100, 100, 400, 200)).toBeLessThan(1);
  });
});

describe('canvas size', () => {
  it('follows the source resolution, clamped', () => {
    expect(canvasSize('1:1', { w: 4000, h: 3000 })).toEqual({ w: 4000, h: 4000 });
    expect(canvasSize('4:5', { w: 4000, h: 3000 })).toEqual({ w: 3200, h: 4000 });
    expect(canvasSize('16:9', { w: 20000, h: 100 })).toEqual({ w: 6000, h: 3375 });
    expect(canvasSize('subject', { w: 300, h: 600 })).toEqual({ w: 300, h: 600 });
    expect(canvasSize('background', { w: 1, h: 1 }, { w: 1234, h: 567 })).toEqual({ w: 1234, h: 567 });
  });
  it('cover crop never distorts the background', () => {
    const r = coverRect(4000, 2000, 1000, 1000);
    expect(r.w / r.h).toBeCloseTo(1);
    expect(r).toEqual({ x: 1000, y: 0, w: 2000, h: 2000 });
  });
});

describe('filenames', () => {
  it('sanitizes but keeps meaningful parts, including non-Latin text', () => {
    expect(sanitizeBase('IMG_1234 (copy).HEIC')).toBe('IMG_1234 -copy');
    expect(sanitizeBase('../../etc/passwd')).toBe('passwd');
    expect(sanitizeBase('<b>"sale" 50%</b>.png')).toBe('b');
    expect(sanitizeBase('a<b>"c"|d?.png')).toBe('a-b-c-d');
    expect(sanitizeBase('ジャケット.jpg')).toBe('ジャケット');
    expect(sanitizeBase('...')).toBe('image');
    expect(sanitizeBase('con.png')).toBe('con-file');
    expect(outputName('shirt.jpeg', '-cutout', 'png')).toBe('shirt-cutout.png');
  });
  it('resolves ZIP name collisions case-insensitively', () => {
    const taken = new Set<string>();
    expect(uniqueName('a.png', taken)).toBe('a.png');
    expect(uniqueName('A.png', taken)).toBe('A (2).png');
    expect(uniqueName('a.png', taken)).toBe('a (3).png');
    expect(planZipNames(['shirt.jpg', 'shirt.png', 'shirt.HEIC', 'bag.jpg'])).toEqual([
      'shirt-cutout.png', 'shirt-cutout (2).png', 'shirt-cutout (3).png', 'bag-cutout.png',
    ]);
  });
});

describe('ZIP export', () => {
  it('contains every file byte-for-byte under unique names', async () => {
    const names = planZipNames(['a.jpg', 'a.jpg']);
    const blob = await buildZip([
      { name: names[0], blob: new Blob([new Uint8Array([1, 2, 3])]) },
      { name: names[1], blob: new Blob([new Uint8Array([4, 5])]) },
    ]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['a-cutout (2).png', 'a-cutout.png']);
    expect([...files['a-cutout.png']]).toEqual([1, 2, 3]);
    expect([...files['a-cutout (2).png']]).toEqual([4, 5]);
  });
});

describe('batch summary', () => {
  it('counts statuses independently', () => {
    const s = summarize([
      { status: 'done', selected: true }, { status: 'done', selected: false }, { status: 'failed', selected: true },
      { status: 'cancelled', selected: true }, { status: 'analyzing', selected: true }, { status: 'queued', selected: true },
      { status: 'waiting-model', selected: true },
    ]);
    expect(s).toEqual({ total: 7, done: 2, failed: 1, cancelled: 1, active: 2, queued: 1, selectedDone: 1 });
  });
});

describe('procedural textures', () => {
  it('are deterministic (preview == export)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    const n1 = makeNoise(7), n2 = makeNoise(7);
    expect(n1(0.3, 0.7)).toBe(n2(0.3, 0.7));
    const v = n1(12.34, 5.67);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
