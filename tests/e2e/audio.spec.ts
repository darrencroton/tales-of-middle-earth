import { expect, test, type Page } from '@playwright/test';
import { createCharacter, equipSuggested, jumpToLevel, waitForEngine } from './helpers.ts';

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

  /* Audio waits for a gesture, then plays the title theme. */
  expect((await audioStatus(page)).state).toBe('off');
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

test('the settings sheet changes music and sound volumes', async ({ page }) => {
  await page.goto('/');
  await waitForEngine(page);
  await page.locator('#title-screen [data-link="settings"]').click();
  const music = page.locator('.segmented[aria-label="Music"]');
  await expect(music.locator('.segment.selected')).toHaveText('Medium');
  await music.locator('.segment', { hasText: 'Off' }).click();
  await page.locator('.segmented[aria-label="Sound effects"] .segment', { hasText: 'High' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tome2mobile.settings') ?? '{}'));
  expect(stored).toMatchObject({ music: 'off', sound: 'high' });
});
