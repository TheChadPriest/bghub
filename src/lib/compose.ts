// Layout math for placing the cutout on a background. The subject's aspect
// ratio is always preserved: width and height are derived from one scale factor.

import type { Box } from './mask';

export type PlacementMode = 'fit' | 'original';

export interface Placement {
  mode: PlacementMode;
  /** Multiplier on top of the mode's base size; 1 = 100%. */
  scale: number;
  /** Offset of the subject centre from the canvas centre, as a fraction of canvas width/height. */
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_PLACEMENT: Placement = { mode: 'fit', scale: 1, offsetX: 0, offsetY: 0 };

/** Margin kept around the subject in "fit" mode, as a fraction of the canvas. */
export const FIT_MARGIN = 0.08;

export function baseScale(mode: PlacementMode, canvasW: number, canvasH: number, subjectW: number, subjectH: number): number {
  if (mode === 'original') return 1;
  const availW = canvasW * (1 - 2 * FIT_MARGIN), availH = canvasH * (1 - 2 * FIT_MARGIN);
  return Math.min(availW / subjectW, availH / subjectH);
}

/** Destination rectangle of the subject's bounding box on the canvas. */
export function placeSubject(canvasW: number, canvasH: number, subject: Box, p: Placement): Box {
  const s = baseScale(p.mode, canvasW, canvasH, subject.w, subject.h) * p.scale;
  const w = subject.w * s, h = subject.h * s;
  const cx = canvasW / 2 + p.offsetX * canvasW, cy = canvasH / 2 + p.offsetY * canvasH;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** True when the placed subject extends past the canvas (it will be cropped by the canvas edge). */
export function overflows(canvasW: number, canvasH: number, dest: Box): boolean {
  return dest.x < -0.5 || dest.y < -0.5 || dest.x + dest.w > canvasW + 0.5 || dest.y + dest.h > canvasH + 0.5;
}

export type AspectChoice = 'subject' | 'background' | '1:1' | '4:5' | '3:4' | '16:9';

/**
 * Output canvas size. The long side follows the source photo (clamped to a sane
 * range) so a high-resolution cutout is not thrown away.
 */
export function canvasSize(aspect: AspectChoice, source: { w: number; h: number }, background?: { w: number; h: number }): { w: number; h: number } {
  if (aspect === 'background' && background) return { w: background.w, h: background.h };
  // Never upscale the cutout by default: the canvas is at most the source's resolution.
  const long = Math.min(6000, Math.max(source.w, source.h));
  let ratio: number;
  switch (aspect) {
    case '1:1': ratio = 1; break;
    case '4:5': ratio = 4 / 5; break;
    case '3:4': ratio = 3 / 4; break;
    case '16:9': ratio = 16 / 9; break;
    default: ratio = source.w / source.h;
  }
  return ratio >= 1 ? { w: long, h: Math.round(long / ratio) } : { w: Math.round(long * ratio), h: long };
}

/** Source rectangle that covers a canvas with an image without distortion (centre crop). */
export function coverRect(imgW: number, imgH: number, canvasW: number, canvasH: number): Box {
  const s = Math.max(canvasW / imgW, canvasH / imgH);
  const w = canvasW / s, h = canvasH / s;
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}
