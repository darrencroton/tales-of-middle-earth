import { expect, type Page } from '@playwright/test';

export async function screenText(page: Page): Promise<string> {
  return page.evaluate(() => window.__tome?.screenText() ?? '');
}

export async function sendText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => window.__tome?.sendText(t), text);
}

export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__tome?.engine.state === 'running', null, { timeout: 90_000 });
  await expect(page.locator('#splash')).toBeHidden();
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

type Step = [RegExp, string | ((savefile: string) => string)];

/* Prompt/answer pairs for the birth sequence, checked in order. */
const BIRTH_STEPS: Step[] = [
  [/-more-/, ' '],
  [/name of the savefile/, (savefile) => `${savefile}\r`],
  [/select a module to play/, '\r'],
  [/Press any key|\[Press any key to continue\]/, ' '],
  [/\[a\] New Character/, '\r'],
  [/Art thou an adventurer/, ' '],
  [/Choose a race \(/, 'a'],
  [/Choose a race modifier/, 'a'],
  [/Choose a class \(/, 'a'],
  [/Choose a class specialisation/, 'a'],
  [/Choose a god/, 'a'],
  [/modify the options/, 'n'],
  [/Number of quests\?/, '\r'],
  [/Enter minimum attribute/, '\r'],
  [/'r' to reroll/, '\u001b'],
  [/Enter your player's name above/, '\u001b'],
  [/'Q' to suicide/, '\u001b'],
];

export function isOnMap(text: string): boolean {
  return /LEVEL\s+1/.test(text) && /HP\s+\d+\/\s*\d+/.test(text) && text.includes('@');
}

/**
 * Drives character creation with default choices until the town map is shown.
 */
export async function createCharacter(page: Page, savefile: string): Promise<void> {
  let text = await waitForScreen(page, /select a module to play/);
  for (let i = 0; i < 80 && !isOnMap(text); i++) {
    const step = BIRTH_STEPS.find(([pattern]) => pattern.test(text));
    if (!step) {
      text = await waitForSettle(page, text, 3_000);
      continue;
    }
    const answer = step[1];
    await sendText(page, typeof answer === 'string' ? answer : answer(savefile));
    text = await waitForSettle(page, text);
  }
  expect(isOnMap(text), `expected the town map, got:\n${text}`).toBe(true);
}

export function findPlayer(text: string): { x: number; y: number } | null {
  const lines = text.split('\n');
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y].indexOf('@');
    if (x >= 0) return { x, y };
  }
  return null;
}

export async function swipe(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(
    ([sx, sy]) => {
      const target = document.getElementById('terminal');
      if (!target) throw new Error('terminal missing');
      const rect = target.getBoundingClientRect();
      const x0 = rect.left + rect.width / 2;
      const y0 = rect.top + rect.height / 2;
      const touch = (x: number, y: number) =>
        new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
      const start = touch(x0, y0);
      const end = touch(x0 + sx, y0 + sy);
      target.dispatchEvent(new TouchEvent('touchstart', { touches: [start], changedTouches: [start], bubbles: true, cancelable: true }));
      target.dispatchEvent(new TouchEvent('touchmove', { touches: [end], changedTouches: [end], bubbles: true, cancelable: true }));
      target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [end], bubbles: true, cancelable: true }));
    },
    [dx, dy],
  );
}
