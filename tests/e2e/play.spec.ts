import { expect, test, type Page } from '@playwright/test';
import {
  createCharacter,
  dismissMore,
  playerPos,
  screenText,
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
    await expect(page.locator('#toast'), context).toContainText(/creature|hurt|blocked/);
  }
  expect(after, context).toBeLessThan(before);
});

test('items are used, wielded and taken off from the native inventory', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Packer');

  await expect.poll(() => actionIds(page)).toEqual(expect.arrayContaining(['inventory', 'rest', 'look', 'commands', 'menu']));

  const food = await packCount(page, /Ration/);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await expect(page.locator('.sheet .item-row').first()).toBeVisible();
  await page.locator('.sheet .item-row', { hasText: 'Ration' }).click();
  await page.locator('.sheet .action-button', { hasText: 'Eat' }).click();
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await expect.poll(() => packCount(page, /Ration/), { timeout: 10_000 }).toBe(food - 1);
  expect(await viewMode(page)).toBe('map');

  await dismissMore(page);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await page.locator('.sheet .item-row', { hasText: /Sword|Dagger|Axe|Mace|Spear|Whip/ }).first().click();
  await page.locator('.sheet .action-button', { hasText: 'Wield' }).click();
  const weapon = () => page.evaluate(() => window.__tome!.engine.inventory()!.equip.find((e) => e.i === 24)?.name ?? '');
  await expect.poll(weapon, { timeout: 10_000 }).not.toBe('');

  await dismissMore(page);
  await page.locator('#toolbar [data-action="inventory"]').click();
  await page.locator('.sheet .segment', { hasText: 'Equipment' }).click();
  await page.locator('.sheet .item-row:not(.empty-slot)').first().click();
  await page.locator('.sheet .action-button', { hasText: 'Take off' }).click();
  await expect.poll(weapon, { timeout: 10_000 }).toBe('');
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
  await expect(page.locator('#messages')).toContainText('light source', { timeout: 10_000 });
  await dismissMore(page);
  await waitAtCommand(page);

  await page.keyboard.press('C');
  await expect.poll(() => viewMode(page)).toBe('overlay');
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

test('abilities, the full sheet and knowledge are native views', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Scholar');

  await page.locator('.hud-player').click();
  await page.locator('.sheet .action-button', { hasText: 'Abilities' }).click();
  await expect(page.locator('.termview .tv-title')).toHaveText('Abilities');
  await expect(page.locator('.termview .skill-row').first()).toBeVisible();
  await page.locator('#toolbar [data-action="learn"]').click();
  await expect(page.locator('.prompt-card')).toBeVisible();
  await page.locator('.prompt-card button').first().click();
  await page.locator('#toolbar [data-action="done"]').click();
  await waitAtCommand(page);

  await page.locator('.hud-player').click();
  await page.locator('.sheet .action-button', { hasText: 'Full character sheet' }).click();
  await expect(page.locator('.termview .tv-title')).toHaveText('Character sheet');
  await expect(page.locator('.termview .stat-label', { hasText: 'Fighting' })).toBeVisible();
  await page.locator('.termview .tv-tab', { hasText: 'Resists' }).click();
  await expect(page.locator('.termview .tv-tab.selected')).toHaveText('Resists');
  await page.locator('#toolbar [data-action="done"]').click();
  await waitAtCommand(page);

  await page.locator('.hud-player').click();
  await page.locator('.sheet .action-button', { hasText: 'Knowledge' }).click();
  await page.locator('.sheet .row-button', { hasText: 'Quests' }).click();
  await expect(page.locator('.termview .tv-title')).toHaveText(/Quest/);
  await page.locator('#toolbar [data-action="done"]').click();
  await waitAtCommand(page);
});

test('dragging pans the map without moving, long press describes, sheets open from the HUD', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Looker');

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

  await page.locator('#toolbar [data-action="look"]').click();
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
