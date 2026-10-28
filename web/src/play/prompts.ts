export type PromptKind = 'none' | 'more' | 'yesno' | 'aim' | 'direction' | 'item' | 'quantity' | 'text' | 'choice' | 'other';

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
  if (bracketChoices(text).length > 1) return 'choice';
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

/** A choice offered by a bracketed key, "Create [S]hots, [A]rrows or [B]olts?" → S Shots, A Arrows, B Bolts. */
export interface BracketChoice {
  key: string;
  label: string;
}

/** The choices in a prompt that marks each one's key in brackets. */
export function bracketChoices(text: string): BracketChoice[] {
  const out: BracketChoice[] = [];
  for (const m of text.matchAll(/\[([A-Za-z0-9])\]([^[,?]*)/g)) {
    const rest = m[2].replace(/\(.*$/, '').split(/\s+(?:or|and)\b/i)[0].replace(/[\s.:;!-]+$/, '');
    const word = /^[a-z]/.test(rest) ? `${m[1]}${rest}` : rest.trim() || m[1];
    out.push({ key: m[1], label: word[0].toUpperCase() + word.slice(1) });
  }
  return out;
}

/** A bracketed-choice prompt as a plain question ("Create [S]hots or [A]rrows?" → "Create shots or arrows?"). */
export function choiceQuestion(text: string): string {
  const plain = text
    .trim()
    .replace(/\[([A-Za-z0-9])\]([a-z]?)/g, (_m, key: string, next: string) => (next ? `${key.toLowerCase()}${next}` : /[A-Z]/.test(key) ? key : ''))
    .replace(/\s+/g, ' ');
  return plain[0].toUpperCase() + plain.slice(1);
}
