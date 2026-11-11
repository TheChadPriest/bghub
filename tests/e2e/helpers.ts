import { expect, type Download, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
export const fixture = (n: string) => path.join(FIXTURES, n);

export const card = (page: Page, name: string): Locator => page.locator(`[data-testid=job-card][aria-label="${name}"]`);

export async function addFiles(page: Page, ...names: string[]) {
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
}

/** Waits until a job card reaches one of the given statuses. Inference can take a while on CPU. */
export async function waitForStatus(page: Page, name: string, statuses: string[], timeout = 240_000) {
  await expect.poll(async () => card(page, name).getAttribute('data-status'), { timeout, intervals: [1000] })
    .toMatch(new RegExp(`^(${statuses.join('|')})$`));
}

export async function saveDownload(d: Download): Promise<Buffer> {
  const p = await d.path();
  return fs.readFileSync(p!);
}

/** Minimal PNG header reader: width, height, bit depth, colour type. */
export function pngInfo(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colorType: buf[25] };
}

/** Collects every non-same-origin request so tests can assert photos never leave the device. */
export function trackExternalRequests(page: Page, origin: string): string[] {
  const external: string[] = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== origin) external.push(r.url());
  });
  return external;
}
