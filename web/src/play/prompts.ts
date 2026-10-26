export type PromptKind = 'none' | 'more' | 'yesno' | 'aim' | 'direction' | 'item' | 'quantity' | 'text' | 'other';

/**
 * Classifies tome2's prompt line (terminal row 0) so the UI can offer the
 * right controls. `typing` is true when tome2's cursor sits on that line,
 * as it does while it reads typed text.
 */
export function classifyPrompt(rowZero: string, typing = false): PromptKind {
  const text = rowZero.trim();
  if (!text) return 'none';
  if (/-more-$/.test(text)) return 'more';
  if (/\[y\/n[\]/]/i.test(text)) return 'yesno';
  if (/^Direction \(.*target/.test(text)) return 'aim';
  if (/Direction(\s*\(Escape to cancel\))?\?\s*$/.test(text)) return 'direction';
  if (/^\((Inven|Equip|Floor):|^(Inven|Equip|Floor):|which (item|spell|book|power)|\(\w-\w,/i.test(text)) return 'item';
  if (/^(Quantity|How many)\b/i.test(text)) return 'quantity';
  if (/\([a-zA-Z0-9]-[a-zA-Z0-9]+\)/.test(text)) return 'item';
  if (typing && /:\s*[^:?]*$/.test(text)) return 'text';
  return 'other';
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
