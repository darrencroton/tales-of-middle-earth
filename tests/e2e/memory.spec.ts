import { expect, test, type Page } from '@playwright/test';
import { createCharacter, dismissMore, equipSuggested, jumpToLevel, playerPos, waitAtCommand, waitForEngine } from './helpers.ts';

/** A fingerprint of the level's terrain, and how many grids the hero remembers. */
function level(page: Page): Promise<{ terrain: number; known: number; depth: number }> {
  return page.evaluate(() => {
    const snap = window.__tome!.engine.snapshot()!;
    let terrain = 0;
    let known = 0;
    for (let i = 0; i < snap.feat.length; i++) {
      terrain = (terrain * 31 + snap.feat[i] + i) >>> 0;
      if (snap.info[i] & 0x01) known++;
    }
    return { terrain, known, depth: snap.depth };
  });
}

async function explore(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await dismissMore(page);
    await waitAtCommand(page);
    const button = page.locator('#toolbar [data-action="explore"]');
    if (!(await button.count())) break;
    await button.click();
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
  }
  await dismissMore(page);
  await waitAtCommand(page);
}

test('kept levels stay as the hero left them, and the way back is known', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Keeper');
  await jumpToLevel(page, 2);
  await equipSuggested(page);
  const start = await playerPos(page);
  await explore(page, 4);

  const before = await level(page);
  const left = await playerPos(page);
  expect(before.known).toBeGreaterThan(0);

  /* Every floor the hero walked is remembered, so a tap on the start walks back there. */
  if (left.x !== start.x || left.y !== start.y) {
    await page.evaluate(([x, y]) => window.__tome!.tapCell(x, y), [start.x, start.y] as const);
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
    const cause = await page.evaluate(() => window.__tome!.lastStopCause());
    if (!/monster|hurt/.test(cause)) expect(await playerPos(page), `stopped: ${cause}`).toEqual(start);
  }
  const back = await playerPos(page);
  const known = (await level(page)).known;

  await jumpToLevel(page, 3);
  expect((await level(page)).depth).toBe(3);
  await jumpToLevel(page, 2);
  const again = await level(page);
  expect(again.terrain).toBe(before.terrain);
  expect(again.known).toBeGreaterThanOrEqual(known);
  expect(await playerPos(page)).toEqual(back);
});

test('levels are made anew on each visit when they are not kept', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tome2mobile.settings', JSON.stringify({ persistentLevels: false }));
  });
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Wanderer');
  await jumpToLevel(page, 2);
  const before = await level(page);
  await jumpToLevel(page, 3);
  await jumpToLevel(page, 2);
  expect((await level(page)).terrain).not.toBe(before.terrain);
});

test('a mapped level leaves exploring nothing but its landmarks and the way on, which turns upward on the way back', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Pathfinder');
  await jumpToLevel(page, 2);
  await page.evaluate(() => window.__tome!.sendText('\u0001w'));
  await dismissMore(page);
  await waitAtCommand(page);
  const stop = await page.evaluate(() => window.__tome!.exploreStop());
  expect(stop?.kind).not.toBe('frontier');
  expect(stop?.heading).toBe('down');

  await jumpToLevel(page, 1);
  expect((await page.evaluate(() => window.__tome!.exploreStop()))?.heading).toBe('up');
  await jumpToLevel(page, 2);
  expect((await page.evaluate(() => window.__tome!.exploreStop()))?.heading).toBe('down');
});
