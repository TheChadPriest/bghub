/// <reference lib="webworker" />
// Decode → model input, and model mask → full-resolution transparent PNG.
// The decoded original stays here (keyed by job) between the two steps so the
// main thread never has to hold full-resolution pixels for queued jobs.

import { decodeImage, DecodeError } from '../lib/decode';
import { MODEL_SIZE, rgbaToTensor } from '../lib/preprocess';
import { alphaBounds, applyMask, buildFinalMask, maskStats } from '../lib/mask';
import { encodeRGBA, hasTransparency } from '../lib/png';
import type { CutoutResult, ImageWorkerRequest, ImageWorkerResponse } from '../engine/protocol';

declare const self: DedicatedWorkerGlobalScope;

interface Held { attempt: number; width: number; height: number; rgba: Uint8ClampedArray }
const held = new Map<string, Held>();

const post = (msg: ImageWorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function ctx2d(c: OffscreenCanvas) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D is not available');
  return ctx;
}

async function toBitmap(rgba: Uint8ClampedArray, width: number, height: number) {
  return createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), { premultiplyAlpha: 'premultiply' });
}

/** Model input: stretch to MODEL_SIZE² exactly as BiRefNet was trained (no letterboxing). */
async function makeTensor(bmp: ImageBitmap): Promise<Float32Array> {
  const c = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, MODEL_SIZE, MODEL_SIZE);
  return rgbaToTensor(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data);
}

/** Small display copy (never used for export). */
async function makePreview(bmp: ImageBitmap, maxSide: number, type: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<Blob> {
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = new OffscreenCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  try { return await c.convertToBlob({ type, quality: 0.86 }); }
  catch { return c.convertToBlob({ type: 'image/png' }); }
}

async function supportsWebpAlpha(): Promise<boolean> {
  try {
    const b = await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/webp' });
    return b.type === 'image/webp';
  } catch { return false; }
}
const webpOk = supportsWebpAlpha();

async function buildCutout(rgba: Uint8ClampedArray, mask: Uint8Array, width: number, height: number, onExport?: () => void): Promise<CutoutResult> {
  const out = applyMask(rgba, mask);
  onExport?.();
  const png = new Blob([encodeRGBA(out, width, height) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  const bmp = await toBitmap(out, width, height);
  try {
    const preview = await makePreview(bmp, 1600, (await webpOk) ? 'image/webp' : 'image/png');
    return { png, preview, width, height, bbox: alphaBounds(out, width, height), hasTransparency: hasTransparency(out) };
  } finally { bmp.close(); }
}

function fail(req: { jobId?: string; reqId?: string; attempt?: number }, e: unknown) {
  const code = e instanceof DecodeError ? e.code : e instanceof RangeError ? 'memory' : 'unknown';
  const message = e instanceof DecodeError ? e.message
    : e instanceof RangeError ? 'Ran out of memory while processing this image. Try processing fewer large images at once.'
    : 'Something went wrong while processing this image.';
  if (!(e instanceof DecodeError)) console.error('[bghub:image-worker]', e);
  post({ type: 'error', jobId: req.jobId, reqId: req.reqId, attempt: req.attempt, message, code });
}

self.onmessage = async (ev: MessageEvent<ImageWorkerRequest>) => {
  const req = ev.data;
  switch (req.type) {
    case 'decode': {
      const t0 = performance.now();
      try {
        const d = await decodeImage(req.file, req.kind, req);
        const bmp = await toBitmap(d.rgba, d.width, d.height);
        let tensor: Float32Array, preview: Blob;
        try {
          tensor = await makeTensor(bmp);
          preview = await makePreview(bmp, 1600, 'image/jpeg');
        } finally { bmp.close(); }
        held.set(req.jobId, { attempt: req.attempt, width: d.width, height: d.height, rgba: d.rgba });
        post({ type: 'decoded', jobId: req.jobId, attempt: req.attempt, width: d.width, height: d.height, tensor, preview, notes: d.notes, ms: performance.now() - t0 }, [tensor.buffer]);
      } catch (e) { fail(req, e); }
      break;
    }
    case 'finish': {
      const h = held.get(req.jobId);
      if (!h || h.attempt !== req.attempt) { post({ type: 'error', jobId: req.jobId, attempt: req.attempt, message: 'The decoded image was released before export. Please retry.', code: 'unknown' }); break; }
      const t0 = performance.now();
      try {
        post({ type: 'stage', jobId: req.jobId, attempt: req.attempt, stage: 'refining' });
        const mask = buildFinalMask(req.mask, MODEL_SIZE, h.width, h.height, req.refine, []);
        const r = await buildCutout(h.rgba, mask, h.width, h.height, () => post({ type: 'stage', jobId: req.jobId, attempt: req.attempt, stage: 'exporting' }));
        post({ type: 'finished', jobId: req.jobId, attempt: req.attempt, stats: maskStats(req.mask), ms: performance.now() - t0, ...r });
      } catch (e) { fail(req, e); }
      finally { held.delete(req.jobId); }
      break;
    }
    case 'release':
      held.delete(req.jobId);
      break;
    case 'load-source': {
      try {
        const d = await decodeImage(req.file, req.kind, req);
        post({ type: 'source', reqId: req.reqId, rgba: d.rgba, width: d.width, height: d.height }, [d.rgba.buffer]);
      } catch (e) { fail(req, e); }
      break;
    }
    case 'encode-cutout': {
      try {
        const r = await buildCutout(req.rgba, req.mask, req.width, req.height);
        post({ type: 'encoded', reqId: req.reqId, ...r });
      } catch (e) { fail(req, e); }
      break;
    }
  }
};
