import { expect, test } from '@playwright/test';
import {
  beginNewCharacter,
  canvasBrightness,
  createCharacter,
  dismissMore,
  jumpToLevel,
  playerRegion,
  viewMode,
  waitAtCommand,
  waitForEngine,
} from './helpers.ts';

test('opening screen ignites, the intro rises from the flames, then character creation', async ({ page }, testInfo) => {
  await page.goto('./');
  await expect(page.locator('#title-screen')).toBeVisible();
  await waitForEngine(page);
  await expect
    .poll(() => canvasBrightness(page, '#title-screen canvas', { x: 0, y: 0.8, w: 1, h: 0.2 }), { timeout: 10_000 })
    .toBeGreaterThan(15);
  await expect
    .poll(() => canvasBrightness(page, '#title-screen canvas', { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }), { timeout: 10_000 })
    .toBeGreaterThan(4);
  await page.waitForTimeout(4500);
  await testInfo.attach('opening', { body: await page.screenshot(), contentType: 'image/png' });

  await beginNewCharacter(page, 'Lighter');
  await expect(page.locator('#title-screen .title-intro')).toContainText('The world is indeed full of peril');
  await page.waitForTimeout(1500);
  await testInfo.attach('intro', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('.director .birth-header h2')).toHaveText('Choose your race', { timeout: 30_000 });
  expect(await viewMode(page)).toBe('screen');
  await expect(page.locator('#fx')).toBeVisible();
  await expect
    .poll(() => canvasBrightness(page, '#fx', { x: 0, y: 0.85, w: 1, h: 0.15 }), { timeout: 10_000 })
    .toBeGreaterThan(5);

  const current = page.locator('.director .birth-option.current');
  const other = page.locator('.director .birth-option:not(.current)').first();
  const otherName = (await other.textContent())!;
  await other.click();
  await expect(current).toHaveText(otherName);
  await expect(page.locator('.director .birth-card h3')).toHaveText(otherName);
  await testInfo.attach('race', { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('.director .birth-confirm').click();
  await expect(page.locator('.director .birth-summary')).toContainText(otherName);

  /* Back returns to the previous step with the earlier choice highlighted. */
  const step = await page.locator('.director .birth-header h2').textContent();
  await page.locator('#toolbar [data-action="back"]').click();
  await expect(page.locator('.director .birth-header h2')).toHaveText('Choose your race');
  await expect(current).toHaveText(otherName);
  expect(await page.locator('#toolbar [data-action="back"]').count()).toBe(0);
  await page.locator('.director .birth-confirm').click();
  await expect(page.locator('.director .birth-header h2')).toHaveText(step!);

  const second = (await page.locator('.director .birth-option:not(.current):not(.unusual)').last().textContent())!;
  await page.locator('.director .birth-option', { hasText: second }).click();
  await expect(current).toHaveText(second);
  await page.locator('.director .birth-confirm').click();
  await expect(page.locator('.director .birth-header h2')).not.toHaveText(step!);
  await page.locator('#toolbar [data-action="back"]').click();
  await expect(page.locator('.director .birth-header h2')).toHaveText(step!);
  await expect(current).toHaveText(second);
  await expect(page.locator('.director .birth-summary')).toContainText(otherName);
});

test('the Theme module can be chosen from the opening screen', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.locator('#title-screen a.title-link', { hasText: 'Theme' }).click();
  await page.waitForURL(/module=theme/);
  await waitForEngine(page);
  expect(await page.evaluate(() => window.__tome!.director.module)).toBe('Theme');
  await beginNewCharacter(page, 'Themer');
  await expect(page.locator('#title-screen .title-intro')).toContainText('A module for ToME');
  await page.keyboard.press('Enter');
  await expect(page.locator('.director .birth-header h2')).toHaveText(/Choose your race/, { timeout: 30_000 });
});

test('renders the lit map, HUD and tome2 panels in the dungeon', async ({ page }, testInfo) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Vis');

  await expect.poll(() => viewMode(page)).toBe('map');
  await expect(page.locator('#hud .hud-player .name')).toHaveText('Vis');
  await expect(page.locator('#hud .bar-hp')).toContainText('Health');
  expect(await canvasBrightness(page, '#map', { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBeGreaterThan(3);
  await testInfo.attach('town', { body: await page.screenshot(), contentType: 'image/png' });

  await page.keyboard.press('i');
  await expect(page.locator('.sheet .item-row').first()).toBeVisible();
  await testInfo.attach('inventory', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await expect.poll(() => viewMode(page)).toBe('map');

  await page.keyboard.press('C');
  await expect.poll(() => viewMode(page)).toBe('overlay');
  await expect(page.locator('.termview')).toBeVisible();
  await testInfo.attach('character-panel', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expect.poll(() => viewMode(page)).toBe('map');

  await jumpToLevel(page, 5);
  await expect.poll(() => viewMode(page)).toBe('map');
  await page.locator('#toolbar [data-action="inventory"]').click();
  await page.locator('.sheet .item-row', { hasText: 'Torch' }).first().click();
  await page.locator('.sheet .action-button', { hasText: /^(Wield|Wear)$/ }).click();
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await dismissMore(page);
  await waitAtCommand(page);
  await expect(page.locator('#hud .meta')).toContainText('(L5)');
  await expect
    .poll(async () => canvasBrightness(page, '#map', await playerRegion(page)), { timeout: 10_000 })
    .toBeGreaterThan(8);
  await testInfo.attach('dungeon', { body: await page.screenshot(), contentType: 'image/png' });

  const stats = await page.evaluate(() => window.__tome!.stats());
  testInfo.annotations.push({ type: 'map render ms', description: stats.renderMs.toFixed(2) });
  expect(stats.renderMs).toBeLessThan(250);
});

test('settings persist: text size, glyphs and animation', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  const fontSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await fontSize()).toBe('14px');

  await page.locator('#title-screen [data-link="settings"]').click();
  await page.locator('.sheet .segment', { hasText: 'Extra large' }).click();
  await page.locator('.sheet .segment', { hasText: 'Classic ASCII' }).click();
  await page.locator('.sheet .segment', { hasText: 'Reduced' }).click();
  expect(await fontSize()).toBe('19px');
  await page.keyboard.press('Escape');

  await page.reload();
  await waitForEngine(page);
  expect(await fontSize()).toBe('19px');
  await page.locator('#title-screen [data-link="settings"]').click();
  await expect(page.locator('.sheet .segment.selected', { hasText: 'Classic ASCII' })).toBeVisible();
  await expect(page.locator('.sheet .segment.selected', { hasText: 'Reduced' })).toBeVisible();
  await expect(page.locator('.sheet .segment.selected', { hasText: 'Extra large' })).toBeVisible();
});
