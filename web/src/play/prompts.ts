export type PromptKind = 'none' | 'more' | 'yesno' | 'aim' | 'direction' | 'item' | 'other';

/**
 * Classifies tome2's prompt line (terminal row 0) so the UI can offer the
 * right controls.
 */
export function classifyPrompt(rowZero: string): PromptKind {
  const text = rowZero.trim();
  if (!text) return 'none';
  if (/-more-$/.test(text)) return 'more';
  if (/\[y\/n\]/i.test(text)) return 'yesno';
  if (/^Direction \(.*target/.test(text)) return 'aim';
  if (/Direction(\s*\(Escape to cancel\))?\?\s*$/.test(text)) return 'direction';
  if (/^\((Inven|Equip|Floor):|^(Inven|Equip|Floor):|which (item|spell|book|power)|\(\w-\w,/i.test(text)) return 'item';
  return 'other';
}

const CHOICE = /(?:^|[\s[])([a-zA-Z])[)\]]/g;

/**
 * Finds the menu letter on a terminal row nearest to the left of a tapped
 * column, e.g. "a) Rations" or "[b] Half-Elf    c) Elf".
 */
export function menuChoiceAt(row: string, col: number): string | null {
  let best: { letter: string; start: number } | null = null;
  let first: { letter: string; start: number } | null = null;
  for (const match of row.matchAll(CHOICE)) {
    const start = (match.index ?? 0) + match[0].indexOf(match[1]);
    const choice = { letter: match[1], start };
    if (!first) first = choice;
    if (start <= col + 1) best = choice;
  }
  if (!first) return null;
  return (best ?? first).letter;
}

/** Keypad digit for a step from (0,0) by (dx,dy), each in -1..1. */
export function directionDigit(dx: number, dy: number): string | null {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy === 0) return '5';
  return ['7', '8', '9', '4', '5', '6', '1', '2', '3'][(sy + 1) * 3 + (sx + 1)];
}

export function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) === 1;
}
