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
  await page.locator('.sheet-action.primary', { hasText: 'Save and quit' }).click();
  await expect(page.locator('#title-screen')).toBeVisible({ timeout: 60_000 });
  await waitForEngine(page);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);

  const resume = page.locator('#title-screen .title-choice').first();
  await expect(resume).toContainText(`Continue as ${name}`);
  await expect(resume.locator('.title-choice-detail')).toContainText(/^Level 1 \S+ \S+ · \S/);
  await resume.click();
  await expect.poll(() => inDungeon(page), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });
  await waitAtCommand(page);
  await expect(page.locator('#hud .hud-player .name')).toHaveText(name);
  expect(errors).toEqual([]);
});

test('the run is set up under the hero on the last creation screen, and the game begins with it', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Planner', {
    beforeBegin: async () => {
      const card = page.locator('.birth-card.run');
      await expect(card).toBeVisible();
      await expect(card.locator('.segment.selected')).toHaveText('20');
      expect((await page.evaluate(() => window.__tome!.engine.runOptions()))?.drawn).toBeGreaterThan(10);
      const small = card.locator('.run-option', { hasText: 'Small levels' });
      await expect(small).toHaveAttribute('aria-checked', 'false');
      await small.click();
      await expect(small).toHaveAttribute('aria-checked', 'true');
      await card.locator('.segment', { hasText: /^10$/ }).click();
      await expect(card.locator('.segment.selected')).toHaveText('10');

      /* Unusual rooms leave no random quests; turning them off brings the chosen number back. */
      const unusual = card.locator('.run-option', { hasText: 'Unusual rooms' });
      await unusual.click();
      await expect(card.locator('.segmented')).toHaveCount(0);
      expect((await page.evaluate(() => window.__tome!.engine.runOptions()))?.drawn).toBe(0);
      await unusual.click();
      await expect(card.locator('.segment.selected')).toHaveText('10');

      /* Arrows move through the run rather than beginning the game. */
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.director .is-active')).toHaveCount(1);
      expect(await inDungeon(page)).toBe(false);
    },
  });
  const run = await page.evaluate(() => window.__tome!.engine.runOptions());
  /* tome2 skips a level where it finds no creature to hunt. */
  expect(run?.drawn).toBeGreaterThan(5);
  expect(run?.drawn).toBeLessThanOrEqual(10);
  expect(run?.options.find((o) => o.name === 'smallLevels')?.on).toBe(1);
  expect(run?.options.find((o) => o.name === 'unusualRooms')?.on).toBe(0);
  /* Once the game has begun the run is fixed, and Settings shows it read-only. */
  expect(await page.evaluate(() => window.__tome!.engine.setRandomQuests(5))).toBe(false);
  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Settings' }).click();
  const rules = page.locator('.adventure-rules');
  await expect(rules).toContainText('Chosen when Planner was created');
  await expect(rules.locator('.segment.selected')).toHaveText(String(run?.drawn));
  await expect(rules.locator('.segment:not([disabled])')).toHaveCount(0);
  const small = rules.locator('.run-option', { hasText: 'Small levels' });
  await expect(small).toHaveAttribute('aria-checked', 'true');
  await expect(small).toBeDisabled();
  await small.click({ force: true });
  expect((await page.evaluate(() => window.__tome!.engine.runOptions()))?.options.find((o) => o.name === 'smallLevels')?.on).toBe(1);
});

test('help opens from the title screen, with races and classes from the game itself', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.locator('#title-screen [data-link="help"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Help');
  await expect(page.locator('.sheet .row-button', { hasText: 'The original ToME manual' })).toHaveCount(0);

  /* Searching keeps the first result highlighted: the arrows move from it, and Enter in the field opens it. */
  await page.locator('.help-search').fill('stairs');
  await expect(page.locator('.sheet .row-button.is-active')).toContainText('Stairs and levels');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.sheet .row-button.is-active')).toContainText('Stairs and levels');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.sheet .row-button.is-active')).not.toContainText('Stairs and levels');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.help-search')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sheet-title')).toHaveText('Stairs and levels');
  await page.keyboard.press('Escape');
  await page.locator('.help-search').fill('');
  await page.locator('.sheet .row-button', { hasText: 'Races and classes' }).click();
  const mods = page.locator('.help-topic .sheet-section', { hasText: 'Race modifiers' }).locator('.row-button');
  await expect(mods.first()).toHaveText('Classical');
  await expect(mods.filter({ hasText: /^(x+|\s*)$/ })).toHaveCount(0);
  await page.locator('.help-topic .row-button', { hasText: /^Hobbit$/ }).click();
  const card = page.locator('.sheet-frame.frame-card .birth-card');
  await expect(card.first().locator('h3')).toHaveText('Hobbit');
  await expect(card.first().locator('.birth-stat')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-title')).toHaveText('Races and classes');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
});

test('exports game data from the title screen as a downloadable bundle', async ({ page }) => {
  await page.goto('./');
  await waitForEngine(page);
  await page.evaluate(() => {
    const engine = window.__tome!.engine;
    const fs = engine.fs!;
    fs.mkdirTree(`${engine.savePath}/2.4/save`);
    fs.writeFile(`${engine.savePath}/2.4/save/Exported`, new Uint8Array([1, 2, 3]));
  });

  await page.locator('#title-screen [data-link="backup"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.sheet .row-button', { hasText: 'Export game data' }).click();
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
  await sendText(page, '@');
  const finish = page.locator('#toolbar [data-action="finish"]');
  for (let i = 0; i < 40 && !(await finish.isVisible()); i++) {
    const text = await screenText(page);
    if (/-more-/.test(text.split('\n')[0] ?? '')) await sendText(page, '\u001b');
    await page.waitForTimeout(500);
  }
  await finish.click();
  /* The quit is kept in the Hall of Fame; past it, the title returns in the same page, with a fresh engine. */
  await expect(page.locator('.termview .fame-row')).toContainText('Abandoned in the town');
  await page.keyboard.press('Escape');
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
  await expect(page.locator('.termview')).toContainText('Your tale');
  await expect(page.locator('.termview .tale-tip')).toContainText('Next time');
  await expect(page.locator('#hud')).toBeHidden();
  await page.locator('#toolbar [data-action="fallen"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Retiree');
  await page.locator('.sheet [data-tab="gear"]').click();
  await expect(page.locator('.sheet .sheet-section h3').first()).toHaveText('Equipment');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await finish.click();

  await expect(page.locator('.termview')).toContainText('Hall of Fame');
  await expect(page.locator('.termview .fame-row')).toHaveCount(3);
  await expect(page.locator('.termview .fame-row').first()).toContainText('Killed by a Cave spider at 150 ft');
  await expect(page.locator('.termview .fame-row').nth(2)).toHaveClass(/current/);
  await expect(page.locator('.termview .fame-row').nth(2)).toContainText('Abandoned in the town');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.termview .fame-row').nth(1)).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.sheet-title')).toHaveText('Grodon');
  await expect(page.locator('.sheet-fame-hero .hero-facts')).toContainText("Killed by Grip, Farmer Maggot's Dog in the town");
  await expect(page.locator('.sheet-fame-hero .sheet-action')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-layer')).toBeHidden();
  await expect(page.locator('.termview')).toContainText('Hall of Fame');
  await page.keyboard.press('Escape');
  await waitForEngine(page);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);

  await page.locator('#title-screen [data-link="fame"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Hall of Fame');
  await expect(page.locator('.sheet .fame-row')).toHaveCount(3);
  await expect(page.locator('.sheet .fame-row').nth(1)).toContainText("Killed by Grip, Farmer Maggot's Dog in the town");
  await expect(page.locator('.sheet')).toContainText('Career');
  await expect(page.locator('.sheet .deed')).toHaveCount(15);
  await expect(page.locator('.sheet .stat', { hasText: 'Fallen' })).toContainText('0');
  await page.locator('.sheet .fame-row').first().click();
  await expect(page.locator('.sheet-fame-hero .sheet-title')).toHaveText('Bilbo');
  await expect(page.locator('.sheet-fame-hero .sheet-action')).toHaveText(['Remove']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-title')).toHaveText('Hall of Fame');
  await page.locator('.sheet .fame-row').first().click();
  await page.locator('.sheet-fame-hero [data-action="remove"]').click();
  await page.locator('.sheet', { hasText: 'Remove Bilbo?' }).locator('.sheet-action.danger').click();
  await expect(page.locator('#toast')).toHaveText('Bilbo was removed from the Hall of Fame.', { timeout: 15_000 });
  await expect(page.locator('.sheet .fame-row')).toHaveCount(2);
  await expect(page.locator('.sheet .fame-row').first()).toContainText('Grodon');
});

test('a hero whose adventure ended can be looked back on and begun anew from the Hall of Fame, as a new run', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Anew');
  const stats = await page.evaluate(() => window.__tome!.engine.character()!.stats.map((s) => s.use));

  await sendText(page, '\\Q');
  await waitForScreen(page, /really want to quit/);
  await sendText(page, 'y');
  await waitForScreen(page, /verify QUITTING/);
  await sendText(page, '@');
  const finish = page.locator('#toolbar [data-action="finish"]');
  for (let i = 0; i < 40 && !(await finish.isVisible()); i++) {
    if (await page.locator('.prompt-card.death').isVisible()) {
      await expect(page.locator('.prompt-card.death .card-button')).toHaveCount(1);
      await page.locator('.prompt-card.death .card-button.primary').click();
    }
    if (/-more-/.test((await screenText(page)).split('\n')[0] ?? '')) await sendText(page, '\u001b');
    await page.waitForTimeout(500);
  }
  await finish.click();
  await expect(page.locator('.termview .fame-row')).toHaveCount(1);
  await expect(page.locator('.termview .fame-row').first()).toHaveClass(/current/);
  await page.locator('.termview .fame-row').first().click();
  await expect(page.locator('.sheet-fame-hero .sheet-title')).toHaveText('Anew');
  await expect(page.locator('.sheet-fame-hero .hero-facts')).toContainText('Abandoned in the town');
  await expect(page.locator('.sheet-fame-hero .sheet-action')).toHaveText(['Begin anew', 'Look back']);
  await page.locator('.sheet-fame-hero [data-action="look"]').click();
  await expect(page.locator('.sheet-fallen .fallen-cause')).toHaveText('Adventure abandoned');
  await page.keyboard.press('Escape');
  await page.locator('.sheet-fame-hero [data-action="anew"]').click();

  const name = page.locator('.ask-text input');
  await expect(name).toHaveValue('Anew II', { timeout: 60_000 });
  await page.locator('.sheet-action.primary').click();
  await expect(page.locator('#title-screen .title-intro')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect.poll(() => inDungeon(page), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#hud .hud-player .name')).toHaveText('Anew II');
  expect(await page.evaluate(() => window.__tome!.engine.character()!.stats.map((s) => s.use))).toEqual(stats);

  await page.locator('#toolbar [data-action="menu"]').click();
  await page.locator('.sheet .row-button', { hasText: 'Save and quit' }).click();
  await page.locator('.sheet-action.primary', { hasText: 'Save and quit' }).click();
  await expect(page.locator('#title-screen')).toBeVisible({ timeout: 60_000 });
  await waitForEngine(page);
  await expect(page.locator('#title-screen .title-choice').first()).toContainText('Continue as Anew II');
  await page.locator('#title-screen [data-link="fame"]').click();
  await page.locator('.sheet .fame-row', { hasText: 'Anew' }).click();
  await expect(page.locator('.sheet-fame-hero [data-action="anew"]')).toBeVisible();
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
  await expect(page.locator('#toolbar [data-action="walkhere"]')).toHaveCount(0);
  await expect(page.locator('#toolbar [data-action="inventory"]')).toBeVisible();
});

test('saved heroes: Continue plays the last, the Roster lists them all, an abandoned hero stays in the Hall of Fame until removed, Delete removes only that hero', async ({ page }) => {
  test.setTimeout(300_000);
  const quit = async () => {
    await page.locator('#toolbar [data-action="menu"]').click();
    await page.locator('.sheet .row-button', { hasText: 'Save and quit' }).click();
    await page.locator('.sheet-action.primary', { hasText: 'Save and quit' }).click();
    await expect(page.locator('#title-screen')).toBeVisible({ timeout: 60_000 });
    await waitForEngine(page);
  };
  const savedFiles = () =>
    page.evaluate(() => {
      const engine = window.__tome!.engine;
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const n of engine.fs!.readdir(dir)) {
          if (n === '.' || n === '..') continue;
          const path = `${dir}/${n}`;
          if (engine.fs!.isDir(engine.fs!.stat(path).mode)) walk(path);
          else out.push(n);
        }
      };
      walk(engine.savePath!);
      return out;
    });

  await page.goto('./');
  await waitForEngine(page);
  await createCharacter(page, 'Elder');
  await quit();
  await createCharacter(page, 'Young Sib');
  await quit();
  expect(await savedFiles()).toEqual(expect.arrayContaining(['Elder', 'Young_Sib', 'Young_Sib.nte']));

  const choices = page.locator('#title-screen .title-choice');
  await expect(choices.first()).toContainText('Continue as Young Sib');
  await expect(choices.first().locator('.title-choice-detail')).toContainText(/^Level 1 /);
  await choices.filter({ hasText: 'Roster' }).click();
  await expect(page.locator('.adventurer-row')).toHaveText([/Young Sib/, /Elder/]);
  await page.locator('.adventurer-row', { hasText: 'Elder' }).click();
  await expect(page.locator('.sheet-adventurer .sheet-title')).toHaveText('Elder');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await choices.first().click();
  await expect.poll(() => inDungeon(page), { timeout: 30_000 }).toBe(true);
  await waitAtCommand(page);
  await page.locator('#toolbar [data-action="menu"]').click();
  await expect(page.locator('.sheet .row-button', { hasText: 'Saved games' })).toHaveCount(0);
  await page.locator('.sheet .row-button', { hasText: 'Abandon adventure' }).click();
  await page.locator('.sheet-action.danger', { hasText: 'Abandon' }).click();
  await expect(page.locator('#title-screen')).toBeVisible({ timeout: 60_000 });
  await waitForEngine(page);
  await expect(choices.first()).toContainText('Continue as Elder');
  await expect(choices.filter({ hasText: 'Roster' })).toContainText('1 saved hero');
  let files = await savedFiles();
  expect(files).toEqual(expect.arrayContaining(['Elder', 'Young_Sib']));

  await page.locator('#title-screen [data-link="fame"]').click();
  await expect(page.locator('.sheet .fame-row')).toHaveCount(1);
  await page.locator('.sheet .fame-row').first().click();
  await expect(page.locator('.sheet-fame-hero .sheet-title')).toHaveText('Young Sib');
  await expect(page.locator('.sheet-fame-hero .hero-facts')).toContainText('Abandoned in the town');
  await expect(page.locator('.sheet-fame-hero .sheet-action')).toHaveText(['Begin anew', 'Look back', 'Remove']);
  await page.locator('.sheet-fame-hero [data-action="remove"]').click();
  await page.locator('.sheet', { hasText: 'Remove Young Sib?' }).locator('.sheet-action.danger').click();
  await expect(page.locator('#toast')).toHaveText('Young Sib was removed from the Hall of Fame.', { timeout: 15_000 });
  await expect(page.locator('.sheet .fame-row')).toHaveCount(0);
  files = await savedFiles();
  expect(files.filter((f) => f.startsWith('Young_Sib'))).toEqual([]);
  await page.keyboard.press('Escape');

  await choices.filter({ hasText: 'Roster' }).click();
  await expect(page.locator('.adventurer-row')).toHaveCount(1);
  await page.locator('.adventurer-row', { hasText: 'Elder' }).click();
  await page.locator('.sheet-adventurer [data-action="delete"]').click();
  await page.locator('.sheet', { hasText: 'Delete Elder?' }).locator('.sheet-action.danger').click();
  await expect(page.locator('#toast')).toHaveText("Elder's adventure was deleted.", { timeout: 15_000 });
  await expect(choices.first()).toContainText(/Enter Middle-earth/i);
  files = await savedFiles();
  expect(files.filter((f) => f.startsWith('Elder'))).toEqual([]);
  await page.reload();
  await waitForEngine(page);
  await expect(choices.first()).toContainText(/Enter Middle-earth/i);
});
