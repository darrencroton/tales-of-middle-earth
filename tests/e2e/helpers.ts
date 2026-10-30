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
  try {
    await expect
      .poll(
        async () => {
          last = await screenText(page);
          return pattern.test(last);
        },
        { timeout },
      )
      .toBe(true);
  } catch {
    throw new Error(`screen never matched ${pattern}\n${await whatShows(page, last)}`);
  }
  return last;
}

/** What the player sees, for a failure message: tome2's top rows, any toast, and the pop-up open. */
async function whatShows(page: Page, screen: string): Promise<string> {
  const seen = await page.evaluate(() => ({
    mode: window.__tome?.mode() ?? '',
    toast: document.querySelector('#toast')?.textContent ?? '',
    sheet: document.querySelector('.sheet-layer:not([hidden]) .sheet-title')?.textContent ?? '',
    card: document.querySelector('.prompt-card:not([hidden])')?.textContent?.slice(0, 120) ?? '',
  }));
  const rows = screen.split('\n').slice(0, 3).map((r) => r.trimEnd()).join('\n');
  return `mode: ${seen.mode}; toast: ${seen.toast || '-'}; pop-up: ${seen.sheet || '-'}; card: ${seen.card || '-'}\nscreen:\n${rows}`;
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
export async function createCharacter(
  page: Page,
  name: string,
  picks: { race?: string; cls?: string; beforeBegin?: () => Promise<void> } = {},
): Promise<void> {
  await beginNewCharacter(page, name);
  await page.waitForTimeout(400);
  await page.locator('#title-screen').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });

  let readied = false;
  for (let i = 0; i < 60 && !(await inDungeon(page)); i++) {
    if (picks.beforeBegin && !readied && (await page.locator('#toolbar [data-action="begin"]').isVisible())) {
      readied = true;
      await picks.beforeBegin();
    }
    const heading = (await page.locator('.director .birth-header h2').textContent().catch(() => '')) ?? '';
    const pick = /your race/.test(heading) ? picks.race : /your class/.test(heading) ? picks.cls : undefined;
    if (pick && (await page.locator('.director .birth-option.current').textContent()) !== pick) {
      await page.locator('.director .birth-option', { hasText: pick }).first().click();
      await page.waitForTimeout(300);
      continue;
    }
    const candidates = [
      '.prompt-card .card-button.primary',
      '#toolbar [data-action="yes"]',
      '#toolbar [data-action="choose"]',
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

/** Uses tome2's wizard commands (page loaded with ?wizard) to summon a creature (by r_info index, asleep) beside the hero. */
export async function summonBeside(page: Page, raceIndex: number): Promise<void> {
  const rowZero = async () => (await screenText(page)).split('\n')[0] ?? '';
  let text = await screenText(page);
  await sendText(page, `0${raceIndex}\u0001`);
  text = await waitForSettle(page, text, 5_000);
  for (let i = 0; i < 10 && !/Debug Command/.test(await rowZero()); i++) {
    await sendText(page, /\[y\/n\]/.test(await rowZero()) ? 'y' : ' ');
    text = await waitForSettle(page, text, 5_000);
  }
  await sendText(page, 'n');
  await waitForSettle(page, text, 5_000);
  await dismissMore(page);
  await waitAtCommand(page);
}

/**
 * Casts a spell from the Magic sheet until tome2 asks where to aim it: a
 * new caster often fails to get a spell off, and tome2 says so before it
 * would ask. `failed` runs after each failure, back at the command prompt.
 */
export async function castUntilAimed(page: Page, spell: string, failed?: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const total = await page.evaluate(() => window.__tome!.engine.gameState()?.messageTotal ?? 0);
    await page.locator('#toolbar [data-action="commands"]').click();
    await page.locator('.sheet .command', { hasText: 'Magic & powers' }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Magic');
    await page.locator('.sheet .spell-row', { hasText: spell }).click();
    await expect(page.locator('.sheet-layer')).toBeHidden();
    let outcome = '';
    await expect
      .poll(
        async () => {
          outcome = await page.evaluate((before) => {
            const tome = window.__tome!;
            if (/^Direction/.test(tome.screenText())) return 'aimed';
            const state = tome.engine.gameState();
            const fresh = (state?.messages ?? []).slice(0, Math.max(0, (state?.messageTotal ?? 0) - before));
            return fresh.some((m) => /You failed to get the spell off/.test(m.text)) ? 'failed' : '';
          }, total);
          return outcome;
        },
        { timeout: 30_000, message: `${spell} was neither aimed nor failed` },
      )
      .not.toBe('');
    if (outcome === 'aimed') return;
    await dismissMore(page);
    await waitAtCommand(page);
    await failed?.();
  }
  throw new Error(`${spell} failed six times in a row`);
}

const TRANSITIONS = new Set(['descend', 'ascend', 'enter', 'leave', 'rift']);

/** Steps off the stairs (or other way on) the hero stands on, whose button would otherwise take the toolbar's first place. */
export async function stepOffStairs(page: Page): Promise<void> {
  const first = async () => (await page.evaluate(() => window.__tome!.actions()))[0] ?? '';
  for (const dir of '26481379') {
    if (!TRANSITIONS.has(await first())) return;
    const turn = await page.evaluate(() => window.__tome!.engine.snapshot()?.turn ?? 0);
    await page.evaluate((d) => window.__tome!.sendText(`\\;${d}`), dir);
    await expect.poll(() => page.evaluate(() => window.__tome!.engine.pendingKeys)).toBe(0);
    await page.waitForFunction((t) => (window.__tome!.engine.snapshot()?.turn ?? 0) !== t, turn, { timeout: 2_000 }).catch(() => undefined);
    await dismissMore(page);
    await waitAtCommand(page);
  }
}

/** Takes the gear the toolbar suggests (wield, light) until none is left, whatever the toolbar shows first (stairs, a foe). */
export async function equipSuggested(page: Page): Promise<void> {
  const gear = () => page.evaluate(() => window.__tome!.gear());
  for (let i = 0; i < 3 && (await gear()); i++) {
    await page.evaluate(() => window.__tome!.takeGear());
    await expect.poll(() => page.evaluate(() => window.__tome!.macroRunning())).toBe(false);
    await dismissMore(page);
    await waitAtCommand(page);
  }
  expect(await gear()).toBeNull();
}

/** Explores once: the toolbar's Explore when it is the changing button, otherwise Explore under More. Waits until exploring stops. */
export async function pressExplore(page: Page): Promise<void> {
  const button = page.locator('#toolbar [data-action="explore"]');
  if (await button.count()) {
    await button.click();
  } else {
    await page.locator('#toolbar [data-action="commands"]').click();
    await page.locator('.sheet .command', { hasText: 'Explore' }).click();
  }
  await expect.poll(() => page.evaluate(() => window.__tome!.travelling()), { timeout: 60_000 }).toBe(false);
}
