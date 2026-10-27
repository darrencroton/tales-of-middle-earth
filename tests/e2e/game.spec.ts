import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createCharacter, inDungeon, waitAtCommand, waitForEngine } from './helpers.ts';

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
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 10_000 });
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
