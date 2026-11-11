// Pre-flight validation that runs on the first bytes of a file, before any
// expensive decoding or model inference.

import { KIND_LABEL, SUPPORTED_KINDS, readDimensions, sniffFormat, type Dimensions, type ImageKind } from './formats';
import { checkDimensions, type Limits } from './limits';

export type Validation =
  | { ok: true; kind: ImageKind; dims: Dimensions | null }
  | { ok: false; reason: string };

export function validateHeader(head: Uint8Array, fileSize: number, limits: Limits): Validation {
  if (fileSize === 0) return { ok: false, reason: 'The file is empty.' };
  if (fileSize > limits.maxFileBytes) {
    return { ok: false, reason: `The file is ${(fileSize / 1048576).toFixed(0)} MB; the limit is ${(limits.maxFileBytes / 1048576).toFixed(0)} MB.` };
  }
  const kind = sniffFormat(head);
  if (kind === 'svg') {
    return { ok: false, reason: 'SVG is a vector format, not a photo. Export it as PNG first, then add it here.' };
  }
  if (!SUPPORTED_KINDS.includes(kind)) {
    return { ok: false, reason: 'Not a supported image. BGhub accepts JPEG, PNG, WebP, HEIC/HEIF, AVIF, BMP, TIFF and GIF.' };
  }
  const dims = readDimensions(head, kind);
  if (dims) {
    const c = checkDimensions(dims.width, dims.height, limits);
    if (!c.ok) return { ok: false, reason: c.reason };
  }
  return { ok: true, kind, dims };
}

/** A cheap identity for "same file dropped twice" detection. */
export function fileFingerprint(f: { name: string; size: number; lastModified: number }): string {
  return `${f.name}\u0000${f.size}\u0000${f.lastModified}`;
}

export function describeKind(kind: ImageKind): string {
  return KIND_LABEL[kind];
}
