import type { Page } from '@playwright/test';
import { createCharacter, equipSuggested, expect, jumpToLevel, test, waitForEngine } from './helpers.ts';

async function audioStatus(page: Page) {
  return page.evaluate(() => window.__tome!.audio.status);
}

test('music follows the player from the title to town and dungeon, and actions make sounds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /Music note failed|Sound effect failed|Audio tick failed/.test(msg.text())) errors.push(msg.text());
  });
  await page.goto('/?wizard');
  await waitForEngine(page);

  /* Without autoplay permission, audio waits for a gesture, then plays the title theme. */
  expect(['suspended', 'running']).toContain((await audioStatus(page)).state);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await audioStatus(page)).state).toBe('running');
  expect((await audioStatus(page)).theme).toBe('title');

  await createCharacter(page, 'Minstrel');
  await expect.poll(async () => (await audioStatus(page)).theme, { timeout: 15_000 }).toBe('bree');
  const place = await page.evaluate(() => window.__tome!.engine.place());
  expect(place).toMatchObject({ ready: 1, depth: 0, town: 1, wild: 0 });

  await equipSuggested(page);
  await expect.poll(async () => (await audioStatus(page)).recent).toContain('wield');

  await page.locator('#hud .hud-player').click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect.poll(async () => (await audioStatus(page)).recent).toContain('ui-open');
  await page.keyboard.press('Escape');

  await jumpToLevel(page, 3);
  await expect.poll(async () => (await audioStatus(page)).theme, { timeout: 15_000 }).not.toBe('bree');
  const below = await audioStatus(page);
  expect(below.recent).toContain('stairs-down');
  expect(below.scene).not.toMatch(/^bree/);

  /* Music off stops the theme; sound effects carry on. */
  await page.evaluate(() => window.__tome!.audio.setVolumes('off', 'medium'));
  await expect.poll(async () => (await audioStatus(page)).theme).toBeNull();
  await page.evaluate(() => window.__tome!.audio.setVolumes('medium', 'medium'));
  await expect.poll(async () => (await audioStatus(page)).theme).not.toBeNull();

  expect(errors).toEqual([]);
});

test('the soundtrack plays any theme from the title screen, even with music and sound off, and returns to the title music', async ({ page }) => {
  await page.goto('/');
  await waitForEngine(page);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(true);
  await page.evaluate(() => window.__tome!.audio.setVolumes('off', 'off'));
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(false);

  await page.locator('#title-screen [data-link="music"]').click();
  const sheet = page.locator('.sheet-soundtrack');
  await sheet.locator('.soundtrack-row', { hasText: 'Drums in the Deep' }).click();
  await expect.poll(async () => (await audioStatus(page)).theme).toBe('moria');
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(true);
  await expect.poll(async () => (await audioStatus(page)).state).toBe('running');
  await expect(sheet.locator('.soundtrack-row.playing')).toContainText('Drums in the Deep');
  await expect(sheet.locator('.soundtrack-now')).toContainText('Drums in the Deep');
  await sheet.locator('.sheet-action', { hasText: 'Play all' }).click();
  await expect.poll(async () => (await audioStatus(page)).theme).toBe('title');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => window.__tome!.audio.listeningTo)).toBeNull();
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(false);
});
