import { placeSubject, coverRect, type Placement } from '../../lib/compose';
import type { Box } from '../../lib/mask';
import { renderPreset, type Preset } from './presets';
import type { Ctx } from './textures';

export type BackgroundChoice =
  | { type: 'transparent' }
  | { type: 'preset'; preset: Preset }
  | { type: 'image'; bitmap: ImageBitmap; name: string };

export interface SceneSubject {
  bitmap: ImageBitmap;      // the full-resolution cutout PNG, decoded
  bbox: Box;                // visible area of the cutout
}

export interface Scene {
  width: number;            // output canvas size
  height: number;
  background: BackgroundChoice;
  subject: SceneSubject;
  placement: Placement;
  shadow: boolean;
}

/**
 * Draws the scene into a canvas of any size; `ctx` dimensions may be smaller
 * than the scene (preview), everything is scaled proportionally.
 */
export function renderScene(ctx: Ctx, cw: number, ch: number, scene: Scene, opts: { showBackground?: boolean } = {}) {
  const k = cw / scene.width;
  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const bg = scene.background;
  if (opts.showBackground !== false) {
    if (bg.type === 'preset') {
      if (bg.preset.flat) bg.preset.draw(ctx, cw, ch);
      else {
        const tex = renderPreset(bg.preset, scene.width, scene.height);
        ctx.drawImage(tex, 0, 0, cw, ch);
      }
    } else if (bg.type === 'image') {
      const r = coverRect(bg.bitmap.width, bg.bitmap.height, scene.width, scene.height);
      ctx.drawImage(bg.bitmap, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
    }
  }
  const dest = placeSubject(scene.width, scene.height, scene.subject.bbox, scene.placement);
  const { bbox } = scene.subject;
  if (scene.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = Math.max(2, dest.h * 0.035 * k);
    ctx.shadowOffsetY = dest.h * 0.018 * k;
  }
  ctx.drawImage(scene.subject.bitmap, bbox.x, bbox.y, bbox.w, bbox.h, dest.x * k, dest.y * k, dest.w * k, dest.h * k);
  ctx.restore();
  return dest;
}

export async function exportScene(scene: Scene, format: 'png' | 'jpeg', quality: number): Promise<Blob> {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(scene.width, scene.height) : Object.assign(document.createElement('canvas'), { width: scene.width, height: scene.height });
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('Canvas unavailable');
  if (format === 'jpeg' && scene.background.type === 'transparent') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
  renderScene(ctx, scene.width, scene.height, scene);
  if (format === 'jpeg' && scene.background.type === 'transparent') {
    // renderScene clears first; repaint white beneath for JPEG, which has no alpha.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((res, rej) => (canvas as HTMLCanvasElement).toBlob(b => (b ? res(b) : rej(new Error('Export failed'))), type, quality));
}
