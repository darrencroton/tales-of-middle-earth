import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { beginNewCharacter, createCharacter, inDungeon, screenText, sendText, waitAtCommand, waitForEngine, waitForScreen } from './helpers.ts';

test('loads the engine and lays out the opening screen without overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');
  await waitForEngine(page);

  const layout = await page.evaluate(() => {
    const choice = document.querySelector('#title-screen .title-choice')!.getBoundingClientRect();
    return {
      choiceInside: choice.left >= 0 && choice.right <= window.innerWidth && choice.bottom <= window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(layout.choiceInside).toBe(true);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  await expect(page.locator('#title-screen .title-choice').first()).toHaveText(/Enter Middle-earth/i);
  expect(errors).toEqual([]);
});

test('creates a character, saves and quits to the title, then continues', async ({ page }, testInfo) => {
  const name = `T${testInfo.project.name.replace(/[^a-z]/gi, '').slice(0, 10)}`;
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, name);

  const layout = await page.evaluate(() => {
    const stage = document.getElementById('stage')!.getBoundingClientRect();
    const toolbar = document.getElementById('toolbar')!;
    return {
      stageArea: stage.width * stage.height,
      viewportArea: window.innerWidth * window.innerHeight,
      toolbarOverflow: Math.max(toolbar.scrollWidth - toolbar.clientWidth, toolbar.scrollHeight - toolbar.clientHeight),
      toolbarRight: toolbar.getBoundingClientRect().right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(layout.stageArea / layout.viewportArea).toBeGreaterThan(0.35);
  expect(layout.toolbarOverflow).toBeLessThanOrEqual(1);
  expect(layout.toolbarRight).toBeLessThanOrEqual(layout.viewportWidth + 0.5);

  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Save and quit' }).click();
  const reloaded = page.waitForEvent('load');
  await page.locator('.sheet-action.primary', { hasText: 'Save and quit' }).click();
  await reloaded;
  await waitForEngine(page);

  const resume = page.locator('#title-screen .title-choice').first();
  await expect(resume).toContainText('Continue');
  await expect(resume).toContainText(name);
  await resume.click();
  await expect.poll(() => inDungeon(page), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });
  await waitAtCommand(page);
  await expect(page.locator('#hud .hud-player .name')).toHaveText(name);
  expect(errors).toEqual([]);
});

test('exports saves from the title screen as a downloadable bundle', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.evaluate(() => {
    const engine = window.__tome!.engine;
    const fs = engine.fs!;
    fs.mkdirTree(`${engine.savePath}/2.4/save`);
    fs.writeFile(`${engine.savePath}/2.4/save/Exported`, new Uint8Array([1, 2, 3]));
  });

  await page.locator('#title-screen [data-link="saves"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.sheet .row-button', { hasText: 'Export saves' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^tome2-saves-.*\.tome2save$/);
  const bundle = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(bundle.format).toBe('tome2mobile-saves');
  expect(bundle.files.map((f: { path: string }) => f.path)).toContain('2.4/save/Exported');
});

test('imports a save bundle and keeps it after the restart', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);

  const bundle = JSON.stringify({
    format: 'tome2mobile-saves',
    version: 1,
    exported: new Date().toISOString(),
    files: [{ path: '2.4/save/Imported', data: Buffer.from([4, 5, 6]).toString('base64') }],
  });

  await page.locator('#import-file').setInputFiles({
    name: 'backup.tome2save',
    mimeType: 'application/json',
    buffer: Buffer.from(bundle),
  });
  const reloaded = page.waitForEvent('load');
  await page.locator('.sheet-action', { hasText: 'Import' }).click();
  await reloaded;
  await waitForEngine(page);

  const data = await page.evaluate(() => {
    const engine = window.__tome!.engine;
    return Array.from(engine.fs!.readFile(`${engine.savePath}/2.4/save/Imported`));
  });
  expect(data).toEqual([4, 5, 6]);
});

test.describe('iOS home-screen app', () => {
  test.use({ viewport: { width: 402, height: 812 }, contextOptions: { screen: { width: 402, height: 874 } } });

  const safeBottom = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim());
  const insets = async (page: Page) => {
    await page.addStyleTag({ content: ':root { --safe-top: 62px; --safe-bottom: 34px; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  };

  test('drops the bottom inset when the view ends a status bar short of the screen', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
    await page.goto('./');
    await waitForEngine(page);
    await insets(page);
    expect(await safeBottom(page)).toBe('0px');
    expect(await page.evaluate(() => document.getElementById('app')!.getBoundingClientRect().bottom)).toBe(812);
  });

  test('keeps the bottom inset in the browser', async ({ page }) => {
    await page.goto('./');
    await waitForEngine(page);
    await insets(page);
    expect(await safeBottom(page)).toBe('34px');
  });
});

test('a new hero can take the name of one who has fallen', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Fallen');

  await sendText(page, '\\Q');
  await waitForScreen(page, /really want to quit/);
  await sendText(page, 'y');
  await waitForScreen(page, /verify QUITTING/);
  const reloaded = page.waitForEvent('load', { timeout: 120_000 });
  await sendText(page, '@');
  const finish = page.locator('#toolbar [data-action="finish"]');
  for (let i = 0; i < 40 && !(await finish.isVisible()); i++) {
    const text = await screenText(page);
    if (/-more-/.test(text.split('\n')[0] ?? '')) await sendText(page, '\u001b');
    await page.waitForTimeout(500);
  }
  await finish.click();
  await reloaded;
  await waitForEngine(page);
  await expect(page.locator('#title-screen .title-choice').first()).not.toContainText('Continue');

  await beginNewCharacter(page, 'Fallen');
  await page.waitForTimeout(400);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.director.birth')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.director .birth-summary')).toContainText('Fallen');
});

/** Writes a scores file with two fallen heroes over the one tome2 keeps in browser storage. */
async function seedScores(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fs = window.__tome!.engine.fs!;
    const find = (dir: string, depth: number): string | null => {
      if (depth > 4) return null;
      for (const name of fs.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const path = `${dir}/${name}`;
        if (name === 'scores.raw') return path;
        if (fs.isDir(fs.stat(path).mode)) {
          const found = find(path, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    const path = find(window.__tome!.engine.savePath!, 0);
    if (!path) throw new Error('No scores file');
    const fields: [string, number][] = [['what', 8], ['pts', 10], ['gold', 10], ['turns', 10], ['day', 10], ['who', 16], ['', 8], ['pr', 3], ['ps', 3], ['pc', 3], ['pcs', 3], ['lev', 4], ['dun', 4], ['maxLev', 4], ['maxDun', 4], ['', 4], ['', 4], ['quest', 4], ['', 4], ['how', 32]];
    const heroes: Record<string, string>[] = [
      { what: '2.4.0', pts: '     2210', gold: '      420', turns: '   120400', day: '10/25/26', who: 'Bilbo', pr: ' 0', ps: ' 0', pc: ' 0', pcs: ' 0', lev: '  7', dun: '  3', maxLev: '  8', maxDun: '  3', quest: '  0', how: 'a Cave spider' },
      { what: '2.4.0', pts: '      310', gold: '      100', turns: '    20400', day: '10/27/26', who: 'Grodon', pr: ' 0', ps: ' 0', pc: ' 0', pcs: ' 0', lev: '  2', dun: '  0', maxLev: '  2', maxDun: '  0', quest: '  0', how: 'Grip, Farmer Maggot\'s Dog' },
    ];
    const bytes = new Uint8Array(148 * heroes.length);
    heroes.forEach((hero, i) => {
      let at = i * 148;
      for (const [key, size] of fields) {
        const text = (hero[key] ?? '').slice(0, size - 1);
        for (let c = 0; c < text.length; c++) bytes[at + c] = text.charCodeAt(c);
        at += size;
      }
    });
    fs.writeFile(path, bytes);
  });
}

test('the Hall of Fame follows the end of an adventure and stays on the title screen', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Retiree');
  await seedScores(page);

  await sendText(page, '\\Q');
  await waitForScreen(page, /really want to quit/);
  await sendText(page, 'y');
  await waitForScreen(page, /verify QUITTING/);
  await sendText(page, '@');
  const finish = page.locator('#toolbar [data-action="finish"]');
  await expect(finish).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.termview')).toContainText('Your adventure has ended');
  await finish.click();

  await expect(page.locator('.termview')).toContainText('Hall of Fame');
  await expect(page.locator('.termview .fame-row')).toHaveCount(2);
  await expect(page.locator('.termview .fame-row').first()).toContainText('Killed by a Cave spider at 150 ft');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.termview .fame-row').nth(1)).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.termview .fame-row').nth(1).locator('.fame-details')).toBeVisible();
  await expect(page.locator('.termview')).toContainText('Hall of Fame');
  const reloaded = page.waitForEvent('load', { timeout: 120_000 });
  await page.keyboard.press('Escape');
  await reloaded;
  await waitForEngine(page);

  await page.locator('#title-screen [data-link="fame"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Hall of Fame');
  await expect(page.locator('.sheet .fame-row')).toHaveCount(2);
  await expect(page.locator('.sheet .fame-row').nth(1)).toContainText("Killed by Grip, Farmer Maggot's Dog in the town");
});

test('the name prompt sits at the top of the screen, clear of the keyboard', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.locator('#title-screen .title-choice', { hasText: /Enter Middle-earth|New character/i }).click();
  const input = page.locator('.ask-text input');
  await expect(input).toBeFocused();
  const box = await page.locator('.sheet.sheet-ask').boundingBox();
  const height = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThan(height * 0.4);
});

test('the world map is entered from the commands and left from the toolbar', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Rover');
  const wild = () => page.evaluate(() => window.__tome!.engine.snapshot()!.wild);
  await page.locator('#toolbar [data-action="commands"]').click();
  await expect(page.locator('.sheet .command', { hasText: 'Go up' })).toHaveCount(0);
  await page.locator('.sheet .command', { hasText: 'World map' }).click();
  await expect.poll(wild).toBe(true);
  await expect(page.locator('#toolbar [data-action="walkhere"]')).toBeVisible();
  await expect(page.locator('#toolbar [data-action="explore"]')).toHaveCount(0);
  await page.locator('#toolbar [data-action="walkhere"]').click();
  await expect.poll(wild).toBe(false);
  await expect(page.locator('#toolbar [data-action="dungeon"]')).toBeVisible();
});
