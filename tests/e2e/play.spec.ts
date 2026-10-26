import { expect, test, type Page } from '@playwright/test';
import { createCharacter, screenText, sendText, viewMode, waitForEngine, waitForScreen } from './helpers.ts';

async function actionIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__tome!.actions());
}

async function playerPos(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const snap = window.__tome!.engine.snapshot()!;
    return { x: snap.px, y: snap.py };
  });
}

async function waitAtCommand(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__tome!.engine.snapshot()?.atCommand ?? false), { timeout: 15_000 })
    .toBe(true);
}

test('tapping the map travels there along a known path', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Walker');
  await waitAtCommand(page);

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
  const point = await page.evaluate(([x, y]) => window.__tome!.mapCellCentre(x, y), [target!.x, target!.y] as const);
  await page.mouse.click(point.x, point.y);

  await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 20_000 }).toBe(false);
  const end = await playerPos(page);
  const before = Math.max(Math.abs(start.x - target!.x), Math.abs(start.y - target!.y));
  const after = Math.max(Math.abs(end.x - target!.x), Math.abs(end.y - target!.y));
  if (after > 0) {
    const diag = await page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return { cause: window.__tome!.lastStopCause(), hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : 'none', screen: window.__tome!.screenText() };
    }, [point.x, point.y] as const);
    const context = `stopped (${diag.cause || 'never started'}) at ${JSON.stringify(end)} from ${JSON.stringify(start)} towards ${JSON.stringify(target)}; tap hit ${diag.hit}\n${diag.screen}`;
    await expect(page.locator('#toast'), context).toContainText(/creature|hurt|blocked/);
  }
  expect(after).toBeLessThan(before);
});

test('the action bar follows the game and menus can be tapped', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Tapper');
  await waitAtCommand(page);

  await expect.poll(() => actionIds(page)).toEqual(expect.arrayContaining(['inventory', 'rest', 'look', 'commands', 'menu']));
  const overflow = await page.evaluate(() => {
    const bar = document.getElementById('toolbar')!;
    return { horizontal: bar.scrollWidth - bar.clientWidth, vertical: bar.scrollHeight - bar.clientHeight };
  });
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.vertical).toBeLessThanOrEqual(1);

  await page.locator('#toolbar [data-action="inventory"]').click();
  await expect.poll(() => viewMode(page)).toBe('overlay');
  await expect.poll(() => actionIds(page)).toContain('escape');
  await page.locator('#toolbar [data-action="escape"]').click();
  await expect.poll(() => viewMode(page)).toBe('map');

  await page.locator('#toolbar [data-action="commands"]').click();
  await expect(page.locator('#commands')).toBeVisible();
  await page.locator('#commands .command', { hasText: 'Wear / wield' }).click();
  await expect(page.locator('#commands')).toBeHidden();
  await waitForScreen(page, /Wear\/Wield which item/);
  if ((await viewMode(page)) !== 'overlay') await sendText(page, ' ');
  await expect.poll(() => viewMode(page)).toBe('overlay');

  const row = (await screenText(page)).split('\n').findIndex((line) => line.includes('Torch'));
  expect(row).toBeGreaterThan(0);
  const point = await page.evaluate((r) => window.__tome!.terminalCellCentre(20, r), row);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#messages')).toContainText('light source', { timeout: 10_000 });

  await waitAtCommand(page);
  await page.locator('#toolbar [data-action="menu"]').focus();
  await page.keyboard.press('i');
  await expect.poll(() => viewMode(page)).toBe('overlay');
  await page.keyboard.press('Escape');
  await expect.poll(() => viewMode(page)).toBe('map');

  await page.locator('#messages .msg').first().click();
  await expect(page.locator('#info')).toContainText('Message history');
  await page.keyboard.press('Escape');
  await expect(page.locator('#info')).toBeHidden();
  expect(await page.evaluate(() => window.__tome!.travelling())).toBe(false);
});

test('hiding the app autosaves at the command prompt', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Sleeper');
  await waitAtCommand(page);

  const savePath = await page.evaluate(() => `${window.__tome!.engine.savePath}/2.4/save/Sleeper`);
  const exists = () =>
    page.evaluate((p) => {
      try {
        window.__tome!.engine.fs!.stat(p);
        return true;
      } catch {
        return false;
      }
    }, savePath);
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
  await waitForScreen(page, /Sleeper/);
});
