// Batch ZIP export. PNGs are already deflate-compressed, so entries are
// stored (level 0): fast, and the ZIP stays the same size.

import { Zip, ZipPassThrough } from 'fflate';
import { outputName, uniqueName } from './filenames';

export interface ZipEntry { name: string; blob: Blob }

/** Assigns collision-free names, e.g. "shirt-cutout.png", "shirt-cutout (2).png". */
export function planZipNames(originals: string[], suffix = '-cutout', ext = 'png'): string[] {
  const taken = new Set<string>();
  return originals.map(o => uniqueName(outputName(o, suffix, ext), taken));
}

export async function buildZip(entries: ZipEntry[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let finished!: () => void, failed!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => { finished = res; failed = rej; });
  const zip = new Zip((err, data, final) => {
    if (err) { failed(err); return; }
    chunks.push(data);
    if (final) finished();
  });
  let i = 0;
  for (const e of entries) {
    const file = new ZipPassThrough(e.name);
    file.mtime = new Date();
    zip.add(file);
    file.push(new Uint8Array(await e.blob.arrayBuffer()), true);
    onProgress?.(++i, entries.length);
  }
  zip.end();
  await done;
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
