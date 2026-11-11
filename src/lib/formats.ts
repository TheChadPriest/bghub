// File signature sniffing and cheap header-only dimension parsing.
// We never trust the filename extension: the first bytes decide the format,
// and dimensions are read from headers so oversized images can be rejected
// before any pixels are decoded.

export type ImageKind =
  | 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'heic' | 'avif'
  | 'svg' | 'unknown';

export const SUPPORTED_KINDS: ImageKind[] = ['jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'heic', 'avif'];

export const KIND_LABEL: Record<ImageKind, string> = {
  jpeg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', bmp: 'BMP', tiff: 'TIFF',
  heic: 'HEIC/HEIF', avif: 'AVIF', svg: 'SVG', unknown: 'Unknown',
};

/** Bytes read from the start of a file for sniffing and header parsing. */
export const HEADER_BYTES = 512 * 1024;

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = off; i < off + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Returns the ISO-BMFF ftyp major + compatible brands, or null when there is no ftyp box. */
export function ftypBrands(b: Uint8Array): string[] | null {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const size = Math.min(dv.getUint32(0), b.length);
  const brands = [ascii(b, 8, 4)];
  for (let off = 16; off + 4 <= size; off += 4) brands.push(ascii(b, off, 4));
  return brands;
}

export function sniffFormat(b: Uint8Array): ImageKind {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'gif';
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return 'tiff';
  const brands = ftypBrands(b);
  if (brands) {
    // AVIF files also carry mif1, so check AVIF brands first.
    if (brands.some(x => AVIF_BRANDS.has(x))) return 'avif';
    if (brands.some(x => HEIF_BRANDS.has(x))) return 'heic';
    return 'unknown';
  }
  const head = ascii(b, 0, Math.min(b.length, 1024)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || ((head.startsWith('<?xml') || head.startsWith('<!doctype svg')) && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

export interface Dimensions { width: number; height: number }

/**
 * Reads pixel dimensions from the header. For JPEG and TIFF this is the stored
 * size (before EXIF orientation); orientation can swap width/height but never
 * changes the pixel count, which is what the safety limits use.
 */
export function readDimensions(b: Uint8Array, kind: ImageKind): Dimensions | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    switch (kind) {
      case 'png':
        if (ascii(b, 12, 4) !== 'IHDR') return null;
        return { width: dv.getUint32(16), height: dv.getUint32(20) };
      case 'gif':
        return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
      case 'bmp':
        return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)) };
      case 'webp': {
        const chunk = ascii(b, 12, 4);
        if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
        if (chunk === 'VP8L') {
          const bits = dv.getUint32(21, true);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8X') {
          const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
          const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
          return { width: w, height: h };
        }
        return null;
      }
      case 'jpeg': {
        let off = 2;
        while (off + 9 < b.length) {
          if (b[off] !== 0xff) { off++; continue; }
          const marker = b[off + 1];
          if (marker === 0xff) { off++; continue; }
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
          const len = dv.getUint16(off + 2);
          // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { width: dv.getUint16(off + 7), height: dv.getUint16(off + 5) };
          }
          off += 2 + len;
        }
        return null;
      }
      case 'tiff': {
        const le = b[0] === 0x49;
        const ifd = dv.getUint32(4, le);
        if (ifd + 2 > b.length) return null;
        const n = dv.getUint16(ifd, le);
        let width = 0, height = 0;
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 12 > b.length) break;
          const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le);
          const val = type === 3 ? dv.getUint16(e + 8, le) : dv.getUint32(e + 8, le);
          if (tag === 256) width = val;
          if (tag === 257) height = val;
        }
        return width && height ? { width, height } : null;
      }
      case 'heic':
      case 'avif': {
        // The largest 'ispe' (image spatial extents) box is the full image, not a tile or thumbnail.
        let best: Dimensions | null = null;
        for (let i = 4; i + 16 <= b.length; i++) {
          if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
            const w = dv.getUint32(i + 8), h = dv.getUint32(i + 12);
            if (!best || w * h > best.width * best.height) best = { width: w, height: h };
          }
        }
        return best;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
