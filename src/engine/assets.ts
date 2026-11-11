// Downloads large binaries (model weights, ONNX Runtime WASM) in chunks,
// verifies them, and keeps them in Cache Storage so they are fetched once.
// Chunks exist because static hosts cap single-file sizes (Cloudflare Pages: 25 MiB).
// Runs in both the main thread and workers.

import type { AssetManifest, BinaryAsset } from './protocol';

export const CACHE_NAME = 'bghub-assets-v1';

export class AssetError extends Error {
  constructor(message: string, public kind: 'network' | 'integrity' | 'manifest') { super(message); }
}

export async function fetchManifest(baseUrl: string): Promise<AssetManifest> {
  let res: Response;
  try { res = await fetch(new URL('bin/manifest.json', baseUrl), { cache: 'no-cache' }); }
  catch { throw new AssetError('Could not reach the server to load the AI model. Check your connection.', 'network'); }
  if (!res.ok) throw new AssetError(`The model manifest is missing (HTTP ${res.status}).`, 'manifest');
  return res.json();
}

async function openCache(): Promise<Cache | null> {
  try { return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; }
  catch { return null; }
}

function partUrls(asset: BinaryAsset, baseUrl: string): string[] {
  return asset.parts.map(p => new URL(p, baseUrl).toString());
}

/** True when every chunk of the asset is already in Cache Storage. */
export async function isCached(asset: BinaryAsset, baseUrl: string): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  for (const u of partUrls(asset, baseUrl)) if (!(await cache.match(u))) return false;
  return true;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readWithProgress(res: Response, onBytes: (n: number) => void): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length')) || 0;
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); onBytes(b.length); return b; }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(len && len === total ? len : total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Returns the full asset bytes. Uses cached chunks when present, downloads the
 * rest, verifies SHA-256 of the assembled file, then caches chunks.
 */
export async function loadAsset(asset: BinaryAsset, baseUrl: string, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const cache = await openCache();
  const urls = partUrls(asset, baseUrl);
  const parts: Uint8Array[] = [];
  let loaded = 0;
  const fresh: Array<[string, Uint8Array]> = [];
  const report = (n: number) => { loaded += n; onProgress?.(Math.min(loaded, asset.size), asset.size); };
  try {
    for (const u of urls) {
      const hit = cache ? await cache.match(u) : undefined;
      if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); report(b.length); parts.push(b); continue; }
      let res: Response;
      try { res = await fetch(u); } catch { throw new AssetError('The AI model download was interrupted. Check your connection and retry.', 'network'); }
      if (!res.ok) throw new AssetError(`Model file unavailable (HTTP ${res.status}).`, 'network');
      const b = await readWithProgress(res, report);
      parts.push(b); fresh.push([u, b]);
    }
  } catch (e) {
    if (!asset.fallback) throw e;
    // Same-origin chunks unavailable: fall back to the pinned upstream file.
    loaded = 0;
    const res = await fetch(asset.fallback).catch(() => { throw e; });
    if (!res.ok) throw e;
    const whole = await readWithProgress(res, report);
    if ((await sha256Hex(whole)) !== asset.sha256) throw new AssetError('Downloaded model failed its integrity check.', 'integrity');
    return whole;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  if (total !== asset.size) { await purge(asset, baseUrl); throw new AssetError('Downloaded model has the wrong size. Retry to download it again.', 'integrity'); }
  const whole = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { whole.set(p, off); off += p.length; }
  if (fresh.length) {
    // Verify before caching anything new, so a bad download is never persisted.
    if ((await sha256Hex(whole)) !== asset.sha256) { await purge(asset, baseUrl); throw new AssetError('Downloaded model failed its integrity check. Retry to download it again.', 'integrity'); }
    if (cache) for (const [u, b] of fresh) await cache.put(u, new Response(b as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  }
  return whole;
}

export async function purge(asset: BinaryAsset, baseUrl: string) {
  const cache = await openCache();
  if (cache) for (const u of partUrls(asset, baseUrl)) await cache.delete(u);
}

/** Removes every cached model/runtime file (Settings → "Delete downloaded model"). */
export async function clearAllAssets() {
  try { await caches.delete(CACHE_NAME); } catch { /* unavailable */ }
}

export function cacheAvailable(): boolean {
  return typeof caches !== 'undefined';
}
