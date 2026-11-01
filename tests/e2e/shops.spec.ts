import type { Page } from '@playwright/test';
import { createCharacter, expect, jumpToLevel, summonBeside, test, waitAtCommand, waitForEngine, wizardCommand } from './helpers.ts';

/** The door of a town building, by the glyph and colour tome2 draws it with (st_info.txt). */
async function door(page: Page, glyph: string, colour: number): Promise<{ x: number; y: number }> {
  const cell = await page.evaluate(
    ([g, c]) => {
      const tome = window.__tome!;
      const snap = tome.engine.snapshot()!;
      const feats = tome.engine.features();
      const i = snap.feat.findIndex((f, n) => feats[f]?.name === 'Building' && snap.glyph[n] === g.charCodeAt(0) && snap.attr[n] === c);
      return i < 0 ? null : { x: i % snap.width, y: Math.floor(i / snap.width) };
    },
    [glyph, colour] as const,
  );
  expect(cell, `no building drawn as ${glyph} in colour ${colour}`).not.toBeNull();
  return cell!;
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
  test.setTimeout(240_000);
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Shopper');

  /* Townsfolk sent away, so nothing stops the walks. */
  await wizardCommand(page, 'z');

  /* A museum that tome2 words differently from a shop is shown the same way, not as tome2's raw screen. */
  expect(await walkIn(page, await door(page, '+', 5))).toBe('The Mathom-house');
  await expect(page.locator('.termview [data-tab="shelf"]')).toHaveText('Collection');
  await expect(page.locator('.termview .empty')).toContainText('display cases stand empty');
  await leave(page);

  expect(await walkIn(page, await door(page, '1', 15))).toBe('General Store');
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
  const shopDoor = page.locator('#toolbar [data-action="shop"]');
  await expect(shopDoor).toContainText('Enter shop');
  await shopDoor.click();
  await expect(page.locator('.termview [data-tab="exit"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await waitAtCommand(page);

  /* tome2 draws a service's answer over the building's screen and pages long ones: it is shown in a card. */
  expect(await walkIn(page, await door(page, '+', 3))).toBe("Mayor's Office");
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
  /* Lit, so the way is known; travel pushes past a companion only from a floor, as tome2 does. */
  await wizardCommand(page, 'w');
  let pushed = false;
  for (let attempt = 0; attempt < 8 && !pushed; attempt++) {
    await summonBeside(page, 35, true);
    /* Two steps away past a companion, where no other way is as short (beside it on a diagonal, or walled on both sides). */
    const goal = await page.evaluate(() => {
      const tome = window.__tome!;
      const snap = tome.engine.snapshot()!;
      const features = tome.engine.features();
      const monsters = tome.engine.gameState()!.monsters!;
      const open = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < snap.width && y < snap.height && ((features[snap.feat[y * snap.width + x]]?.flags ?? 0) & 4) !== 0 && !monsters.some((m) => m.x === x && m.y === y);
      if (!((features[snap.feat[snap.py * snap.width + snap.px]]?.flags ?? 0) & 4)) return null;
      for (const pet of monsters.filter((m) => m.status > 0)) {
        const dx = pet.x - snap.px;
        const dy = pet.y - snap.py;
        const x = pet.x + dx;
        const y = pet.y + dy;
        const sides = dx && dy ? [] : dx ? [[pet.x, pet.y - 1], [pet.x, pet.y + 1]] : [[pet.x - 1, pet.y], [pet.x + 1, pet.y]];
        if (open(x, y) && !sides.some(([sx, sy]) => open(sx, sy))) return { x, y };
      }
      return null;
    });
    if (!goal) {
      await wizardCommand(page, 'p');
      continue;
    }
    await page.evaluate(({ x, y }) => window.__tome!.tapCell(x, y), goal);
    await page.waitForTimeout(1500);
    await waitAtCommand(page);
    pushed = await page.evaluate(() => window.__tome!.engine.gameState(10)!.messages!.some((m) => /You push past/.test(m.text)));
  }
  expect(pushed).toBe(true);
});
