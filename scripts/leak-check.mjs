// Repeated-session memory check: process a batch, clear it, repeat; record the
// browser's total working set after each clear. Run with `npm run preview` up.
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
const fixtures = path.resolve('tests/fixtures');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/');
const mem = () => Number(execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -match 'playwright' } | Measure-Object -Property WorkingSetSize -Sum).Sum"`).toString().trim()) / 1048576;
const files = ['jacket.jpg', 'bag.png', 'bag.heic', 'sneakers-large.jpg'].map(f => path.join(fixtures, f));
for (let round = 1; round <= 4; round++) {
  const t0 = Date.now();
  await page.getByTestId('file-input').setInputFiles(files);
  await page.waitForFunction(() => { const j = window.__bghub.getSnapshot().jobs; return j.length === 4 && j.every(x => x.status === 'done' || x.status === 'failed'); }, null, { timeout: 600_000, polling: 1000 });
  const statuses = await page.evaluate(() => window.__bghub.getSnapshot().jobs.map(j => `${j.name}:${j.status}:${Math.round(j.timings.inferMs ?? 0)}ms`));
  const before = mem();
  await page.evaluate(() => window.__bghub.clearAll());
  await page.waitForTimeout(4000);
  console.log(`round ${round}: ${((Date.now() - t0) / 1000).toFixed(0)}s, mem with results ${before.toFixed(0)} MB, after clear ${mem().toFixed(0)} MB | ${statuses.join(' ')}`);
}
await browser.close();
