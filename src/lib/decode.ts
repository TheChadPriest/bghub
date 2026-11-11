// Image decoding to straight (non-premultiplied) 8-bit RGBA in sRGB.
// Runs inside a worker. Strategy:
//  - PNG with alpha and no ICC profile: fast-png (exact alpha, no premultiply loss)
//  - HEIC/HEIF: browser decoder when available (Safari), otherwise libheif (WASM)
//  - TIFF: UTIF
//  - everything else: createImageBitmap (EXIF orientation + colour management by the browser)

import type { ImageKind } from './formats';

export interface Decoded {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  notes: string[];
}

export class DecodeError extends Error {
  constructor(message: string, public code: 'decode' | 'heic' | 'limits' | 'memory' = 'decode') { super(message); }
}

export interface DecodeLimits { maxPixels: number; maxSide: number }

function assertLimits(w: number, h: number, l: DecodeLimits) {
  if (!(w > 0 && h > 0)) throw new DecodeError('The image has no pixels.');
  if (w > l.maxSide || h > l.maxSide || w * h > l.maxPixels) {
    throw new DecodeError(`This image (${w}×${h}) is larger than this device can safely process.`, 'limits');
  }
}

function allocRGBA(w: number, h: number): Uint8ClampedArray {
  try { return new Uint8ClampedArray(w * h * 4); }
  catch { throw new DecodeError('Not enough memory to decode this image. Close other tabs or process fewer large images at once.', 'memory'); }
}

export async function bitmapToRGBA(bmp: ImageBitmap): Promise<Uint8ClampedArray> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new DecodeError('Canvas is unavailable in this browser.');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
}

async function viaBitmap(file: Blob, limits: DecodeLimits): Promise<Decoded> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } catch {
    throw new DecodeError('This file could not be decoded. It may be corrupted or use an unsupported variant of the format.');
  }
  try {
    assertLimits(bmp.width, bmp.height, limits);
    return { width: bmp.width, height: bmp.height, rgba: await bitmapToRGBA(bmp), notes: [] };
  } finally {
    bmp.close();
  }
}

function hasPngChunk(bytes: Uint8Array, name: string): boolean {
  // Walk chunks until IDAT; ancillary chunks we care about come before it.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let off = 8; off + 8 <= bytes.length;) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (type === name) return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    off += 12 + len;
  }
  return false;
}

async function decodePng(file: Blob, limits: DecodeLimits): Promise<Decoded> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const colorType = bytes[25];
  const hasAlpha = colorType === 4 || colorType === 6 || hasPngChunk(bytes, 'tRNS');
  if (!hasAlpha || hasPngChunk(bytes, 'iCCP') || hasPngChunk(bytes, 'acTL')) return viaBitmap(file, limits);
  const { decode, convertIndexedToRgb } = await import('fast-png');
  let png;
  try { png = decode(bytes); } catch { return viaBitmap(file, limits); }
  assertLimits(png.width, png.height, limits);
  const n = png.width * png.height;
  const out = allocRGBA(png.width, png.height);
  let src: ArrayLike<number> = png.data;
  let channels = png.channels;
  let shift = png.depth === 16 ? 8 : 0;
  if (png.palette) {
    src = convertIndexedToRgb(png);
    channels = png.transparency ? 4 : 3;
    shift = 0;
  } else if (png.depth < 8) {
    return viaBitmap(file, limits);
  }
  for (let i = 0; i < n; i++) {
    const s = i * channels, d = i * 4;
    if (channels >= 3) {
      out[d] = src[s] >> shift; out[d + 1] = src[s + 1] >> shift; out[d + 2] = src[s + 2] >> shift;
      out[d + 3] = channels === 4 ? src[s + 3] >> shift : 255;
    } else {
      const g = src[s] >> shift;
      out[d] = g; out[d + 1] = g; out[d + 2] = g;
      out[d + 3] = channels === 2 ? src[s + 1] >> shift : 255;
    }
  }
  // Single-colour tRNS on RGB/greyscale images is rare; let the browser handle it exactly.
  if (!png.palette && png.transparency && (channels === 1 || channels === 3)) return viaBitmap(file, limits);
  return { width: png.width, height: png.height, rgba: out, notes: png.depth === 16 ? ['16-bit PNG was converted to 8 bits per channel.'] : [] };
}

type LibHeif = {
  HeifDecoder: new () => {
    decode(buf: ArrayBuffer | Uint8Array): Array<{
      get_width(): number; get_height(): number; is_primary(): boolean;
      display(img: { data: Uint8ClampedArray; width: number; height: number }, cb: (r: unknown) => void): void;
      free(): void;
    }>;
  };
};
let libheifPromise: Promise<LibHeif> | null = null;

async function decodeHeic(file: Blob, limits: DecodeLimits): Promise<Decoded> {
  // Safari decodes HEIC natively, with colour management. Try that first.
  try {
    const native = await viaBitmap(file, limits);
    return native;
  } catch (e) {
    if (e instanceof DecodeError && e.code === 'limits') throw e;
  }
  libheifPromise ??= import('libheif-js/wasm-bundle').then(m => ((m as { default?: LibHeif }).default ?? m) as LibHeif);
  let lib: LibHeif;
  try { lib = await libheifPromise; } catch { libheifPromise = null; throw new DecodeError('The HEIC decoder failed to load. Check your connection and retry.', 'heic'); }
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  if (!images.length) throw new DecodeError('This HEIC/HEIF file contains no decodable image. It may be corrupted or use an unsupported codec.', 'heic');
  const primary = images.find(i => i.is_primary()) ?? images[0];
  const notes: string[] = [];
  if (images.length > 1) notes.push(`This HEIF file contains ${images.length} images (e.g. a burst or sequence). BGhub processed the primary image only.`);
  try {
    const width = primary.get_width(), height = primary.get_height();
    assertLimits(width, height, limits);
    const rgba = allocRGBA(width, height);
    await new Promise<void>((resolve, reject) => {
      primary.display({ data: rgba, width, height }, r => (r ? resolve() : reject(new DecodeError('HEIC decoding failed. The file may be corrupted.', 'heic'))));
    });
    notes.push('HEIC colours were decoded without colour management; wide-gamut (Display P3) shades may differ slightly.');
    return { width, height, rgba, notes };
  } finally {
    for (const i of images) { try { i.free(); } catch { /* already freed */ } }
  }
}

async function decodeTiff(file: Blob, limits: DecodeLimits): Promise<Decoded> {
  const UTIF = (await import('utif')).default as {
    decode(buf: ArrayBuffer): Array<{ width: number; height: number; t256?: number[]; t257?: number[] }>;
    decodeImage(buf: ArrayBuffer, ifd: unknown): void;
    toRGBA8(ifd: unknown): Uint8Array;
  };
  const buf = await file.arrayBuffer();
  let ifds;
  try { ifds = UTIF.decode(buf); } catch { throw new DecodeError('This TIFF file could not be read.'); }
  const pages = ifds.filter(i => (i.t256?.[0] ?? 0) > 0);
  const ifd = pages[0];
  if (!ifd) throw new DecodeError('This TIFF file contains no image.');
  const w = ifd.t256![0], h = ifd.t257![0];
  assertLimits(w, h, limits);
  try { UTIF.decodeImage(buf, ifd); } catch { throw new DecodeError('This TIFF uses a compression BGhub cannot decode.'); }
  const rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd).buffer);
  const notes = pages.length > 1 ? [`This TIFF has ${pages.length} pages; only the first was processed.`] : [];
  return { width: w, height: h, rgba, notes };
}

export async function decodeImage(file: Blob, kind: ImageKind, limits: DecodeLimits): Promise<Decoded> {
  switch (kind) {
    case 'png': return decodePng(file, limits);
    case 'heic': return decodeHeic(file, limits);
    case 'tiff': return decodeTiff(file, limits);
    case 'gif': {
      const d = await viaBitmap(file, limits);
      d.notes.push('GIF: only the first frame was processed.');
      return d;
    }
    case 'jpeg': case 'webp': case 'bmp': case 'avif':
      return viaBitmap(file, limits);
    default:
      throw new DecodeError('Unsupported image format.');
  }
}
