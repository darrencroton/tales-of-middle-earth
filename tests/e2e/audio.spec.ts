import { expect, test, type Page } from '@playwright/test';
import { castUntilAimed, createCharacter, dismissMore, equipSuggested, jumpToLevel, waitAtCommand, waitForEngine } from './helpers.ts';

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

test('a spell sounds as it is let go, before its bolt, and only once; a failed one fizzles', async ({ page }) => {
  await page.goto('/');
  await waitForEngine(page);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await audioStatus(page)).state).toBe('running');
  await createCharacter(page, 'Spark', { race: 'High-Elf', cls: 'Mage' });

  /* Aims along open ground, so the bolt is drawn before it ends. */
  const direction = await page.evaluate(() => {
    const snap = window.__tome!.engine.snapshot()!;
    const floor = snap.feat[snap.py * snap.width + snap.px];
    const ways: [string, number, number][] = [['6', 1, 0], ['4', -1, 0], ['2', 0, 1], ['8', 0, -1]];
    const open = ways.find(([, dx, dy]) =>
      [1, 2, 3].every((k) => {
        const x = snap.px + dx * k;
        const y = snap.py + dy * k;
        return x >= 0 && y >= 0 && x < snap.width && y < snap.height && snap.feat[y * snap.width + x] === floor;
      }),
    );
    return open?.[0] ?? '6';
  });
  let start = (await audioStatus(page)).recent.length;
  await castUntilAimed(page, 'Manathrust', async () => {
    await expect.poll(async () => (await audioStatus(page)).recent.slice(start)).toContain('fizzle');
    expect((await audioStatus(page)).recent.slice(start)).not.toContain('cast');
    start = (await audioStatus(page)).recent.length;
  });
  const before = (await audioStatus(page)).recent.length;
  await page.evaluate((d) => window.__tome!.sendText(d), direction);
  await dismissMore(page);
  await waitAtCommand(page);
  await expect.poll(async () => (await audioStatus(page)).recent.slice(before)).toContain('cast');
  const heard = (await audioStatus(page)).recent.slice(before);
  expect(heard.filter((id) => id === 'cast')).toHaveLength(1);
  expect(heard.indexOf('bolt')).toBeGreaterThan(heard.indexOf('cast'));
});

test('the title theme plays again as soon as a game ends, without another tap', async ({ page }) => {
  await page.goto('/');
  await waitForEngine(page);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await audioStatus(page)).state).toBe('running');
  await createCharacter(page, 'Bard');
  await expect.poll(async () => (await audioStatus(page)).theme, { timeout: 15_000 }).not.toBe('title');

  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Save and quit' }).click();
  await page.locator('.sheet-action.primary', { hasText: 'Save and quit' }).click();
  await expect(page.locator('#title-screen')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await audioStatus(page)).theme, { timeout: 15_000 }).toBe('title');
  expect((await audioStatus(page)).state).toBe('running');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  await waitForEngine(page);
  await expect(page.locator('#title-screen .title-choice').first()).toContainText('Continue');
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

test('the soundtrack plays any theme from the title screen and returns to the title music', async ({ page }) => {
  await page.goto('/');
  await waitForEngine(page);
  await page.locator('#title-screen [data-link="music"]').click();
  const sheet = page.locator('.sheet-soundtrack');
  await expect(sheet).toBeVisible();
  await sheet.locator('.soundtrack-row', { hasText: 'Drums in the Deep' }).click();
  await expect.poll(async () => (await audioStatus(page)).theme).toBe('moria');
  await expect(sheet.locator('.soundtrack-row.playing')).toContainText('Drums in the Deep');
  await expect(sheet.locator('.soundtrack-now')).toContainText('Drums in the Deep');
  await sheet.locator('.sheet-action', { hasText: 'Play all' }).click();
  await expect.poll(async () => (await audioStatus(page)).theme).toBe('title');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await audioStatus(page)).theme).toBe('title');
  expect(await page.evaluate(() => window.__tome!.audio.listeningTo)).toBeNull();
});

test('the soundtrack plays even when music and sound are off', async ({ page }) => {
  await page.goto('/');
  await waitForEngine(page);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(true);
  await page.evaluate(() => window.__tome!.audio.setVolumes('off', 'off'));
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(false);

  await page.locator('#title-screen [data-link="music"]').click();
  await page.locator('.sheet-soundtrack .soundtrack-row', { hasText: 'The Golden Wood' }).click();
  await expect.poll(async () => (await audioStatus(page)).theme).toBe('lorien');
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(true);
  await expect.poll(async () => (await audioStatus(page)).state).toBe('running');

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await audioStatus(page)).ticking).toBe(false);
});
