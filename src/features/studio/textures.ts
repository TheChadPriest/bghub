// Procedural, seeded background textures. Everything is generated locally
// (no remote images, no licensing questions) and is deterministic, so the
// preview and the exported file always match.

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise with fractal octaves, sampled in "cells" units. */
export function makeNoise(seed: number, size = 256) {
  const rnd = mulberry32(seed);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const m = size - 1;
  const v = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const x0 = xi & m, y0 = yi & m, x1 = (x0 + 1) & m, y1 = (y0 + 1) & m;
    const a = grid[y0 * size + x0], b = grid[y0 * size + x1], c = grid[y1 * size + x0], d = grid[y1 * size + x1];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x: number, y: number, octaves = 4) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += v(x * freq + o * 17.3, y * freq + o * 31.7) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };
}

type RGB = [number, number, number];
export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Writes per-pixel colours from `fn(nx, ny)` where nx, ny are in units of the shorter side. */
function paintPixels(ctx: Ctx, w: number, h: number, fn: (nx: number, ny: number, x: number, y: number) => RGB) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const s = 1 / Math.min(w, h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const c = fn(x * s, y * s, x, y);
      d[i] = clamp(c[0]); d[i + 1] = clamp(c[1]); d[i + 2] = clamp(c[2]); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function solid(ctx: Ctx, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

export function linear(ctx: Ctx, w: number, h: number, from: string, to: string) {
  const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, from); g.addColorStop(1, to);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

/** Seamless studio sweep: bright centre falling off to the edges, with a soft floor. */
export function studio(ctx: Ctx, w: number, h: number, center: string, edge: string, seed: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, center); g.addColorStop(1, edge);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const floor = ctx.createLinearGradient(0, h * 0.62, 0, h);
  floor.addColorStop(0, 'rgba(0,0,0,0)'); floor.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = floor; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, seed, 3);
}

/** Fine film grain so large flat areas do not band. */
export function grain(ctx: Ctx, w: number, h: number, seed: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const r = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 2 * amount;
    d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

export function concrete(ctx: Ctx, w: number, h: number, base: string, seed: number, opts: { contrast?: number; polish?: boolean } = {}) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 1), rnd = mulberry32(seed + 2);
  const [r, g, b] = hex(base);
  const k = opts.contrast ?? 1;
  paintPixels(ctx, w, h, (x, y) => {
    const cloud = (n(x * 3, y * 3, 5) - 0.5) * 46 * k;
    const fine = (n2(x * 60, y * 60, 2) - 0.5) * (opts.polish ? 8 : 26) * k;
    const speck = rnd() < (opts.polish ? 0.002 : 0.012) ? (rnd() - 0.6) * 70 : 0;
    const v = cloud + fine + speck;
    return [r + v, g + v, b + v * 1.02];
  });
  if (opts.polish) {
    const s = ctx.createLinearGradient(0, 0, w, h);
    s.addColorStop(0, 'rgba(255,255,255,0.10)'); s.addColorStop(0.5, 'rgba(255,255,255,0)'); s.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = s; ctx.fillRect(0, 0, w, h);
  }
}

export function brick(ctx: Ctx, w: number, h: number, seed: number, opts: { weathered?: boolean; palette?: string[]; mortar?: string } = {}) {
  const palette = (opts.palette ?? ['#9c4a33', '#a85238', '#8e4030', '#b0603f', '#7f3a2b']).map(hex);
  const mortar = hex(opts.mortar ?? '#c9bfae');
  const rnd = mulberry32(seed);
  const n = makeNoise(seed + 5), n2 = makeNoise(seed + 9);
  const unit = Math.min(w, h);
  const bh = unit / 11, bw = bh * 2.6, joint = Math.max(1, bh * 0.12);
  const rows = Math.ceil(h / bh) + 1, cols = Math.ceil(w / bw) + 2;
  const tint: RGB[] = [];
  for (let i = 0; i < rows * cols; i++) {
    const c = palette[Math.floor(rnd() * palette.length)];
    const j = (rnd() - 0.5) * 22;
    tint.push([c[0] + j, c[1] + j * 0.8, c[2] + j * 0.7]);
  }
  const s = 1 / unit;
  paintPixels(ctx, w, h, (_nx, _ny, x, y) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const col = Math.floor((x + off) / bw);
    const lx = x + off - col * bw, ly = y - row * bh;
    const inMortar = lx < joint || ly < joint;
    const tex = (n(x * s * 40, y * s * 40, 3) - 0.5) * 34;
    if (inMortar) return [mortar[0] + tex * 0.6, mortar[1] + tex * 0.6, mortar[2] + tex * 0.6];
    const t = tint[(row * cols + col) % tint.length];
    let v = tex;
    if (opts.weathered) {
      const wear = n2(x * s * 4, y * s * 4, 4);
      if (wear > 0.62) v += (wear - 0.62) * 160; // pale efflorescence patches
      v += (n2(x * s * 90, y * s * 90, 2) - 0.5) * 30;
    }
    const edge = Math.min(lx - joint, ly - joint, bw - lx, bh - ly);
    if (edge < joint * 1.2) v -= 14; // subtle bevel
    return [t[0] + v, t[1] + v * 0.95, t[2] + v * 0.9];
  });
}

export function graffiti(ctx: Ctx, w: number, h: number, seed: number) {
  concrete(ctx, w, h, '#77746f', seed, { contrast: 0.9 });
  const rnd = mulberry32(seed + 77);
  const unit = Math.min(w, h);
  const colors = ['#ff3d7f', '#ffd23f', '#2ec4f1', '#7bd389', '#ff7b2c', '#9b5de5', '#f8f8f2', '#121212'];
  const pick = () => colors[Math.floor(rnd() * colors.length)];
  // Spray clouds
  for (let i = 0; i < 16; i++) {
    const x = rnd() * w, y = rnd() * h, r = unit * (0.08 + rnd() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = pick();
    g.addColorStop(0, c + 'cc'); g.addColorStop(0.6, c + '55'); g.addColorStop(1, c + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Bold outlined strokes ("tags") with drips
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < 9; i++) {
    const pts: [number, number][] = [];
    let x = rnd() * w, y = rnd() * h;
    for (let k = 0; k < 6; k++) { pts.push([x, y]); x += (rnd() - 0.4) * unit * 0.25; y += (rnd() - 0.5) * unit * 0.18; }
    const width = unit * (0.015 + rnd() * 0.03);
    const fill = pick();
    for (const [lw, col] of [[width * 1.7, '#111111'], [width, fill]] as const) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length - 1; k++) {
        const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1, width * 0.25);
    for (let d = 0; d < 3; d++) {
      const [px, py] = pts[Math.floor(rnd() * pts.length)];
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (rnd() - 0.5) * 2, py + unit * (0.04 + rnd() * 0.12)); ctx.stroke();
    }
  }
  grain(ctx, w, h, seed + 3, 6);
}

export function plaster(ctx: Ctx, w: number, h: number, base: string, seed: number) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 3);
  const [r, g, b] = hex(base);
  paintPixels(ctx, w, h, (x, y) => {
    const blot = (n(x * 2.2, y * 2.2, 5) - 0.5) * 60;
    const trowel = (n2(x * 9, y * 3, 3) - 0.5) * 22;
    const stain = Math.max(0, n2(x * 1.3 + 9, y * 1.3, 4) - 0.6) * -120;
    const v = blot + trowel + stain;
    return [r + v, g + v * 0.97, b + v * 0.92];
  });
  cracks(ctx, w, h, seed + 11, 'rgba(60,45,35,0.55)');
}

function cracks(ctx: Ctx, w: number, h: number, seed: number, color: string) {
  const rnd = mulberry32(seed);
  const unit = Math.min(w, h);
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2;
    ctx.lineWidth = Math.max(1, unit * 0.0025);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 40; k++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * unit * 0.012; y += Math.sin(a) * unit * 0.012; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

export function metal(ctx: Ctx, w: number, h: number, seed: number) {
  const n = makeNoise(seed), rnd = mulberry32(seed + 1);
  const streak = new Float32Array(h);
  for (let y = 0; y < h; y++) streak[y] = (rnd() - 0.5) * 18;
  paintPixels(ctx, w, h, (x, y, _px, py) => {
    const v = 128 + streak[py] + (n(x * 1.5, y * 40, 3) - 0.5) * 40 + (n(x * 3, y * 3, 3) - 0.5) * 30;
    return [v * 0.95, v, v * 1.06];
  });
  const unit = Math.min(w, h);
  const pw = unit * 0.55, ph = unit * 0.4;
  ctx.strokeStyle = 'rgba(20,22,26,0.55)'; ctx.lineWidth = Math.max(1, unit * 0.004);
  for (let x = pw; x < w; x += pw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = ph; y < h; y += ph) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const rr = unit * 0.008;
  for (let x = pw; x < w; x += pw) for (let y = 0; y < h; y += ph / 3) {
    for (const dx of [-rr * 2.4, rr * 2.4]) {
      const g = ctx.createRadialGradient(x + dx - rr * 0.3, y + ph / 6 - rr * 0.3, 0, x + dx, y + ph / 6, rr);
      g.addColorStop(0, '#e6e9ee'); g.addColorStop(1, '#545a63');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + dx, y + ph / 6, rr, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export function grunge(ctx: Ctx, w: number, h: number, seed: number) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 4), rnd = mulberry32(seed + 8);
  paintPixels(ctx, w, h, (x, y) => {
    const base = 52 + (n(x * 2, y * 2, 5) - 0.5) * 50;
    const stain = Math.max(0, n2(x * 1.6, y * 1.6, 4) - 0.55) * 140;
    const drip = (n2(x * 24, y * 1.2, 2) - 0.5) * 24;
    const speck = rnd() < 0.01 ? (rnd() - 0.5) * 60 : 0;
    const v = base + drip + speck;
    return [v + stain * 0.55, v + stain * 0.42, v + stain * 0.25];
  });
}

export function paintedWall(ctx: Ctx, w: number, h: number, seed: number, paint: string, under: string) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 6);
  const p = hex(paint), u = hex(under);
  paintPixels(ctx, w, h, (x, y) => {
    const peel = n(x * 3.2, y * 3.2, 5);
    const tex = (n2(x * 50, y * 50, 2) - 0.5) * 18 + (n2(x * 4, y * 4, 3) - 0.5) * 26;
    if (peel > 0.63) return [u[0] + tex, u[1] + tex, u[2] + tex];
    const edge = peel > 0.6 ? -26 : 0; // shadowed paint edge around peeled areas
    return [p[0] + tex + edge, p[1] + tex + edge, p[2] + tex + edge];
  });
}

export function paper(ctx: Ctx, w: number, h: number, seed: number) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 2);
  const base = hex('#efe4cc');
  paintPixels(ctx, w, h, (x, y) => {
    const fib = (n2(x * 120, y * 30, 2) - 0.5) * 10;
    const mottle = (n(x * 3, y * 3, 4) - 0.5) * 26;
    const cx = x - 0.5 * w / Math.min(w, h), cy = y - 0.5 * h / Math.min(w, h);
    const vig = -Math.min(40, (cx * cx + cy * cy) * 70);
    const v = fib + mottle + vig;
    return [base[0] + v, base[1] + v * 1.02, base[2] + v * 1.1];
  });
}
