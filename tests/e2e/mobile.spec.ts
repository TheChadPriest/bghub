import { test, expect } from '@playwright/test';
import { addFiles, card, waitForStatus } from './helpers';

test('small screens: no horizontal scrolling, upload and results usable', async ({ page }) => {
  await page.goto('/');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Choose images' })).toBeInViewport();

  await addFiles(page, 'synthetic.jpg');
  await waitForStatus(page, 'synthetic.jpg', ['done'], 420_000);
  const c = card(page, 'synthetic.jpg');
  await expect(c.getByRole('button', { name: 'PNG' })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  await c.getByRole('button', { name: 'Background' }).click();
  await expect(page.getByTestId('studio-canvas')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('studio-export')).toBeVisible();
});
