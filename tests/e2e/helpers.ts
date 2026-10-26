import { expect, type Page } from '@playwright/test';

export async function screenText(page: Page): Promise<string> {
  return page.evaluate(() => window.__tome?.screenText() ?? '');
}

export async function sendText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => window.__tome?.sendText(t), text);
}

/** Waits for the engine and for the title screen to offer its choices. */
export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__tome?.engine.state === 'running', null, { timeout: 90_000 });
  await expect(page.locator('#title-screen .title-choice').first()).toBeVisible({ timeout: 30_000 });
}

export async function waitForScreen(page: Page, pattern: RegExp, timeout = 30_000): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        last = await screenText(page);
        return pattern.test(last);
      },
      { timeout, message: `screen never matched ${pattern}` },
    )
    .toBe(true);
  return last;
}

/** Waits until the screen differs from `before` and then stays unchanged briefly. */
export async function waitForSettle(page: Page, before: string, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout;
  let current = await screenText(page);
  while (current === before && Date.now() < deadline) {
    await page.waitForTimeout(100);
    current = await screenText(page);
  }
  let stable = 0;
  while (stable < 3 && Date.now() < deadline) {
    await page.waitForTimeout(150);
    const next = await screenText(page);
    stable = next === current ? stable + 1 : 0;
    current = next;
  }
  return current;
}

/** Dismisses any pending -more- prompts so the next key reaches the command prompt. */
export async function dismissMore(page: Page): Promise<string> {
  let text = await screenText(page);
  for (let i = 0; i < 10 && /-more-/.test(text.split('\n')[0] ?? ''); i++) {
    await sendText(page, '\u001b');
    text = await waitForSettle(page, text, 3_000);
  }
  return text;
}

export async function inDungeon(page: Page): Promise<boolean> {
  return page.evaluate(() => !!window.__tome?.engine.snapshot()?.inDungeon);
}

export async function waitAtCommand(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__tome!.engine.snapshot()?.atCommand ?? false), { timeout: 20_000 })
    .toBe(true);
}

/** Starts a new character from the title screen, up to the intro text. */
export async function beginNewCharacter(page: Page, name: string): Promise<void> {
  await page.locator('#title-screen .title-choice', { hasText: /Enter Middle-earth|New character/i }).click();
  await page.locator('.ask-text input').fill(name);
  await page.locator('.sheet-action.primary').click();
  await expect(page.locator('#title-screen .title-intro p').first()).toBeVisible();
}

/**
 * Creates a character through the native screens with default choices
 * until the town map is shown. Answers yes to tome2 questions (wizard mode).
 */
export async function createCharacter(page: Page, name: string): Promise<void> {
  await beginNewCharacter(page, name);
  await page.waitForTimeout(400);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 10_000 });

  for (let i = 0; i < 60 && !(await inDungeon(page)); i++) {
    const candidates = [
      '.prompt-card .card-button.primary',
      '#toolbar [data-action="yes"]',
      '.director .birth-confirm',
      '#toolbar [data-action="accept"]',
      '#toolbar [data-action="begin"]',
    ];
    for (const selector of candidates) {
      const target = page.locator(selector);
      if ((await target.count()) && (await target.first().isVisible())) {
        await target.first().click();
        break;
      }
    }
    await page.waitForTimeout(400);
  }
  expect(await inDungeon(page), `expected the town map, got:\n${await screenText(page)}`).toBe(true);
  await dismissMore(page);
  await waitAtCommand(page);
  const coach = page.locator('.coach-close');
  if (await coach.isVisible()) await coach.click();
}

export async function viewMode(page: Page): Promise<string> {
  return page.evaluate(() => window.__tome?.mode() ?? '');
}

/** Average brightness (0..255) of a canvas region given as fractions of its size. */
export async function canvasBrightness(
  page: Page,
  selector: string,
  region: { x: number; y: number; w: number; h: number },
): Promise<number> {
  return page.evaluate(
    ([sel, r]) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const x = Math.floor(canvas.width * r.x);
      const y = Math.floor(canvas.height * r.y);
      const w = Math.max(1, Math.floor(canvas.width * r.w));
      const h = Math.max(1, Math.floor(canvas.height * r.h));
      const data = ctx.getImageData(x, y, w, h).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      return sum / (data.length / 4);
    },
    [selector, region] as const,
  );
}

/** A canvas region (as fractions of the map canvas) centred on the player, so it stays valid when the camera is clamped at an edge. */
export async function playerRegion(page: Page, size = 0.1): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate((s) => {
    const tome = window.__tome!;
    const snap = tome.engine.snapshot()!;
    const centre = tome.mapCellCentre(snap.px, snap.py);
    const rect = document.querySelector('#map')!.getBoundingClientRect();
    const fx = (centre.x - rect.left) / rect.width;
    const fy = (centre.y - rect.top) / rect.height;
    return { x: Math.max(0, fx - s / 2), y: Math.max(0, fy - s / 2), w: s, h: s };
  }, size);
}

export async function playerPos(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const snap = window.__tome!.engine.snapshot()!;
    return { x: snap.px, y: snap.py };
  });
}

/** Uses tome2's wizard commands (page loaded with ?wizard) to jump to a dungeon level and wield a torch. */
export async function jumpToLevel(page: Page, level: number): Promise<void> {
  const rowZero = async () => (await screenText(page)).split('\n')[0] ?? '';
  let text = await screenText(page);
  await sendText(page, '\u0001');
  text = await waitForSettle(page, text, 5_000);
  for (let i = 0; i < 10 && !/Debug Command/.test(await rowZero()); i++) {
    await sendText(page, /\[y\/n\]/.test(await rowZero()) ? 'y' : ' ');
    text = await waitForSettle(page, text, 5_000);
  }
  await sendText(page, 'j');
  text = await waitForSettle(page, text, 5_000);
  for (let i = 0; i < 5 && !/Jump to level/.test(await rowZero()); i++) {
    await sendText(page, ' ');
    text = await waitForSettle(page, text, 5_000);
  }
  await sendText(page, `${level}\r`);
  await waitForSettle(page, text, 5_000);
  await dismissMore(page);
  await waitAtCommand(page);
}

/** Takes the toolbar's gear suggestions (wield, light) until none is left. */
export async function equipSuggested(page: Page): Promise<void> {
  for (let i = 0; i < 3 && (await page.locator('#toolbar [data-action="equip"]').count()); i++) {
    await page.locator('#toolbar [data-action="equip"]').click();
    await dismissMore(page);
    await waitAtCommand(page);
  }
  await expect(page.locator('#toolbar [data-action="equip"]')).toHaveCount(0);
}
