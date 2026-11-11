// Safety limits derived from realistic browser memory, not arbitrary file sizes.

export interface Limits {
  /** Maximum decoded pixel count (width * height). */
  maxPixels: number;
  /** Maximum width or height. Browsers refuse larger canvases. */
  maxSide: number;
  /** Maximum compressed file size accepted. */
  maxFileBytes: number;
}

interface NavLike { userAgent?: string; deviceMemory?: number; maxTouchPoints?: number }

export function isAppleMobile(nav: NavLike): boolean {
  const ua = nav.userAgent ?? '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

export function defaultLimits(nav: NavLike = (globalThis.navigator ?? {}) as NavLike): Limits {
  // iOS/iPadOS Safari caps a canvas at ~16.7 megapixels.
  const apple = isAppleMobile(nav);
  const mem = nav.deviceMemory ?? 8;
  const maxPixels = apple ? 16_000_000 : mem <= 2 ? 24_000_000 : 50_000_000;
  return { maxPixels, maxSide: apple ? 8192 : 16384, maxFileBytes: 200 * 1024 * 1024 };
}

/** Rough peak bytes while processing one image: source RGBA + output RGBA + mask + encoder buffers. */
export function estimatePeakBytes(width: number, height: number): number {
  const px = width * height;
  return px * 4 + px * 4 + px + px * 2;
}

export type LimitCheck = { ok: true } | { ok: false; reason: string };

export function checkDimensions(width: number, height: number, limits: Limits): LimitCheck {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { ok: false, reason: 'The image header reports invalid dimensions.' };
  }
  if (width > limits.maxSide || height > limits.maxSide) {
    return { ok: false, reason: `${width}×${height} exceeds this browser's ${limits.maxSide}px per-side limit.` };
  }
  if (width * height > limits.maxPixels) {
    const mp = (width * height / 1e6).toFixed(1);
    return { ok: false, reason: `${mp} MP is above the ${(limits.maxPixels / 1e6).toFixed(0)} MP safety limit for this device.` };
  }
  return { ok: true };
}
