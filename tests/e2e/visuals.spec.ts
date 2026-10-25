import { expect, test } from '@playwright/test';
import {
  canvasBrightness,
  createCharacter,
  jumpToLevel,
  sendText,
  viewMode,
  waitForEngine,
  waitForScreen,
} from './helpers.ts';

test('title screens burn with animated flames behind the text', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await waitForScreen(page, /select a module to play/);
  expect(await viewMode(page)).toBe('title');
  await expect(page.locator('#fx')).toBeVisible();
  await expect(page.locator('#hud')).toBeHidden();
  await expect
    .poll(() => canvasBrightness(page, '#fx', { x: 0, y: 0.85, w: 1, h: 0.15 }), { timeout: 10_000 })
    .toBeGreaterThan(5);
});

test('renders the lit map, HUD and translucent panels in the dungeon', async ({ page }, testInfo) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Vis');

  await expect.poll(() => viewMode(page)).toBe('map');
  await expect(page.locator('#screen')).toBeHidden();
  await expect(page.locator('#hud .hud-player .name')).toHaveText(/\w+/);
  await expect(page.locator('#hud .bar-hp')).toContainText('Health');
  expect(await canvasBrightness(page, '#map', { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBeGreaterThan(3);
  await testInfo.attach('town', { body: await page.screenshot(), contentType: 'image/png' });

  await sendText(page, 'i');
  await expect.poll(() => viewMode(page)).toBe('overlay');
  await expect(page.locator('#screen')).toBeVisible();
  await expect(page.locator('#messages')).toContainText('Inventory');
  await testInfo.attach('inventory-panel', { body: await page.screenshot(), contentType: 'image/png' });
  await sendText(page, '\u001b');
  await expect.poll(() => viewMode(page)).toBe('map');

  await jumpToLevel(page, 5);
  await expect.poll(() => viewMode(page)).toBe('map');
  await expect(page.locator('#hud .meta')).toContainText('(L5)');
  await expect
    .poll(() => canvasBrightness(page, '#map', { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }), { timeout: 10_000 })
    .toBeGreaterThan(8);
  await testInfo.attach('dungeon', { body: await page.screenshot(), contentType: 'image/png' });

  const stats = await page.evaluate(() => window.__tome!.stats());
  testInfo.annotations.push({ type: 'map render ms', description: stats.renderMs.toFixed(2) });
  expect(stats.renderMs).toBeLessThan(250);
});

test('display settings persist and switch the glyph set', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-menu="settings"]').click();
  await page.locator('input[name="glyphs"][value="classic"]').check();
  await page.locator('input[name="animation"][value="reduced"]').check();
  await page.locator('#settings-form button[type="submit"]').click();

  await page.reload();
  await waitForEngine(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-menu="settings"]').click();
  await expect(page.locator('input[name="glyphs"][value="classic"]')).toBeChecked();
  await expect(page.locator('input[name="animation"][value="reduced"]')).toBeChecked();
});
