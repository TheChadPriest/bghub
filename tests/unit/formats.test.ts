import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readDimensions, sniffFormat, HEADER_BYTES } from '../../src/lib/formats';
import { validateHeader, fileFingerprint } from '../../src/lib/validate';
import { checkDimensions, defaultLimits } from '../../src/lib/limits';

const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, '../fixtures', n))).subarray(0, HEADER_BYTES);
const limits = { maxPixels: 50_000_000, maxSide: 16384, maxFileBytes: 200 * 1048576 };

describe('sniffFormat', () => {
  it.each([
    ['jacket.jpg', 'jpeg'], ['bag.png', 'png'], ['bag.webp', 'webp'], ['bag.bmp', 'bmp'], ['bag.tiff', 'tiff'],
    ['bag.heic', 'heic'], ['bag-rotated.heic', 'heic'], ['bag-multi.heic', 'heic'], ['vector.svg', 'svg'],
    ['not-an-image.jpg', 'unknown'],
  ])('%s → %s', (file, kind) => {
    expect(sniffFormat(fx(file))).toBe(kind);
  });

  it('ignores the file extension (text named .jpg is unknown)', () => {
    expect(sniffFormat(new TextEncoder().encode('GIF89a but actually text'))).toBe('gif');
    expect(sniffFormat(new TextEncoder().encode('hello'))).toBe('unknown');
  });

  it('distinguishes AVIF from HEIC even though both carry mif1', () => {
    const box = (brands: string[]) => {
      const b = new Uint8Array(8 + 8 + brands.length * 4);
      const dv = new DataView(b.buffer);
      dv.setUint32(0, b.length);
      b.set(new TextEncoder().encode('ftyp'), 4);
      b.set(new TextEncoder().encode(brands[0]), 8);
      brands.slice(1).forEach((br, i) => b.set(new TextEncoder().encode(br), 16 + i * 4));
      return new Uint8Array([...b, ...new Uint8Array(16)]);
    };
    expect(sniffFormat(box(['avif', 'mif1', 'miaf']))).toBe('avif');
    expect(sniffFormat(box(['mif1', 'mif1', 'avif']))).toBe('avif');
    expect(sniffFormat(box(['heic', 'mif1', 'heic']))).toBe('heic');
    expect(sniffFormat(box(['mif1', 'mif1', 'heic']))).toBe('heic');
    expect(sniffFormat(box(['isom', 'mp41']))).toBe('unknown');
  });
});

describe('readDimensions', () => {
  it.each([
    ['jacket.jpg', 'jpeg', 960, 857], ['bag.png', 'png', 900, 870], ['bag.webp', 'webp', 900, 870],
    ['bag.bmp', 'bmp', 900, 870], ['bag.tiff', 'tiff', 900, 870], ['bag.heic', 'heic', 900, 870],
    ['huge-dimensions.png', 'png', 60000, 60000],
  ] as const)('%s', (file, kind, w, h) => {
    expect(readDimensions(fx(file), kind)).toEqual({ width: w, height: h });
  });

  it('reports stored (pre-orientation) size for EXIF-rotated JPEG', () => {
    expect(readDimensions(fx('bag-exif-rotated.jpg'), 'jpeg')).toEqual({ width: 870, height: 900 });
  });

  it('returns the primary image size for multi-image HEIF', () => {
    expect(readDimensions(fx('bag-multi.heic'), 'heic')).toEqual({ width: 900, height: 870 });
  });

  it('returns null rather than throwing on truncated data', () => {
    expect(readDimensions(fx('corrupt.jpg'), 'jpeg')).toBeNull();
    expect(readDimensions(new Uint8Array([0x89, 0x50]), 'png')).toBeNull();
  });
});

describe('validateHeader', () => {
  it('accepts supported images', () => {
    const v = validateHeader(fx('bag.heic'), 205805, limits);
    expect(v).toEqual({ ok: true, kind: 'heic', dims: { width: 900, height: 870 } });
  });
  it('rejects SVG with an explanation', () => {
    const v = validateHeader(fx('vector.svg'), 99, limits);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/vector/i);
  });
  it('rejects non-images, empty files and oversize files', () => {
    expect(validateHeader(fx('not-an-image.jpg'), 51, limits).ok).toBe(false);
    expect(validateHeader(new Uint8Array(), 0, limits).ok).toBe(false);
    expect(validateHeader(fx('jacket.jpg'), 300 * 1048576, limits).ok).toBe(false);
  });
  it('rejects decompression bombs from the header alone', () => {
    const v = validateHeader(fx('huge-dimensions.png'), 75, limits);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/limit/);
  });
  it('fingerprints files by name, size and mtime', () => {
    expect(fileFingerprint({ name: 'a.jpg', size: 1, lastModified: 2 })).not.toBe(fileFingerprint({ name: 'a.jpg', size: 1, lastModified: 3 }));
  });
});

describe('limits', () => {
  it('uses a lower ceiling on iPhone/iPad', () => {
    expect(defaultLimits({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }).maxPixels).toBe(16_000_000);
    expect(defaultLimits({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', deviceMemory: 8 }).maxPixels).toBe(50_000_000);
  });
  it('checks side length and pixel count', () => {
    expect(checkDimensions(5000, 4000, limits).ok).toBe(true);
    expect(checkDimensions(20000, 10, limits).ok).toBe(false);
    expect(checkDimensions(10000, 10000, limits).ok).toBe(false);
    expect(checkDimensions(0, 10, limits).ok).toBe(false);
  });
});
