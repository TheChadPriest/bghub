import * as T from './textures';
import type { Ctx } from './textures';

export type PresetCategory = 'surfaces' | 'urban' | 'solid' | 'more';

export const CATEGORY_LABEL: Record<PresetCategory, string> = {
  surfaces: 'Clean surfaces',
  urban: 'Urban & textured',
  solid: 'Solid colors',
  more: 'More',
};

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  /** Paints the background into a w×h context. Must be deterministic. */
  draw: (ctx: Ctx, w: number, h: number) => void;
  /** True for flat fills; those are drawn at full output resolution directly. */
  flat?: boolean;
}

const solid = (id: string, name: string, color: string): Preset => ({
  id, name, category: 'solid', flat: true, draw: (c, w, h) => T.solid(c, w, h, color),
});

export const PRESETS: Preset[] = [
  { id: 'concrete-light', name: 'Light concrete', category: 'surfaces', draw: (c, w, h) => T.concrete(c, w, h, '#b9b6b0', 101) },
  { id: 'concrete-dark', name: 'Dark concrete', category: 'surfaces', draw: (c, w, h) => T.concrete(c, w, h, '#4d4c4a', 102, { contrast: 0.8 }) },
  { id: 'cement-polished', name: 'Polished cement', category: 'surfaces', draw: (c, w, h) => T.concrete(c, w, h, '#a7a39c', 103, { polish: true, contrast: 0.7 }) },
  { id: 'studio-neutral', name: 'Neutral studio', category: 'surfaces', draw: (c, w, h) => T.studio(c, w, h, '#d9d6d0', '#9d9a94', 104) },
  { id: 'studio-white', name: 'White studio', category: 'surfaces', draw: (c, w, h) => T.studio(c, w, h, '#ffffff', '#e4e4e2', 105) },
  { id: 'studio-beige', name: 'Warm beige studio', category: 'surfaces', draw: (c, w, h) => T.studio(c, w, h, '#efe2cf', '#c9b79d', 106) },
  { id: 'studio-gray', name: 'Soft gray studio', category: 'surfaces', draw: (c, w, h) => T.studio(c, w, h, '#cfd0d2', '#8e9094', 107) },

  { id: 'brick-red', name: 'Red brick', category: 'urban', draw: (c, w, h) => T.brick(c, w, h, 201) },
  { id: 'brick-weathered', name: 'Weathered brick', category: 'urban', draw: (c, w, h) => T.brick(c, w, h, 202, { weathered: true, palette: ['#8a5442', '#94604b', '#7a4a3b', '#a06a52', '#6f4235'], mortar: '#b9b2a4' }) },
  { id: 'graffiti', name: 'Graffiti wall', category: 'urban', draw: (c, w, h) => T.graffiti(c, w, h, 203) },
  { id: 'plaster', name: 'Distressed plaster', category: 'urban', draw: (c, w, h) => T.plaster(c, w, h, '#cdbca2', 204) },
  { id: 'metal', name: 'Industrial metal', category: 'urban', draw: (c, w, h) => T.metal(c, w, h, 205) },
  { id: 'grunge', name: 'Grunge wall', category: 'urban', draw: (c, w, h) => T.grunge(c, w, h, 206) },
  { id: 'painted-wall', name: 'Weathered painted wall', category: 'urban', draw: (c, w, h) => T.paintedWall(c, w, h, 207, '#5f7f86', '#d9cfbf') },

  solid('white', 'White', '#ffffff'),
  solid('black', 'Black', '#000000'),
  solid('light-gray', 'Light gray', '#d9d9d9'),
  solid('charcoal', 'Charcoal', '#2b2b2d'),
  solid('beige', 'Beige', '#e3d5bd'),
  solid('cream', 'Cream', '#f6efdc'),
  solid('red', 'Red', '#c8322f'),
  solid('blue', 'Blue', '#2d5fc4'),
  solid('green', 'Green', '#2f8a4f'),
  solid('pink', 'Pink', '#f2b6c6'),
  solid('purple', 'Purple', '#6c4ab6'),

  { ...solid('off-white', 'Warm off-white', '#f4f0e8'), category: 'more' },
  { ...solid('cool-gray', 'Cool gray', '#aeb5bd'), category: 'more' },
  { ...solid('olive', 'Muted olive', '#7d7d58'), category: 'more' },
  { ...solid('burgundy', 'Deep burgundy', '#5c1a26'), category: 'more' },
  { id: 'paper', name: 'Vintage paper', category: 'more', draw: (c, w, h) => T.paper(c, w, h, 301) },
  { id: 'gradient-dark', name: 'Subtle dark gradient', category: 'more', flat: true, draw: (c, w, h) => T.linear(c, w, h, '#3a3a3d', '#141416') },
  { id: 'gradient-light', name: 'Subtle light gradient', category: 'more', flat: true, draw: (c, w, h) => T.linear(c, w, h, '#ffffff', '#dedbd5') },
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find(p => p.id === id);
}

/** Textures are generated at most at this long-side size and scaled; flat fills are exact. */
export const TEXTURE_MAX = 3072;

const cache = new Map<string, OffscreenCanvas | HTMLCanvasElement>();

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/**
 * Returns a canvas holding the preset rendered for an output of w×h. The same
 * texture is used for preview and export, so they always match.
 */
export function renderPreset(p: Preset, w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  const s = p.flat ? Math.min(1, 1024 / Math.max(w, h)) : Math.min(1, TEXTURE_MAX / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  const key = `${p.id}:${tw}x${th}`;
  let c = cache.get(key);
  if (!c) {
    c = makeCanvas(tw, th);
    const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx | null;
    if (!ctx) throw new Error('Canvas unavailable');
    p.draw(ctx, tw, th);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
    cache.set(key, c);
  }
  return c;
}
