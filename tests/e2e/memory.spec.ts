import type { Page } from '@playwright/test';
import { canvasBrightness, createCharacter, dismissMore, equipSuggested, expect, jumpToLevel, keptLevelFiles, playerPos, pressExplore, sendText, test, waitAtCommand, waitForEngine, waitForScreen, wizardCommand } from './helpers.ts';

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

/** Explores a few times, sending the creatures around away first (wizard mode), so a fight cannot end the test. */
async function explore(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await dismissMore(page);
    await waitAtCommand(page);
    await page.evaluate(() => window.__tome!.sendText('\u0001z'));
    await dismissMore(page);
    await waitAtCommand(page);
    await pressExplore(page);
  }
  await dismissMore(page);
  await waitAtCommand(page);
}

test('kept levels stay as the hero left them, the way back is known, and the heading follows the depth', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Keeper');
  await jumpToLevel(page, 2);
  /* The hero arrives on stairs, which are always remembered; gear is taken just off them, in the dark. */
  const start = await playerPos(page);
  await equipSuggested(page);
  await explore(page, 2);

  const before = await level(page);
  const left = await playerPos(page);
  expect(before.known).toBeGreaterThan(0);

  /* Every floor the hero walked is remembered, so a tap on the start walks back there. */
  if (left.x !== start.x || left.y !== start.y) {
    const remembered = await page.evaluate(([x, y]) => {
      const snap = window.__tome!.engine.snapshot()!;
      return (snap.info[y * snap.width + x] & 0x11) !== 0;
    }, [start.x, start.y] as const);
    expect(remembered, 'the start is remembered').toBe(true);
    await wizardCommand(page, 'z');
    await page.evaluate(([x, y]) => window.__tome!.tapCell(x, y), [start.x, start.y] as const);
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
    const cause = await page.evaluate(() => window.__tome!.lastStopCause());
    if (!/monster|hurt/.test(cause)) expect(await playerPos(page), `stopped: ${cause}`).toEqual(start);
  }
  /* The level as it is left: the walk back may have opened a door. */
  const back = await playerPos(page);
  const leaving = await level(page);

  const heading = async () => (await page.evaluate(() => window.__tome!.exploreStop()))?.heading;
  expect(await heading()).toBe('down');
  await jumpToLevel(page, 3);
  expect((await level(page)).depth).toBe(3);
  expect(await heading()).toBe('down');
  await jumpToLevel(page, 2);
  const again = await level(page);
  expect(again.terrain).toBe(leaving.terrain);
  expect(again.known).toBeGreaterThanOrEqual(leaving.known);
  expect(await playerPos(page)).toEqual(back);
  expect(await heading()).toBe('up');

  /* Once the level is mapped, exploring has nothing left but the way on. */
  await wizardCommand(page, 'w');
  expect((await page.evaluate(() => window.__tome!.exploreStop()))?.kind).not.toBe('frontier');
});

test.describe(() => {
  test.use({ settings: { animation: 'off', persistentLevels: false } });

  test('levels are made anew on each visit when they are not kept', async ({ page }) => {
    await page.goto('./?wizard');
    await waitForEngine(page);
    await createCharacter(page, 'Wanderer');
    await jumpToLevel(page, 2);
    const before = await level(page);
    await jumpToLevel(page, 3);
    await jumpToLevel(page, 2);
    expect((await level(page)).terrain).not.toBe(before.terrain);
  });
});

test('the first level stays as it was left after a trip up to the land', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Homebody');
  await jumpToLevel(page, 1);
  const before = await level(page);
  const left = await playerPos(page);

  await jumpToLevel(page, 0);
  const entrance = await page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const features = tome.engine.features();
    for (let i = 0; i < snap.feat.length; i++) {
      if (/down staircase/.test(features[snap.feat[i]].name) && snap.info[i] & 0x11) return { x: i % snap.width, y: Math.floor(i / snap.width) };
    }
    return null;
  });
  expect(entrance, 'no way down known on the land').not.toBeNull();
  for (let i = 0; i < 12; i++) {
    const here = await playerPos(page);
    if (here.x === entrance!.x && here.y === entrance!.y) break;
    await page.evaluate(() => window.__tome!.sendText('\u0001z'));
    await dismissMore(page);
    await waitAtCommand(page);
    await page.evaluate(([x, y]) => window.__tome!.tapCell(x, y), [entrance!.x, entrance!.y] as const);
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
  }
  expect(await playerPos(page)).toEqual(entrance);

  await page.evaluate(() => window.__tome!.sendText('\\>'));
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.depth), { timeout: 30_000 }).toBe(1);
  await dismissMore(page);
  await waitAtCommand(page);
  expect((await level(page)).terrain).toBe(before.terrain);
  expect(await playerPos(page)).toEqual(left);
});

test('the world map is entered from the commands and left from the toolbar, and at night the land is drawn at once on coming down', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Nightowl');
  const command = async (keys: string) => {
    await page.evaluate((k) => window.__tome!.sendText(k), keys);
    await dismissMore(page);
    await waitAtCommand(page);
  };
  const night = () => page.evaluate(() => !!window.__tome!.engine.place()?.night);
  test.setTimeout(300_000);
  for (let i = 0; i < 12 && !(await night()); i++) {
    await command('\u0001a');
    await command('\u0001z');
    const turn = await page.evaluate(() => window.__tome!.engine.snapshot()!.turn);
    await page.evaluate(() => window.__tome!.sendText('\\R'));
    await waitForScreen(page, /^Rest \(/);
    await page.evaluate(() => window.__tome!.sendText('9999\r'));
    await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.turn), { timeout: 60_000 }).toBeGreaterThan(turn);
    await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.atCommand), { timeout: 60_000 }).toBe(true);
    await dismissMore(page);
    await waitAtCommand(page);
  }
  expect(await night(), 'night never fell').toBe(true);
  await command('\u0001z');
  const whole = { x: 0, y: 0, w: 1, h: 1 };
  const lit = await canvasBrightness(page, '#map', whole);

  const wild = () => page.evaluate(() => window.__tome!.engine.snapshot()!.wild);
  await page.locator('#toolbar [data-action="commands"]').click();
  await expect(page.locator('.sheet .command', { hasText: 'Go up' })).toHaveCount(0);
  await page.locator('.sheet .command', { hasText: 'World map' }).click();
  await expect.poll(wild).toBe(true);
  await waitAtCommand(page);
  await expect(page.locator('#toolbar [data-action="explore"]')).toHaveCount(0);
  await page.locator('#toolbar [data-action="walkhere"]').click();
  await expect.poll(wild).toBe(false);
  await expect(page.locator('#toolbar [data-action="walkhere"]')).toHaveCount(0);
  await expect(page.locator('#toolbar [data-action="inventory"]')).toBeVisible();
  await dismissMore(page);
  await waitAtCommand(page);
  await expect.poll(() => canvasBrightness(page, '#map', whole), { timeout: 5_000 }).toBeGreaterThan(lit / 2);
});

test('a quest level is never kept as the dungeon level of its depth', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Warden');
  /* The Thieves quest, taken; its entrance is in Bree. tome2 builds a quest's level at depth 1 and moves it to the quest's own depth. */
  await wizardCommand(page, 'q', 4);
  await wizardCommand(page, 'u');
  const entrance = await page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const names = tome.engine.features().map((f) => f.name.toLowerCase());
    const i = snap.feat.findIndex((f) => names[f] === 'quest entrance');
    return i < 0 ? null : { x: i % snap.width, y: Math.floor(i / snap.width) };
  });
  expect(entrance).not.toBeNull();
  for (let i = 0; i < 12; i++) {
    const here = await playerPos(page);
    if (here.x === entrance!.x && here.y === entrance!.y) break;
    await page.evaluate(() => window.__tome!.sendText('\u0001z'));
    await dismissMore(page);
    await waitAtCommand(page);
    await page.evaluate(({ x, y }) => window.__tome!.tapCell(x, y), entrance!);
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
  }
  await waitAtCommand(page);
  await page.locator('#toolbar [data-action="enter"]').click();
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.gameState()?.player?.quest?.id ?? 0), { timeout: 30_000 }).toBe(4);
  await waitAtCommand(page);
  /* The first arrival is told in a card: the scene tome2 tells, then what the quest asks. */
  const card = page.locator('.sheet-quest');
  await expect(card.locator('.sheet-title')).toHaveText('Thieves!');
  await expect(card.locator('.lead-in')).toContainText('You wake up in a prison cell.');
  await expect(card.locator('.lead-in')).not.toContainText('You have no more');
  await expect(card).toContainText('kill these ruffians');
  await card.locator('[data-action="onward"]').click();
  await expect(card).toBeHidden();
  await expect(page.locator('#hud .entity.quest')).toBeVisible();
  expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);

  /* Saved there, and saved again on leaving after the game is loaded there: no dungeon level keeps it. */
  await sendText(page, '\u0013');
  await dismissMore(page);
  await waitAtCommand(page);
  expect(await keptLevelFiles(page)).toEqual([]);
  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Save and quit' }).click();
  await page.locator('.sheet-action.primary', { hasText: 'Save and quit' }).click();
  await expect(page.locator('#title-screen')).toBeVisible({ timeout: 60_000 });
  await waitForEngine(page);
  await page.locator('#title-screen .title-choice', { hasText: 'Continue as Warden' }).click();
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });
  await waitAtCommand(page);
  expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);
  await jumpToLevel(page, 0);
  expect(await keptLevelFiles(page)).toEqual([]);
});

test("Thráin's level is never kept, from the first arrival on which tome2 takes his quest; he is there from the next", async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Rescuer');
  /* In wizard mode tome2 says at birth where Thráin is held in Dol Guldur (dungeon 23). */
  const messages = await page.evaluate(() => (window.__tome!.engine.gameState(200)?.messages ?? []).map((m) => m.text).join('\n'));
  const depth = Number(/Thrain lvl (\d+)/.exec(messages)?.[1]);
  expect(depth).toBeGreaterThan(0);
  await wizardCommand(page, 'D', 23);
  const quest = () => page.evaluate(() => window.__tome!.engine.gameState()?.player?.quest?.id ?? 0);
  await jumpToLevel(page, depth);
  expect(await quest()).toBe(0);
  expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);
  /* His cell has one try to fit as each level is made. */
  for (let visit = 0; visit < 4 && (await quest()) !== 19; visit++) {
    await jumpToLevel(page, depth - 1);
    await jumpToLevel(page, depth);
    expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);
  }
  expect(await quest()).toBe(19);
});
