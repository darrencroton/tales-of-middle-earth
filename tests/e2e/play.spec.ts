import { expect, test, type Page } from '@playwright/test';
import {
  castUntilAimed,
  createCharacter,
  dismissMore,
  equipSuggested,
  jumpToLevel,
  playerPos,
  pressExplore,
  screenText,
  stepOffStairs,
  viewMode,
  waitAtCommand,
  waitForEngine,
  waitForScreen,
} from './helpers.ts';

async function actionIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__tome!.actions());
}

async function packCount(page: Page, pattern: RegExp): Promise<number> {
  return page.evaluate(
    (source) => {
      const re = new RegExp(source);
      return (window.__tome!.engine.inventory()?.pack ?? []).filter((i) => re.test(i.name)).reduce((n, i) => n + i.number, 0);
    },
    pattern.source,
  );
}

test('tapping the map travels there along a known path', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Walker');

  const target = await page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const features = tome.engine.features();
    const ok = (x: number, y: number) => {
      const i = y * snap.width + x;
      return (snap.info[i] & 0x11) !== 0 && (features[snap.feat[i]].flags & 1) === 0 && (snap.layer[i] & 0x7f) === 1;
    };
    const onMap = (x: number, y: number) => {
      const p = tome.mapCellCentre(x, y);
      return document.elementFromPoint(p.x, p.y)?.id === 'map';
    };
    for (let d = 5; d >= 3; d--) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        const x = snap.px + dx;
        const y = snap.py + dy;
        if (x < 0 || y < 0 || x >= snap.width || y >= snap.height) continue;
        let clear = true;
        for (let k = 1; k <= d; k++) clear &&= ok(snap.px + Math.sign(dx) * k, snap.py + Math.sign(dy) * k);
        if (clear && onMap(x, y)) return { x, y };
      }
    }
    return null;
  });
  expect(target, 'no clear straight line to test travel').not.toBeNull();

  const start = await playerPos(page);
  const before = Math.max(Math.abs(start.x - target!.x), Math.abs(start.y - target!.y));
  let end = start;
  let cause = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissMore(page);
    await waitAtCommand(page);
    const point = await page.evaluate(([x, y]) => window.__tome!.mapCellCentre(x, y), [target!.x, target!.y] as const);
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 20_000 }).toBe(false);
    end = await playerPos(page);
    cause = await page.evaluate(() => window.__tome!.lastStopCause());
    const progressed = end.x !== start.x || end.y !== start.y;
    if (progressed || /monster|hurt|blocked/.test(cause)) break;
  }
  const after = Math.max(Math.abs(end.x - target!.x), Math.abs(end.y - target!.y));
  const context = `stopped (${cause || 'never started'}) at ${JSON.stringify(end)} from ${JSON.stringify(start)} towards ${JSON.stringify(target)}\n${await screenText(page)}`;
  if (after > 0 && cause !== 'interrupted') {
    await expect(page.locator('#toast'), context).toContainText(/in sight|hurt|blocked|light/);
  }
  expect(after, context).toBeLessThan(before);

  /* A tap on the hero waits a turn where they stand. */
  await dismissMore(page);
  await waitAtCommand(page);
  const here = await playerPos(page);
  const turn = await page.evaluate(() => window.__tome!.engine.snapshot()!.turn);
  const self = await page.evaluate(([x, y]) => window.__tome!.mapCellCentre(x, y), [here.x, here.y] as const);
  await page.mouse.click(self.x, self.y);
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.turn)).toBeGreaterThan(turn);
  expect(await playerPos(page)).toEqual(here);
});

test('items are used, wielded and taken off from the native inventory', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Packer');

  await expect.poll(() => actionIds(page)).toEqual(expect.arrayContaining(['inventory', 'commands', 'menu']));

  const food = await packCount(page, /Ration/);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await expect(page.locator('.sheet .item-row').first()).toBeVisible();
  await page.locator('.sheet .item-row', { hasText: 'Ration' }).click();
  await page.locator('.sheet .sheet-action', { hasText: 'Eat' }).click();
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await expect.poll(() => packCount(page, /Ration/), { timeout: 10_000 }).toBe(food - 1);
  expect(await viewMode(page)).toBe('map');

  await dismissMore(page);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await page.locator('.sheet .item-row', { hasText: /Sword|Dagger|Axe|Mace|Spear|Whip/ }).first().click();
  await page.locator('.sheet .sheet-action', { hasText: 'Wield' }).click();
  const weapon = () => page.evaluate(() => window.__tome!.engine.inventory()!.equip.find((e) => e.i === 24)?.name ?? '');
  await expect.poll(weapon, { timeout: 10_000 }).not.toBe('');

  await dismissMore(page);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await page.locator('.sheet [data-tab="equip"]').click();
  await page.locator('.sheet .item-row:not(.empty-slot)').first().click();
  await page.locator('.sheet .sheet-action', { hasText: 'Take off' }).click();
  await expect.poll(weapon, { timeout: 10_000 }).toBe('');
});

test('a stack is dropped by the number chosen, and the floor list shows alone', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Dropper');

  const food = await packCount(page, /Ration/);
  expect(food).toBeGreaterThan(2);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await page.locator('.sheet .item-row', { hasText: 'Ration' }).click();
  await expect(page.locator('.sheet [data-action="dropall"]')).toHaveCount(0);
  await page.locator('.sheet [data-action="drop"]').click();
  await expect(page.locator('.sheet.sheet-quantity .stepper-value')).toHaveText('1');
  await page.locator('.sheet.sheet-quantity .stepper-button', { hasText: `All ${food}` }).click();
  await page.locator('.sheet.sheet-quantity .stepper-button', { hasText: '−' }).click();
  await page.locator('.sheet.sheet-quantity .stepper-button', { hasText: '−' }).click();
  await expect(page.locator('.sheet.sheet-quantity [data-action="confirm"]')).toHaveText(`Drop ${food - 2}`);
  await page.locator('.sheet.sheet-quantity [data-action="confirm"]').click();
  await expect.poll(() => packCount(page, /Ration/), { timeout: 10_000 }).toBe(2);
  await dismissMore(page);
  await waitAtCommand(page);

  await page.locator('#toolbar [data-action="commands"]').click();
  await page.locator('.sheet .command', { hasText: 'Destroy' }).click();
  await waitForScreen(page, /Destroy which item/);
  if (!/Floor:/.test((await screenText(page)).split('\n')[0])) await page.locator('.termview .pop-tab', { hasText: 'Floor' }).click();
  await waitForScreen(page, /\(Floor:/);
  await expect(page.locator('.termview .tv-choice')).toHaveCount(1);
  await expect(page.locator('.termview .tv-choice')).toContainText('Ration');
  expect(await page.locator('.termview').innerText()).not.toMatch(/###/);
  await page.keyboard.press('Escape');
  await waitAtCommand(page);
});

test('tome2 menus show as tappable lists with a movable highlight', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Tapper');

  await page.locator('#toolbar [data-action="commands"]').click();
  await page.locator('.sheet .command', { hasText: 'Wear / wield' }).click();
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await waitForScreen(page, /Wear\/Wield which item/);
  await expect.poll(() => viewMode(page)).toBe('overlay');
  await expect(page.locator('.termview .tv-title')).toHaveText(/Wear\/Wield which item/);

  const first = await page.locator('.termview .tv-choice.is-active').getAttribute('data-key');
  await page.keyboard.press('ArrowDown');
  const second = await page.locator('.termview .tv-choice.is-active').getAttribute('data-key');
  expect(second).not.toBe(first);

  await page.locator('.termview .tv-choice', { hasText: 'Torch' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__tome!.engine.inventory()!.equip.find((e) => e.i === 36)?.name ?? ''), { timeout: 10_000 })
    .toMatch(/Torch/);
  await dismissMore(page);
  await waitAtCommand(page);

  await page.keyboard.press('?');
  await expect.poll(() => viewMode(page)).toBe('overlay');
  await expect(page.locator('.termview .tv-close')).toBeVisible();
  const outside = await page.evaluate(() => {
    const map = document.querySelector('#map')!.getBoundingClientRect();
    const corners = [
      [map.left + 3, map.top + 3],
      [map.right - 3, map.top + 3],
      [map.left + 3, map.bottom - 3],
      [map.right - 3, map.bottom - 3],
    ];
    return corners.find(([x, y]) => !document.elementFromPoint(x, y)?.closest('.termview, #hud, #toolbar')) ?? corners[0];
  });
  await page.mouse.click(outside[0], outside[1]);
  await expect.poll(() => viewMode(page)).toBe('map');
});

test('the character sheet keeps its tabs at the foot and shows skills, abilities and the full sheet', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Scholar');

  await page.locator('.hud-player').click();
  await expect(page.locator('.sheet-title')).toHaveText('Scholar');
  await expect(page.locator('.sheet .pop-tab.selected')).toContainText('Summary');
  const size = async () => page.locator('.sheet').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const tabsAt = async () => page.locator('.sheet .pop-tabs').evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await page.waitForTimeout(400);
  const height = await size();
  const tabs = await tabsAt();

  await page.locator('.sheet [data-tab="skills"]').click();
  await expect(page.locator('.sheet .skill-row').first()).toBeVisible();
  await expect(page.locator('.sheet [data-action="raise"]')).toBeVisible();
  expect(await size()).toBe(height);
  expect(await tabsAt()).toBe(tabs);

  await page.locator('.sheet [data-tab="abilities"]').click();
  await expect(page.locator('.sheet .pop-tab.selected')).toContainText('Abilities');
  await expect(page.locator('.sheet .skill-row').first()).toBeVisible();
  await page.locator('.sheet [data-action="learn"]').click();
  /* tome2's question (or refusal) is asked in a small card over the sheet. */
  await expect(page.locator('.sheet.sheet-card')).toBeVisible();
  await page.locator('.sheet.sheet-card .sheet-action').first().click();
  await expect(page.locator('.sheet-title')).toHaveText('Scholar');
  expect(await size()).toBe(height);

  await page.locator('.sheet [data-tab="sheet"]').click();
  await expect(page.locator('.sheet .stat-label', { hasText: 'Fighting' })).toBeVisible();
  await page.locator('.sheet [data-action="page-2"]').click();
  await expect(page.locator('.sheet-subtitle')).toHaveText('Resists');
  expect(await tabsAt()).toBe(tabs);

  await page.locator('.sheet [data-tab="summary"]').click();
  await expect(page.locator('.sheet .stat-grid.six .stat')).toHaveCount(6);
  await waitAtCommand(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();

  /* Typing a character command opens the same sheet on its tab. */
  await page.keyboard.press('G');
  await expect(page.locator('.sheet .pop-tab.selected')).toContainText('Skills');
  await page.locator('.sheet-close').click();
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await waitAtCommand(page);

  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Knowledge' }).click();
  await page.locator('.sheet .row-button', { hasText: 'Quests' }).click();
  await expect(page.locator('.termview .tv-title')).toHaveText(/Quest/);
  await page.locator('.termview .tv-close').click();
  await waitAtCommand(page);
  await expect(page.locator('.sheet-title')).toHaveText('Knowledge');
  await expect(page.locator('.sheet .row-button.is-active')).toContainText('Quests');
  await page.locator('.sheet-back').click();
  await expect(page.locator('.sheet-title')).toHaveText('Menu');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
});

test('skill rows stay put while the cursor moves, and closing after spending saves and returns to the map', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Steady');
  await jumpToLevel(page, 1);
  const points = () => page.evaluate(() => window.__tome!.engine.gameState()?.player?.skillPoints ?? 0);
  for (let i = 0; i < 8 && (await points()) < 2; i++) {
    await page.evaluate(() => window.__tome!.sendText('\u0001'));
    await waitForScreen(page, /Debug Command|\[y\/n\]/);
    if (/\[y\/n\]/.test((await screenText(page)).split('\n')[0])) await page.evaluate(() => window.__tome!.sendText('y'));
    await waitForScreen(page, /Debug Command/);
    await page.evaluate(() => window.__tome!.sendText('x'));
    await dismissMore(page);
    await waitAtCommand(page);
  }
  expect(await points()).toBeGreaterThan(1);

  await page.keyboard.press('G');
  const rows = page.locator('.sheet .skill-row');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(17);
  for (const n of [4, 12, count - 1, 2]) {
    await rows.nth(n).scrollIntoViewIfNeeded();
    const before = (await rows.nth(n).boundingBox())!.y;
    await rows.nth(n).click();
    await expect(rows.nth(n)).toHaveClass(/current/);
    await expect(rows).toHaveCount(count);
    expect((await rows.nth(n).boundingBox())!.y).toBeCloseTo(before, 0);
  }
  const name = (await rows.nth(2).locator('.skill-name').textContent()) ?? '';
  await expect(page.locator('.sheet .skill-detail-title')).toHaveText(name);

  const learnable = page.locator('.sheet .skill-row.learnable, .sheet .skill-row.normal').filter({ hasText: '/pt' }).first();
  await learnable.click();
  const before = (await page.locator('.sheet-subtitle').textContent()) ?? '';
  await page.locator('.sheet [data-action="raise"]').click();
  await expect(page.locator('.sheet-subtitle')).not.toHaveText(before);
  await page.locator('.sheet-close').click();
  await expect(page.locator('.prompt-card')).toContainText('Save and use these skill values?');
  await page.locator('.prompt-card .card-button.primary').click();
  await waitAtCommand(page);
  await expect(page.locator('.sheet-layer')).toBeHidden();
  expect(await viewMode(page)).toBe('map');
});

test('spells are cast from the Magic sheet, and recent ones are offered first', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Caster', { race: 'High-Elf', cls: 'Mage' });

  const openMagic = async () => {
    await page.locator('#toolbar [data-action="commands"]').click();
    await page.locator('.sheet .command', { hasText: 'Magic & powers' }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Magic');
  };
  await openMagic();
  await expect(page.locator('.sheet .recent-button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await castUntilAimed(page, 'Manathrust');
  await page.keyboard.press('Escape');
  await dismissMore(page);
  await waitAtCommand(page);

  /* A magic user's buttons keep their places after the changing first one: the last spell, then Cast. */
  const ids = () => page.locator('#toolbar button').evaluateAll((buttons) => buttons.slice(1).map((b) => b.getAttribute('data-action')));
  expect(await ids()).toEqual(['recast', 'cast', 'inventory', 'rest', 'commands', 'menu']);
  await expect(page.locator('#toolbar [data-action="recast"]')).toContainText('Manathrust');
  const mana = () => page.evaluate(() => window.__tome!.engine.gameState()?.player?.csp ?? 0);
  const turn = () => page.evaluate(() => window.__tome!.engine.snapshot()?.turn ?? 0);
  const [before, then] = [await mana(), await turn()];
  await page.locator('#toolbar [data-action="recast"]').click();
  /* Aimed at the nearest foe when one is in sight; otherwise refused, without taking a turn. */
  await expect
    .poll(async () => (await mana()) < before || /No target in sight/.test((await page.locator('#toast').textContent()) ?? ''), { timeout: 20_000 })
    .toBe(true);
  if ((await mana()) === before) expect(await turn()).toBe(then);
  await dismissMore(page);
  await waitAtCommand(page);

  await openMagic();
  await expect(page.locator('.sheet .recent-button')).toHaveText(/Manathrust/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
});

test('race powers are in the Magic sheet, their lettered questions are buttons, and they are offered again', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Stormwing', { race: 'Thunderlord', cls: 'Warrior' });

  const openMagic = async () => {
    await page.locator('#toolbar [data-action="commands"]').click();
    await page.locator('.sheet .command', { hasText: 'Magic & powers' }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Magic');
  };
  /* A power can fail to concentrate; a hero tries again. */
  const aimed = async () => (await screenText(page)).split('\n')[0].startsWith('Direction');
  for (let attempt = 0; attempt < 4 && !(await aimed()); attempt++) {
    await dismissMore(page);
    await waitAtCommand(page);
    await openMagic();
    await page.locator('.sheet .row-button', { hasText: "Thunderlord's Powers" }).click();
    await expect(page.locator('.sheet-layer')).toBeHidden();
    const strike = page.locator('.prompt-card [data-choice="T"]');
    await expect(strike).toHaveText('Thunder strike');
    await strike.click();
    await expect
      .poll(async () => (await aimed()) || (await page.evaluate(() => window.__tome!.engine.snapshot()?.atCommand ?? false)), { timeout: 10_000 })
      .toBe(true);
  }
  await waitForScreen(page, /^Direction/);
  await page.keyboard.press('Escape');
  await dismissMore(page);
  await waitAtCommand(page);

  await openMagic();
  await expect(page.locator('.sheet .recent-button')).toContainText('Thunder strike');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('dragging pans the map without moving, long press describes, sheets open from the HUD', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Looker');
  await equipSuggested(page);

  const start = await playerPos(page);
  const box = (await page.locator('#map').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx - i * 12, cy - i * 8);
  await page.mouse.up();
  expect(await playerPos(page)).toEqual(start);
  await expect(page.locator('#recentre')).toBeVisible();
  await page.locator('#recentre').click();
  await expect(page.locator('#recentre')).toBeHidden();

  const playerCentre = () =>
    page.evaluate(() => {
      const snap = window.__tome!.engine.snapshot()!;
      const p = window.__tome!.mapCellCentre(snap.px, snap.py);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    });
  let point = await playerCentre();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = await playerCentre();
    if (next.x === point.x && next.y === point.y) break;
    point = next;
  }
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator('#look-card')).toContainText('yourself');
  await page.locator('#look-card .look-button', { hasText: '✕' }).click();

  await page.locator('#toolbar [data-action="commands"]').click();
  await page.locator('.sheet .command', { hasText: 'Look' }).click();
  await expect(page.locator('#look-banner')).toBeVisible();
  await page.mouse.click(point.x + 30, point.y);
  await expect(page.locator('#look-card .look-text')).toHaveText(/You see|not explored/);
  await page.locator('#toolbar [data-action="lookdone"]').click();
  await expect(page.locator('#look-banner')).toBeHidden();
  expect(await playerPos(page)).toEqual(start);

  await page.locator('#hud .hud-player').click();
  await expect(page.locator('.sheet-title')).toHaveText('Looker');
  await expect(page.locator('.sheet .stat-grid.six .stat')).toHaveCount(6);
  await page.mouse.click(5, 5);
  await expect(page.locator('.sheet-layer')).toBeHidden();

  await page.locator('#toolbar [data-action="menu"]').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.sheet .row-button.is-active')).toContainText('Messages');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sheet-title')).toHaveText('Messages');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-title')).toHaveText('Menu');
  await expect(page.locator('.sheet .row-button.is-active')).toContainText('Messages');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
  expect(await page.evaluate(() => window.__tome!.travelling())).toBe(false);
});

test('hiding the app autosaves at the command prompt', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Sleeper');

  const exists = () =>
    page.evaluate(() => {
      const engine = window.__tome!.engine;
      try {
        engine.fs!.stat(`${engine.savePath}/2.4/save/Sleeper`);
        return true;
      } catch {
        return false;
      }
    });
  expect(await exists()).toBe(false);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(exists, { timeout: 10_000 }).toBe(true);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  await page.reload();
  await waitForEngine(page);
  await expect(page.locator('#title-screen .title-choice').first()).toContainText('Sleeper');
});

test('explore reveals the level after the suggested weapon and light are equipped', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Scout');
  await jumpToLevel(page, 2);

  await equipSuggested(page);

  const known = () =>
    page.evaluate(() => {
      const snap = window.__tome!.engine.snapshot()!;
      let n = 0;
      for (let i = 0; i < snap.info.length; i++) if (snap.info[i] & 0x11) n++;
      return n;
    });
  const before = await known();
  for (let i = 0; i < 5 && (await known()) <= before; i++) {
    await dismissMore(page);
    await waitAtCommand(page);
    await pressExplore(page);
  }
  expect(await known()).toBeGreaterThan(before);
});

test('a tap that opens a pop-up leaves it open, and a press let go beside a button does nothing', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Tapper');

  /* The click a browser sends after a touch would land on what the tap opened under the finger. */
  for (const selector of ['#toolbar [data-action="menu"]', '#toolbar [data-action="inventory"]', '#hud .hud-player']) {
    await page.locator(selector).tap();
    await expect(page.locator('.sheet-layer')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.locator('.sheet-layer'), selector).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet-layer')).toBeHidden();
  }

  /* A press let go beside the button, over its neighbour, does nothing. */
  const items = (await page.locator('#toolbar [data-action="inventory"]').boundingBox())!;
  await page.mouse.move(items.x + items.width - 2, items.y + items.height / 2);
  await page.mouse.down();
  await page.mouse.move(items.x + items.width + 8, items.y + items.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(page.locator('.sheet-layer')).toBeHidden();
});

test('while exploring, Speed switches the pace without stopping and Stop stops', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Pacer');
  await jumpToLevel(page, 2);
  await equipSuggested(page);

  const travelling = () => page.evaluate(() => window.__tome!.travelling());
  const pace = () => page.evaluate(() => window.__tome!.settings().explorePace);
  let started = false;
  for (let i = 0; i < 8 && !started; i++) {
    await dismissMore(page);
    await waitAtCommand(page);
    const explore = page.locator('#toolbar [data-action="explore"]');
    if (!(await explore.count())) break;
    await explore.tap();
    started = await travelling();
  }
  test.skip(!started, 'exploring stopped at once each time');

  await expect(page.locator('#toolbar button')).toHaveText([/Stop/, /Speed/, /Menu/]);
  const before = await pace();
  await page.locator('#toolbar [data-action="pace"]').tap();
  expect(await pace()).not.toBe(before);
  if (await travelling()) {
    await page.locator('#toolbar [data-action="stop"]').tap();
    expect(await travelling()).toBe(false);
  }
});

test('a tap on unseen ground takes one step towards it', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Torchbearer');
  await jumpToLevel(page, 2);
  await equipSuggested(page);
  await dismissMore(page);
  await waitAtCommand(page);

  const target = await page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const features = tome.engine.features();
    const known = (x: number, y: number) => (snap.info[y * snap.width + x] & 0x11) !== 0;
    const open = (x: number, y: number) => {
      const i = y * snap.width + x;
      return known(x, y) && (features[snap.feat[i]].flags & 1) === 0 && (snap.layer[i] & 0x7f) === 1;
    };
    const onMap = (x: number, y: number) => {
      const p = tome.mapCellCentre(x, y);
      return document.elementFromPoint(p.x, p.y)?.id === 'map';
    };
    const far = Math.max(1, snap.lightRadius) + 3;
    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    for (let y = 0; y < snap.height; y++) {
      for (let x = 0; x < snap.width; x++) {
        const d = Math.max(Math.abs(x - snap.px), Math.abs(y - snap.py));
        if (d < far || d > far + 4 || known(x, y) || !onMap(x, y)) continue;
        /* The neighbour in the tap's direction (as `stepTowards` picks it first) is open floor. */
        const octant = Math.round(Math.atan2(y - snap.py, x - snap.px) / (Math.PI / 4)) * (Math.PI / 4);
        const ahead = open(snap.px + Math.round(Math.cos(octant)), snap.py + Math.round(Math.sin(octant)));
        if (ahead && d < bestScore) {
          bestScore = d;
          best = { x, y };
        }
      }
    }
    return best;
  });
  expect(target, 'no unseen cell on the map to stride towards').not.toBeNull();

  const start = await playerPos(page);
  const point = await page.evaluate(([x, y]) => window.__tome!.mapCellCentre(x, y), [target!.x, target!.y] as const);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 20_000 }).toBe(false);
  const end = await playerPos(page);
  const cause = await page.evaluate(() => window.__tome!.lastStopCause());
  const context = `stopped (${cause || 'never started'}) at ${JSON.stringify(end)} from ${JSON.stringify(start)} towards ${JSON.stringify(target)}\n${await screenText(page)}`;
  await expect(page.locator('#toast'), context).not.toContainText('no way there');
  const distance = (p: { x: number; y: number }) => Math.hypot(p.x - target!.x, p.y - target!.y);
  if (!/monster|hurt/.test(cause)) expect(distance(end), context).toBeLessThan(distance(start));
  expect(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)), context).toBeLessThanOrEqual(1);
});

test('Explore in town never leads to a way down, and the quest level below Bree stays native', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Delver');

  await equipSuggested(page);
  await expect(page.locator('#toolbar [data-action="inventory"]')).toBeVisible();
  const first = async () => (await page.evaluate(() => window.__tome!.actions()))[0];
  const label = () => page.locator('#toolbar button[data-action]').first().textContent();
  for (let i = 0; i < 30 && !/World map/.test((await label()) ?? ''); i++) {
    expect((await page.evaluate(() => window.__tome!.exploreStop()))?.kind).not.toBe('exit');
    await dismissMore(page);
    await waitAtCommand(page);
    const attack = page.locator('#toolbar [data-action="attack"]');
    if (await attack.count()) {
      await attack.click();
      await page.waitForTimeout(300);
      continue;
    }
    if ((await first()) !== 'explore') await stepOffStairs(page);
    await pressExplore(page);
  }
  await expect(page.locator('#toolbar button[data-action]').first()).toContainText('World map');

  /* The way down is the player's to find: travel to it, and its button takes it. */
  const stairs = await page.evaluate(() => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const names = tome.engine.features().map((f) => f.name.toLowerCase());
    const i = snap.feat.findIndex((f, n) => /down staircase|quest down/.test(names[f] ?? '') && (snap.info[n] & 0x11) !== 0);
    return i < 0 ? null : { x: i % snap.width, y: Math.floor(i / snap.width) };
  });
  expect(stairs).not.toBeNull();
  for (let i = 0; i < 12; i++) {
    const here = await playerPos(page);
    if (here.x === stairs!.x && here.y === stairs!.y) break;
    await page.evaluate(() => window.__tome!.sendText('\u0001z'));
    await dismissMore(page);
    await waitAtCommand(page);
    await page.evaluate(({ x, y }) => window.__tome!.tapCell(x, y), stairs!);
    await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
  }
  await waitAtCommand(page);
  await expect(page.locator('#toolbar [data-action="descend"]')).toBeVisible();

  const depthBefore = await page.evaluate(() => window.__tome!.engine.snapshot()!.depth);
  await page.locator('#toolbar [data-action="descend"]').click();
  await expect.poll(() => page.evaluate(() => window.__tome!.engine.snapshot()!.depth), { timeout: 30_000 }).toBeGreaterThan(depthBefore);
  await waitAtCommand(page);
  expect(await viewMode(page)).toBe('map');
  await expect(page.locator('.termview')).toBeHidden();
  expect((await screenText(page)).split('\n')[0]).not.toMatch(/-more-/);
  expect(await page.evaluate(() => window.__tome!.engine.gameState()!.messages!.length)).toBeGreaterThan(0);
});

test('knowledge and the manual read as whole files, help is searchable, links open more, and cards float over the list that opened them', async ({ page }) => {
  await page.goto('./?wizard');
  await waitForEngine(page);
  await createCharacter(page, 'Reader', { cls: 'Mage' });
  const rowZero = () => page.evaluate(() => window.__tome!.screenText().split('\n')[0]);

  /* A knowledge list is one scrolling list, with nothing to page. */
  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Knowledge' }).click();
  await page.locator('.sheet .row-button', { hasText: 'Unique' }).click();
  await expect(page.locator('.termview .tv-title')).toHaveText('Known Uniques');
  const size = Number(/Line \d+\/(\d+)\]/.exec(await rowZero())?.[1]);
  expect(size).toBeGreaterThan(40);
  await expect(page.locator('.termview .tv-text')).toHaveCount(size);
  await expect(page.locator('.termview .tv-footer')).toBeHidden();
  await page.locator('.termview .tv-close').click();
  await waitAtCommand(page);
  await expect(page.locator('.sheet .row-button.is-active')).toContainText('Unique');
  await page.locator('.sheet .sheet-close').click();
  await expect(page.locator('.sheet-layer')).toBeHidden();

  /* Help: a search, a topic, its related topics, and back with the search kept. */
  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Help' }).click();
  await expect(page.locator('.sheet-title')).toHaveText('Help');
  await page.locator('.help-search').fill('torch');
  await page.locator('.sheet .row-button', { hasText: 'Light and darkness' }).click();
  await expect(page.locator('.sheet-title')).toHaveText('Light and darkness');
  await page.locator('.help-topic .row-button', { hasText: 'Explore and travel' }).click();
  await expect(page.locator('.sheet-title')).toHaveText('Explore and travel');
  await page.locator('.sheet-back').click();
  await page.locator('.sheet-back').click();
  await expect(page.locator('.sheet-title')).toHaveText('Help');
  await expect(page.locator('.help-search')).toHaveValue('torch');

  /* The original manual: a lettered link, a link inside the text, back to where the index was left, and out to Help. */
  await page.locator('.help-search').fill('manual');
  await page.locator('.sheet .row-button', { hasText: 'The original ToME manual' }).click();
  await page.locator('.sheet .sheet-action', { hasText: 'Open the manual' }).click();
  await page.locator('.termview .tv-choice', { hasText: 'Alphabetical index' }).click();
  await expect.poll(rowZero).toMatch(/index\.txt/);
  const link = page.locator('.termview .tv-link', { hasText: /^Abilities$/ }).first();
  await link.scrollIntoViewIfNeeded();
  const scrolled = await page.locator('.termview .tv-body').evaluate((b) => b.scrollTop);
  await link.click();
  await expect.poll(rowZero).toMatch(/ability\.txt/);
  await expect(page.locator('.termview .tv-back')).toBeVisible();
  await page.locator('.termview .tv-back').click();
  await expect.poll(rowZero).toMatch(/index\.txt/);
  await expect.poll(() => page.locator('.termview .tv-body').evaluate((b) => b.scrollTop)).toBe(scrolled);
  await page.locator('.termview .tv-close').click();
  await waitAtCommand(page);
  await expect(page.locator('.sheet-title')).toHaveText('The original ToME manual');
  await page.locator('.sheet .sheet-close').click();
  await expect(page.locator('.sheet-layer')).toBeHidden();

  /* The ? key opens Help rather than tome2's help screens. */
  await page.keyboard.press('?');
  await expect(page.locator('.sheet-title')).toHaveText('Help');
  await waitAtCommand(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();

  /* An item's card floats over the inventory; closing it, or tapping outside it, returns to the list. */
  await page.locator('#toolbar [data-action="inventory"]').click();
  const panelHeight = await page.locator('.sheet.sheet-panel').evaluate((n) => n.getBoundingClientRect().height);
  await page.locator('.sheet .item-row').nth(1).click();
  const card = page.locator('.sheet-frame.frame-card .sheet-card');
  await expect(card).toBeVisible();
  expect(await card.evaluate((n) => n.getBoundingClientRect().height)).toBeLessThan(panelHeight - 50);
  await expect(page.locator('.sheet.sheet-panel .sheet-title')).toHaveText('Inventory');
  await card.locator('.sheet-close').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.sheet .item-row.is-active')).toHaveCount(1);
  await page.locator('.sheet .item-row').nth(1).click();
  await page.locator('.sheet-frame.frame-card .sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(card).toHaveCount(0);
  await expect(page.locator('.sheet.sheet-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
});
