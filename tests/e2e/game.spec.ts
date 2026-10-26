import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  createCharacter,
  findPlayer,
  isOnMap,
  screenText,
  sendText,
  swipe,
  waitForEngine,
  waitForScreen,
  waitForSettle,
} from './helpers.ts';

test('loads the engine and lays out the screen without overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');
  await waitForEngine(page);
  await waitForScreen(page, /New Character/);

  const layout = await page.evaluate(() => {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const toolbar = document.getElementById('toolbar') as HTMLElement;
    const canvasRect = canvas.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      overlap:
        canvasRect.right > toolbarRect.left + 1 && canvasRect.bottom > toolbarRect.top + 1 &&
        canvasRect.left < toolbarRect.right && canvasRect.top < toolbarRect.bottom,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(layout.canvasWidth).toBeGreaterThan(0);
  expect(layout.canvasHeight).toBeGreaterThan(0);
  expect(layout.overlap).toBe(false);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(await page.locator('#toolbar .action').count()).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('creates a character, walks by swipe, saves, and reloads the save', async ({ page }, testInfo) => {
  const savefile = `T${testInfo.project.name.replace(/[^a-z]/gi, '').slice(0, 10)}`;

  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, savefile);

  let text = await screenText(page);
  const start = findPlayer(text);
  expect(start).not.toBeNull();

  const lines = text.split('\n');
  const at = (x: number, y: number) => lines[y]?.[x] ?? ' ';
  const options: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const [ddx, ddy] = options.find(([dx, dy]) => at(start!.x + dx, start!.y + dy) === '.') ?? [-1, 0];

  await swipe(page, ddx * 80, ddy * 80);
  text = await waitForSettle(page, text);
  const moved = findPlayer(text);
  expect(moved, `player missing after swipe:\n${text}`).not.toBeNull();
  expect(moved).not.toEqual(start);

  await sendText(page, '\u0013');
  await waitForScreen(page, /Saving game|Game saved|done/i, 15_000).catch(() => undefined);
  await page.evaluate(() => window.__tome?.engine.syncNow());

  await page.reload();
  await waitForEngine(page);
  text = await waitForScreen(page, new RegExp(savefile));

  const entry = new RegExp(`(?:\\[|\\b)([a-z])[\\])] ${savefile}`).exec(text);
  expect(entry, `save ${savefile} not listed:\n${text}`).not.toBeNull();
  await sendText(page, entry![1]);
  text = await waitForSettle(page, text);
  if (!isOnMap(text)) {
    await sendText(page, '\r');
    text = await waitForSettle(page, text);
  }
  await expect.poll(async () => isOnMap(await screenText(page)), { timeout: 30_000 }).toBe(true);
});

test('exports saves as a downloadable bundle', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.evaluate(() => {
    const engine = window.__tome!.engine;
    const fs = engine.fs!;
    fs.mkdirTree(`${engine.savePath}/2.4/save`);
    fs.writeFile(`${engine.savePath}/2.4/save/Exported`, new Uint8Array([1, 2, 3]));
  });

  await page.locator('[data-action="menu"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-menu="export"]').click();
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

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-action="menu"]').click();
  const reloaded = page.waitForEvent('load');
  await page.locator('#import-file').setInputFiles({
    name: 'backup.tome2save',
    mimeType: 'application/json',
    buffer: Buffer.from(bundle),
  });
  await reloaded;
  await waitForEngine(page);

  const data = await page.evaluate(() => {
    const engine = window.__tome!.engine;
    return Array.from(engine.fs!.readFile(`${engine.savePath}/2.4/save/Imported`));
  });
  expect(data).toEqual([4, 5, 6]);
});
