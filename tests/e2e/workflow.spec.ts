import { test, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { addFiles, card, fixture, pngInfo, saveDownload, trackExternalRequests, waitForStatus } from './helpers';

// One page for the whole flow so the AI model is downloaded and initialised once,
// exactly like a real visitor processing several batches.
test.describe.configure({ mode: 'serial' });

let page: Page;
let external: string[];

test.beforeAll(async ({ browser, baseURL }) => {
  page = await browser.newPage();
  external = trackExternalRequests(page, new URL(baseURL!).origin);
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('dialog', d => { console.log('[dialog]', d.type(), d.message()); void d.dismiss(); });
  page.on('download', d => { void d.failure().then(f => console.log('[download]', d.suggestedFilename(), f ?? 'ok')); });
  page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
  await page.goto('/');
});
test.afterAll(async () => { await page.close(); });

test('home page works without login and shows the upload zone', async () => {
  await expect(page.getByRole('heading', { name: /Your product\. No background\./ })).toBeVisible();
  await expect(page.getByTestId('dropzone')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Choose images' })).toBeVisible();
  await expect(page.getByText('Processed on your device')).toBeVisible();
  await expect(page.getByText(/sign in|log in|create account/i)).toHaveCount(0);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('invalid files are rejected individually with a reason', async () => {
  await addFiles(page, 'vector.svg', 'not-an-image.jpg', 'huge-dimensions.png');
  const rej = page.getByTestId('rejections');
  await expect(rej).toContainText('vector.svg');
  await expect(rej).toContainText(/vector format/);
  await expect(rej).toContainText('not-an-image.jpg');
  await expect(rej).toContainText('huge-dimensions.png');
  await expect(rej).toContainText(/limit/);
  await expect(page.getByTestId('job-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss all' }).click();
});

test('a JPEG becomes a full-resolution transparent PNG', async () => {
  await addFiles(page, 'jacket.jpg');
  await waitForStatus(page, 'jacket.jpg', ['done', 'failed'], 420_000);
  const c = card(page, 'jacket.jpg');
  await expect(c).toHaveAttribute('data-status', 'done');
  await expect(c.getByTestId('job-info')).toContainText('960×857 PNG');
  await expect(c.getByTestId('job-info')).toContainText(/Resized\s*No/);
  await expect(c.getByTestId('job-info')).toContainText(/Transparency\s*Yes/);

  // Preview with before/after comparison
  await c.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('slider', { name: 'Compare original and cutout' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  const [dl] = await Promise.all([page.waitForEvent('download'), c.getByRole('button', { name: 'PNG' }).click()]);
  expect(dl.suggestedFilename()).toBe('jacket-cutout.png');
  const info = pngInfo(await saveDownload(dl));
  expect(info).toEqual({ width: 960, height: 857, depth: 8, colorType: 6 /* RGBA */ });
});

test('batch: independent states, more files accepted while processing, HEIC decoded', async () => {
  await addFiles(page, 'bag.png', 'bag.webp', 'bag-exif-rotated.jpg');
  // Add another image while the first batch is still in progress.
  await expect.poll(async () => page.locator('[data-testid=job-card][data-status=analyzing], [data-testid=job-card][data-status=decoding], [data-testid=job-card][data-status=waiting-model]').count()).toBeGreaterThan(0);
  const t0 = Date.now();
  await addFiles(page, 'bag.heic');
  await expect(card(page, 'bag.heic')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(5000); // accepted immediately, not after the batch

  // UI stays responsive during inference (all heavy work runs in workers).
  const lag = await page.evaluate(async () => {
    const t = performance.now();
    await new Promise(r => setTimeout(r, 50));
    return performance.now() - t - 50;
  });
  expect(lag).toBeLessThan(250);
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page.getByRole('heading', { name: 'Help & FAQ' })).toBeVisible();
  await page.getByRole('link', { name: 'Remove' }).click();

  const statuses = await page.locator('[data-testid=job-card]').evaluateAll(els => els.map(e => e.getAttribute('data-status')));
  expect(new Set(statuses).size).toBeGreaterThan(1); // jobs progress independently

  for (const n of ['bag.png', 'bag.webp', 'bag-exif-rotated.jpg', 'bag.heic']) await waitForStatus(page, n, ['done'], 600_000);
  await expect(card(page, 'bag.heic').getByTestId('job-info')).toContainText('900×870 PNG');
  // EXIF orientation applied: the stored image is 870×900, the upright output is 900×870.
  await expect(card(page, 'bag-exif-rotated.jpg').getByTestId('job-info')).toContainText('900×870 PNG');
});

test('failures stay isolated; cancelled and failed images can be retried', async () => {
  await addFiles(page, 'corrupt.jpg', 'synthetic.jpg');
  await waitForStatus(page, 'corrupt.jpg', ['failed']);
  await expect(card(page, 'corrupt.jpg')).toContainText(/could not be decoded/);
  // Cancel the other one, then retry it to completion.
  const syn = card(page, 'synthetic.jpg');
  if (await syn.getAttribute('data-status') !== 'done') {
    await syn.getByRole('button', { name: /Cancel/ }).click();
    await expect(syn).toHaveAttribute('data-status', 'cancelled');
  }
  await syn.getByRole('button', { name: 'Retry' }).click();
  await waitForStatus(page, 'synthetic.jpg', ['done'], 300_000);
  // Retrying the corrupt file runs again and fails again without affecting other results.
  await card(page, 'corrupt.jpg').getByRole('button', { name: 'Retry' }).click();
  await waitForStatus(page, 'corrupt.jpg', ['failed']);
  await expect(page.getByTestId('batch-summary')).toContainText(/6\s*done/);
  await expect(page.getByTestId('batch-summary')).toContainText(/1\s*failed/);
});

test('ZIP export contains every successful PNG under unique names', async () => {
  const zip = await createAndSave('zip-all', 'zip-link');
  expect(zip.name).toMatch(/^bghub-cutouts-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(zip.bytes));
  const names = Object.keys(files).sort();
  expect(names).toEqual(['bag-cutout (2).png', 'bag-cutout (3).png', 'bag-cutout.png', 'bag-exif-rotated-cutout.png', 'jacket-cutout.png', 'synthetic-cutout.png']);
  for (const n of names) expect(pngInfo(Buffer.from(files[n])).colorType).toBe(6);
});

test('mask editor edits transparency and keeps dimensions', async () => {
  const c = card(page, 'synthetic.jpg');
  await c.getByRole('button', { name: 'Refine' }).click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('editor-apply').click();
  await expect(canvas).toBeHidden({ timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), c.getByRole('button', { name: 'PNG' }).click()]);
  expect(pngInfo(await saveDownload(dl))).toMatchObject({ width: 640, height: 480 });
});

/**
 * Two-step export: create the file, then read exactly what the "Save" link points to.
 * (In this test environment Chrome cancels saving files over ~2 MB to disk, so the
 * bytes are read from the link's blob URL instead of the downloads folder.)
 */
async function createAndSave(createId: string, linkId: string): Promise<{ name: string; bytes: Buffer }> {
  await page.getByTestId(createId).click();
  const link = page.getByTestId(linkId);
  await expect(link).toBeVisible({ timeout: 60_000 });
  const r = await link.evaluate(async (a: HTMLAnchorElement) => {
    const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { name: a.download, b64: btoa(bin) };
  });
  return { name: r.name, bytes: Buffer.from(r.b64, 'base64') };
}

test('background studio: presets, custom background, positioning, both exports', async () => {
  await card(page, 'jacket.jpg').getByRole('button', { name: 'Background' }).click();
  await expect(page.getByTestId('studio-canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Red brick', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Red brick', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Light concrete', exact: true }).click();
  await page.getByRole('button', { name: 'Graffiti wall', exact: true }).click();
  await page.getByRole('radio', { name: '1:1', exact: true }).click();
  await page.getByLabel('Horizontal').fill('20');
  await page.getByLabel('Scale').fill('80');
  const png = await createAndSave('studio-export', 'studio-link');
  expect(png.name).toBe('jacket-studio.png');
  const composite = pngInfo(png.bytes);
  expect(composite.width).toBe(composite.height);
  expect(composite.colorType === 2 || composite.colorType === 6).toBe(true);

  await page.getByRole('radio', { name: 'Upload', exact: true }).click();
  await page.getByTestId('bg-input').setInputFiles(fixture('bag.heic'));
  await expect(page.getByText('bag.heic · 900×870')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('radio', { name: 'JPEG', exact: true }).click();
  const jpgOut = await createAndSave('studio-export', 'studio-link');
  expect(jpgOut.name).toBe('jacket-studio.jpg');
  const jpg = jpgOut.bytes;
  expect(jpg[0]).toBe(0xff); expect(jpg[1]).toBe(0xd8);

  // The transparent cutout is still available, unchanged.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('studio-transparent').click()]);
  expect(pngInfo(await saveDownload(dl))).toEqual({ width: 960, height: 857, depth: 8, colorType: 6 });
});

test('no image data or requests leave the device', async () => {
  expect(external).toEqual([]);
});
