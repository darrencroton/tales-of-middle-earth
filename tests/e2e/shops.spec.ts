import { expect, test, type Page } from '@playwright/test';
import { createCharacter, jumpToLevel, summonBeside, waitAtCommand, waitForEngine, wizardCommand } from './helpers.ts';

/** Cells of the town's buildings (tome2 calls every shop, home and hall a building). */
async function buildings(page: Page): Promise<{ x: number; y: number }[]> {
  return page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const feats = tome.engine.features();
    const cells: { x: number; y: number }[] = [];
    for (let i = 0; i < snap.feat.length; i++) if (feats[snap.feat[i]]?.name === 'Building') cells.push({ x: i % snap.width, y: Math.floor(i / snap.width) });
    return cells;
  });
}

/** Walks to a building's door (again whenever townsfolk stop the walk) until its panel shows; the building's name. */
async function walkIn(page: Page, cell: { x: number; y: number }): Promise<string | null> {
  for (let i = 0; i < 120; i++) {
    if (await page.locator('.termview [data-tab="exit"]').isVisible()) break;
    const idle = await page.evaluate(() => !window.__tome!.travelling() && window.__tome!.mode() === 'map' && !!window.__tome!.engine.snapshot()?.atCommand);
    if (idle && i % 8 === 0) await page.evaluate(({ x, y }) => window.__tome!.tapCell(x, y), cell);
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => window.__tome!.engine.store()?.name ?? null);
}

async function leave(page: Page): Promise<void> {
  await page.locator('.termview [data-tab="exit"]').click();
  await expect(page.locator('.termview [data-tab="exit"]')).toBeHidden();
  await waitAtCommand(page);
}

test('shops show their whole stock natively, buy and sell from item cards, the door offers going back in, and a service\'s answer is shown', async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Shopper');

  const names: Record<string, { x: number; y: number }> = {};
  for (const cell of await buildings(page)) {
    const name = await walkIn(page, cell);
    if (!name) continue;
    names[name] = cell;
    if (name === 'The Mathom-house') {
      /* A museum that tome2 words differently from a shop is shown the same way, not as tome2's raw screen. */
      await expect(page.locator('.termview [data-tab="shelf"]')).toHaveText('Collection');
      await expect(page.locator('.termview .empty')).toContainText('display cases stand empty');
    }
    await leave(page);
    if (names['General Store'] && names['The Mathom-house']) break;
  }
  expect(Object.keys(names)).toContain('General Store');

  await walkIn(page, names['General Store']);
  const stock = await page.evaluate(() => window.__tome!.engine.store()!.stock.length);
  await expect(page.locator('.termview .shop-row')).toHaveCount(stock);
  await expect(page.locator('.termview [data-action="nextpage"]')).toHaveCount(0);

  /* Rations are always stocked (st_info.txt), so a run's random stock cannot leave them out. */
  const rations = () => page.evaluate(() => window.__tome!.engine.inventory()!.pack.find((i) => /Rations? of Food/.test(i.name))?.number ?? 0);
  const before = await rations();
  const gold = await page.evaluate(() => window.__tome!.engine.store()!.gold);
  await page.locator('.termview .shop-row', { hasText: 'Rations of Food' }).click();
  await expect(page.locator('.sheet-item [data-action="take"]')).toHaveText(/^Buy 1 for \d+ gold$/);
  await page.locator('.sheet-item .stepper-button', { hasText: '+' }).click();
  await expect(page.locator('.sheet-item [data-action="take"]')).toHaveText(/^Buy 2 for \d+ gold$/);
  await page.locator('.sheet-item [data-action="take"]').click();
  await expect.poll(rations).toBe(before + 2);
  await expect(page.locator('#toast')).toContainText('Bought 2 × Rations of Food');
  expect(await page.evaluate(() => window.__tome!.engine.store()!.gold)).toBeLessThan(gold);

  await page.locator('.termview [data-tab="offer"]').click();
  await expect(page.locator('.termview .shop-note')).toContainText('buys food');
  await page.locator('.termview .shop-row', { hasText: 'Rations of Food' }).click();
  await page.locator('.sheet-item [data-action="offer"]').click();
  await expect.poll(rations).toBe(before + 1);
  await expect(page.locator('#toast')).toContainText('Sold Rations of Food');

  await leave(page);
  const door = page.locator('#toolbar [data-action="shop"]');
  await expect(door).toContainText('Enter shop');
  await door.click();
  await expect(page.locator('.termview [data-tab="exit"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await waitAtCommand(page);

  /* tome2 draws a service's answer over the building's screen and pages long ones: it is shown in a card. */
  for (const cell of await buildings(page)) {
    if (names["Mayor's Office"]) break;
    const name = await walkIn(page, cell);
    if (name === "Mayor's Office") names[name] = cell;
    else if (name) await leave(page);
  }
  if (!(await page.locator('.termview [data-tab="exit"]').isVisible())) await walkIn(page, names["Mayor's Office"]);
  const quest = page.locator('.termview .row-button', { hasText: 'Get a quest' });
  await quest.click();
  await expect(page.locator('.sheet-service')).toContainText('Thieves!');
  await page.locator('.sheet-service .sheet-action.primary').click();
  for (let i = 0; i < 2; i++) {
    /* The same answer again is shown again. */
    await quest.click();
    await expect(page.locator('.sheet-service')).toContainText('You have not completed your current quest yet!');
    await expect(page.locator('.sheet-service')).not.toContainText('CTRL');
    await page.locator('.sheet-service .sheet-action.primary').click();
  }
  await page.locator('.termview .row-button', { hasText: 'Race legends' }).click();
  await expect(page.locator('.sheet-service')).toContainText('You) Shopper the Human');
  await page.locator('.sheet-service .sheet-action.primary').click();
  await leave(page);
});

test('travel walks through a companion, pushing past it', async ({ page }) => {
  test.setTimeout(200_000);
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Packleader');
  await jumpToLevel(page, 1);
  /* Lit, so the way past the companion is known wherever the hero arrives. */
  await wizardCommand(page, 'w');
  let pushed = false;
  for (let attempt = 0; attempt < 6 && !pushed; attempt++) {
    await summonBeside(page, 35, true);
    const goal = await page.evaluate(() => {
      const tome = window.__tome!;
      const snap = tome.engine.snapshot()!;
      const pet = tome.engine.gameState()!.monsters!.find((m) => m.status > 0);
      return pet ? { x: pet.x + (pet.x - snap.px), y: pet.y + (pet.y - snap.py) } : null;
    });
    if (!goal) continue;
    await page.evaluate(({ x, y }) => window.__tome!.tapCell(x, y), goal);
    await page.waitForTimeout(1500);
    await waitAtCommand(page);
    pushed = await page.evaluate(() => window.__tome!.engine.gameState(10)!.messages!.some((m) => /You push past/.test(m.text)));
  }
  expect(pushed).toBe(true);
});
