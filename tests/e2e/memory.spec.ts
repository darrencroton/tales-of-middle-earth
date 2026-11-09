import type { Page } from '@playwright/test';
import { canvasBrightness, continueAs, createCharacter, dismissMore, equipSuggested, expect, findFeature, jumpToLevel, keptLevelFiles, playerPos, pressExplore, saveAndQuit, sendText, test, travelTo, waitAtCommand, waitForEngine, waitForScreen, wizardCommand } from './helpers.ts';

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

/* The ways one level down and up: stairs, or paths where the dungeon is open land. */
const WAY_DOWN = /^(down staircase|path to the next area)$/;
const WAY_UP = /^(up staircase|path to the previous area)$/;

/** What the hero stands on, and whether no grid of it without a creature lies nearer to `from` (by tome2's distance). */
function arrival(page: Page, from: { x: number; y: number }): Promise<{ underfoot: string; nearest: boolean }> {
  return page.evaluate(({ x, y }) => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const names = tome.engine.features().map((f) => f.name);
    const distance = (i: number) => {
      const dx = Math.abs((i % snap.width) - x);
      const dy = Math.abs(Math.floor(i / snap.width) - y);
      return dy > dx ? dy + (dx >> 1) : dx + (dy >> 1);
    };
    const here = snap.py * snap.width + snap.px;
    const underfoot = names[snap.feat[here]];
    const creature = (i: number) => (snap.layer[i] & 0x7f) === 3;
    const nearest = snap.feat.every((f, i) => names[f] !== underfoot || creature(i) || distance(i) >= distance(here));
    return { underfoot, nearest };
  }, from);
}

/** Takes the way on underfoot from the toolbar, which names it, to `depth`. */
async function takeStairs(page: Page, id: 'descend' | 'ascend', depth: number): Promise<void> {
  const button = page.locator(`#toolbar [data-action="${id}"]`);
  await expect(button).toContainText(id === 'descend' ? 'Descend' : 'Ascend');
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.depth), { timeout: 30_000 }).toBe(depth);
  await dismissMore(page);
  await waitAtCommand(page);
}

/** Explores a few times, sending the creatures around away first (wizard mode), so a fight cannot end the test. */
async function explore(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await dismissMore(page);
    await waitAtCommand(page);
    await wizardCommand(page, 'z');
    await pressExplore(page);
  }
  await dismissMore(page);
  await waitAtCommand(page);
}

test('kept levels stay as the hero left them, their stairs lead one level on and back, the way back is known, the heading follows the depth, and the first level stays as it was left after a trip up to the land', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Keeper');
  /* Experience enough to outlast a creature arriving from beyond the reach of the wizard's zap, so no fight can end the journeys. */
  await wizardCommand(page, 'x', 500);
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
  /* Level 3 holds a random quest, whose card tells it. */
  await page.locator('.sheet [data-action="onward"]').click();
  expect(await heading()).toBe('down');
  await jumpToLevel(page, 2);
  const again = await level(page);
  expect(again.terrain).toBe(leaving.terrain);
  expect(again.known).toBeGreaterThanOrEqual(leaving.known);
  /* Come up from below, the hero arrives as on a level tome2 builds: on a staircase back down, the one nearest where they left. */
  expect(await arrival(page, back)).toEqual({ underfoot: expect.stringMatching(WAY_DOWN), nearest: true });
  expect(await heading()).toBe('up');

  /* tome2's view from the last visit is not brought back with the level: away from there, no grid is still in view, and the light reaches every grid beside the hero. */
  await wizardCommand(page, 't');
  const view = await page.evaluate(() => {
    const snap = window.__tome!.engine.snapshot()!;
    let beyondSight = 0;
    let darkBeside = 0;
    for (let i = 0; i < snap.info.length; i++) {
      const reach = Math.max(Math.abs((i % snap.width) - snap.px), Math.abs(Math.floor(i / snap.width) - snap.py));
      if ((snap.info[i] & 0x20) && reach > 20) beyondSight++;
      if (reach === 1 && !(snap.info[i] & 0x10)) darkBeside++;
    }
    return { beyondSight, darkBeside };
  });
  expect(view).toEqual({ beyondSight: 0, darkBeside: 0 });

  /* Once the level is mapped, exploring has nothing left but the way on. */
  await wizardCommand(page, 'w');
  expect((await page.evaluate(() => window.__tome!.exploreStop()))?.kind).not.toBe('frontier');

  /* By the stairs, each kept level leads one on and one back, onto the way taken (away from the quest levels at 3 and 8). */
  const wayDown = async (depth: number) => {
    await wizardCommand(page, 'w');
    const way = await findFeature(page, WAY_DOWN, { known: true });
    expect(way, `no way down known on level ${depth}`).not.toBeNull();
    await travelTo(page, way!);
    return way!;
  };
  await jumpToLevel(page, 5);
  const down5 = await wayDown(5);
  await takeStairs(page, 'descend', 6);
  const up6 = await playerPos(page);
  expect((await arrival(page, up6)).underfoot).toMatch(WAY_UP);
  await takeStairs(page, 'ascend', 5);
  expect(await playerPos(page)).toEqual(down5);
  await takeStairs(page, 'descend', 6);
  expect(await playerPos(page)).toEqual(up6);
  /* A level last left by its way down, entered from above, puts the hero on the way up nearest it, which leads back one level. */
  const down6 = await wayDown(6);
  await takeStairs(page, 'descend', 7);
  await jumpToLevel(page, 5);
  expect(await playerPos(page)).toEqual(down5);
  await takeStairs(page, 'descend', 6);
  expect(await arrival(page, down6)).toEqual({ underfoot: expect.stringMatching(WAY_UP), nearest: true });
  await takeStairs(page, 'ascend', 5);
  expect(await playerPos(page)).toEqual(down5);

  /* The first level stays as it was left after a trip up to the land. */
  await jumpToLevel(page, 1);
  const first = await level(page);
  const firstAt = await playerPos(page);

  await jumpToLevel(page, 0);
  const downStairs = await findFeature(page, /down staircase/, { known: true });
  expect(downStairs, 'no way down known on the land').not.toBeNull();
  await travelTo(page, downStairs!);
  expect(await playerPos(page)).toEqual(downStairs);

  await page.evaluate(() => window.__tome!.sendText('\\>'));
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.depth), { timeout: 30_000 }).toBe(1);
  await dismissMore(page);
  await waitAtCommand(page);
  expect((await level(page)).terrain).toBe(first.terrain);
  expect(await arrival(page, firstAt)).toEqual({ underfoot: expect.stringMatching(WAY_UP), nearest: true });

  /* Out of a dungeon by its top stairs, the hero comes up on its entrance however they went in: the Maze, entered from Bree as Word of Recall would, leads out south of Bree. */
  await wizardCommand(page, 'D', 18);
  await wizardCommand(page, 'F', 6);
  await sendText(page, '\\<');
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.depth), { timeout: 30_000 }).toBe(0);
  await dismissMore(page);
  await waitAtCommand(page);
  expect(await page.evaluate(() => {
    const tome = window.__tome!;
    const place = tome.engine.place()!;
    const snap = tome.engine.snapshot()!;
    return { wx: place.wx, wy: place.wy, town: place.town, underfoot: tome.engine.features()[snap.feat[snap.py * snap.width + snap.px]].name };
  })).toEqual({ wx: 35, wy: 25, town: 0, underfoot: 'down staircase' });
});

test.describe(() => {
  test.use({ settings: { animation: 'off', persistentLevels: false } });

  test('levels are made anew on each visit when they are not kept, and small levels are small, except in Moria', async ({ page }) => {
    const size = () => page.evaluate(() => {
      const snap = window.__tome!.engine.snapshot()!;
      return `${snap.width}x${snap.height}`;
    });
    const small = ['66x22', '66x44', '132x22', '66x66'];
    await page.goto('./?wizard');
    await waitForEngine(page);
    await createCharacter(page, 'Wanderer');
    await jumpToLevel(page, 2);
    const before = await level(page);
    expect(small).toContain(await size());
    await jumpToLevel(page, 3);
    await jumpToLevel(page, 2);
    expect((await level(page)).terrain).not.toBe(before.terrain);
    /* Moria is built vast whatever the setting. */
    await wizardCommand(page, 'D', 22);
    expect(await size()).toBe('198x66');
  });
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
  /* A young hero does not explore the world map: More's Explore is dimmed and says why. */
  await page.locator('#toolbar [data-action="commands"]').click();
  const explore = page.locator('.sheet .command', { hasText: 'Explore' });
  await expect(explore).toHaveClass(/unavailable/);
  await explore.click();
  await expect(page.locator('#toast')).toContainText('level 20');
  expect(await wild()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.locator('#toolbar [data-action="walkhere"]').click();
  await expect.poll(wild).toBe(false);
  await expect(page.locator('#toolbar [data-action="walkhere"]')).toHaveCount(0);
  await expect(page.locator('#toolbar [data-action="inventory"]')).toBeVisible();
  await dismissMore(page);
  await waitAtCommand(page);
  await expect.poll(() => canvasBrightness(page, '#map', whole), { timeout: 5_000 }).toBeGreaterThan(lit / 2);

  /* tome2 will not let the hero rest on a Void Jumpgate: Rest is dimmed and says so, taking no turn and opening nothing. */
  await wizardCommand(page, 'F', 160);
  const rest = page.locator('#toolbar [data-action="rest"]');
  await expect(rest).toHaveClass(/unavailable/);
  const turn = await page.evaluate(() => window.__tome!.engine.snapshot()!.turn);
  await rest.click();
  await expect(page.locator('#toast')).toHaveText('Resting on a Void Jumpgate is too dangerous.');
  await expect(page.locator('.tv-layer')).toBeHidden();
  expect(await page.evaluate(() => window.__tome!.engine.snapshot()!.turn)).toBe(turn);
});

test("a quest level is never kept as the dungeon level of its depth, Thráin's level is never kept, and a quest's end is told as its level is left", async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Warden');
  /* In wizard mode tome2 says at birth where Thráin is held in Dol Guldur (dungeon 23). */
  const messages = await page.evaluate(() => (window.__tome!.engine.gameState(200)?.messages ?? []).map((m) => m.text).join('\n'));
  const thrainDepth = Number(/Thrain lvl (\d+)/.exec(messages)?.[1]);
  expect(thrainDepth).toBeGreaterThan(0);
  /* The Thieves quest, taken; its entrance is in Bree. tome2 builds a quest's level at depth 1 and moves it to the quest's own depth. */
  await wizardCommand(page, 'q', 4);
  await wizardCommand(page, 'u');
  const entrance = await findFeature(page, /^quest entrance$/i);
  expect(entrance).not.toBeNull();
  await travelTo(page, entrance!);
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
  /* The hero wakes on the cell's floor, as its map places them: no way out is made under them. */
  expect((await arrival(page, await playerPos(page))).underfoot).not.toMatch(/stair|path|shaft/);
  await card.locator('[data-action="onward"]').click();
  await expect(card).toBeHidden();
  await expect(page.locator('#hud .entity.quest')).toBeVisible();
  expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);

  /* Saved there, and saved again on leaving after the game is loaded there: no dungeon level keeps it. */
  await sendText(page, '\u0013');
  await dismissMore(page);
  await waitAtCommand(page);
  expect(await keptLevelFiles(page)).toEqual([]);
  await saveAndQuit(page);
  await waitForEngine(page);
  await continueAs(page, 'Warden');
  expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);
  await jumpToLevel(page, 0);
  expect(await keptLevelFiles(page)).toEqual([]);

  /* Thráin's level is never kept, from the first arrival on which tome2 takes his quest; he is there from the next. */
  await wizardCommand(page, 'D', 23);
  const quest = () => page.evaluate(() => window.__tome!.engine.gameState()?.player?.quest?.id ?? 0);
  await jumpToLevel(page, thrainDepth);
  expect(await quest()).toBe(0);
  expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);
  /* His cell has one try to fit as each level is made. */
  for (let visit = 0; visit < 4 && (await quest()) !== 19; visit++) {
    await jumpToLevel(page, thrainDepth - 1);
    await jumpToLevel(page, thrainDepth);
    expect(await page.evaluate(() => window.__tome!.engine.place()?.kept)).toBe(0);
  }
  expect(await quest()).toBe(19);
  await card.locator('[data-action="onward"]').click();
  await expect(card).toBeHidden();

  /* Nirnaeth Arnoediad ends as the hero takes its stairs out; its entrance in Gondolin, shown while it is taken, lies below the Dragons' one. */
  await wizardCommand(page, 'q', 14);
  /* Up to the land first: from a dungeon level, the wizard's teleport to a town comes up by the dungeon's entrance, as climbing out does. */
  await jumpToLevel(page, 0);
  await wizardCommand(page, 'T', 2);
  const nirnaeth = await page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const features = tome.engine.features();
    let lowest: { x: number; y: number } | null = null;
    for (let i = 0; i < snap.feat.length; i++) {
      if (/^quest entrance$/i.test(features[snap.feat[i]]?.name ?? '')) lowest = { x: i % snap.width, y: Math.floor(i / snap.width) };
    }
    return lowest;
  });
  expect(nirnaeth).not.toBeNull();
  await travelTo(page, nirnaeth!);
  await waitAtCommand(page);
  await page.locator('#toolbar [data-action="enter"]').click();
  await expect.poll(quest, { timeout: 30_000 }).toBe(14);
  await waitAtCommand(page);
  await card.locator('[data-action="onward"]').click();
  await expect(card).toBeHidden();
  /* A staircase underfoot, as the trolls stand between the hero and the way out. */
  await wizardCommand(page, 'F', 6);
  await sendText(page, '\\<');
  await dismissMore(page);
  await expect(card.locator('.sheet-subtitle')).toHaveText('Quest complete');
  await expect(card.locator('.sheet-title')).toHaveText('Nirnaeth Arnoediad');
  await expect(card.locator('.lead-in')).toContainText('You found a way out!');
  await card.locator('[data-action="onward"]').click();
  await expect(page.locator('#hud .entity.quest')).toHaveCount(0);
  /* The quest log keeps it, under those completed, its reward waiting in Gondolin. */
  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Knowledge' }).click();
  await page.locator('.sheet .row-button', { hasText: 'Quests' }).click();
  const completed = page.locator('.sheet .sheet-section', { hasText: 'Completed' });
  await expect(completed.locator('.quest-row', { hasText: 'Nirnaeth Arnoediad' })).toContainText('Reward waiting');
  await expect(page.locator('.sheet .sheet-section', { hasText: 'Under way' })).not.toContainText('Nirnaeth Arnoediad');
});
