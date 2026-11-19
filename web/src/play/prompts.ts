import { gridDistance } from './pathfinding.ts';

export type PromptKind = 'none' | 'more' | 'yesno' | 'aim' | 'direction' | 'item' | 'quantity' | 'text' | 'choice' | 'dungeon' | 'other';

/*
 * A shop's "Buy …? [y/n/RET/ESC]" or "Sell …?" (store.cc's prompt_yesno) does
 * not shorten the item's name, as get_check does, so with a long name the
 * question runs past the 80 columns of row 0, [y/n] and all.
 */
const CUT_SHOP_QUESTION = /^(Buy|Sell) .{70,}$/;

/* get_check's "[y/n]", a shop's "[y/n/RET/ESC]", and tome2's own "(y/n)" and "(Y/N)" (leaving a unique level, gambling again, a message box). */
const YES_NO_HINT = /[[(]y\/n[\]/)]/i;

/* Keys offered for a question read as one key: "Recall details? (k/p/y/n):". */
const ONE_KEY_HINT = /\([a-z](\/[a-z])+\)/i;

/* tome2's questions read as one key and answered y or n without saying so (Piercing shots). */
const UNHINTED_YES_NO = /^Allow shots to pierce\?/;

/* A yes that cannot be taken back: leaving a unique level for good, destroying, deleting, abandoning, quitting. */
const IRREVERSIBLE = /\b(forever|destroy|delete|abandon|quit|retire)\b|\*really\*/i;

/** tome2's choice of the dungeon Word of Recall leads to (a Scroll of Reset Recall, a building's teleport to a dungeon level). */
const DUNGEON_PROMPT = /^Select a dungeon \(a-.\), \* to list/;

/* A range of numbers to choose from: "Quantity (1-6):", "Which level in Mirkwood(11-14)?", "Your wager (1-5000) ?". */
export const NUMBER_RANGE = /\((\d+)\s*-\s*(\d+)\)/;

/**
 * Classifies tome2's prompt line (terminal row 0) so the UI can offer the
 * right controls. `typing` is true when tome2's cursor sits on that line,
 * as it does while it reads typed text.
 */
export function classifyPrompt(rowZero: string, typing = false): PromptKind {
  const text = rowZero.trim();
  if (!text) return 'none';
  if (/-more-$/.test(text)) return 'more';
  if (isYesNo(text)) return 'yesno';
  const choices = bracketChoices(text).length;
  /* One choice only ("Create [S]hots?") is still asked, where a message's lone "[8]" (an armour's) is not. */
  if (choices > 1 || (choices === 1 && /\?\s*$/.test(text))) return 'choice';
  if (DUNGEON_PROMPT.test(text)) return 'dungeon';
  if (/^Direction \(.*target/.test(text)) return 'aim';
  if (/Direction(\s*\(Escape to cancel\))?\?\s*$/.test(text)) return 'direction';
  if (/^\((Inven|Equip|Floor):|^(Inven|Equip|Floor):|which (item|spell|book|power)|\(\w-\w,/i.test(text)) return 'item';
  if (/^(Quantity|How many)\b/i.test(text) || NUMBER_RANGE.test(text)) return 'quantity';
  if (/\([a-zA-Z0-9]-[a-zA-Z0-9]+\)/.test(text)) return 'item';
  /* Typed answers: after a colon, or to a question of what or which (Engrave what?, Wish for what?, naming an artifact, Which dungeon?); not one key of a list ("(k/p/y/n):"). */
  if (typing && !ONE_KEY_HINT.test(text) && (/:\s*[^:?]*$/.test(text) || /\b(what|which)\b[^?]*\?\s*[^?]*$/i.test(text))) return 'text';
  return 'other';
}

/** True for a question tome2 answers with y or n, however it words the keys. */
export function isYesNo(text: string): boolean {
  return YES_NO_HINT.test(text) || CUT_SHOP_QUESTION.test(text) || UNHINTED_YES_NO.test(text.trim());
}

/** True for a yes/no question whose yes cannot be undone, so No is its default. */
export function isIrreversible(text: string): boolean {
  return IRREVERSIBLE.test(text);
}

/** Keypad digit for a step from (0,0) by (dx,dy), each in -1..1. */
export function directionDigit(dx: number, dy: number): string | null {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy === 0) return '5';
  return ['7', '8', '9', '4', '5', '6', '1', '2', '3'][(sy + 1) * 3 + (sx + 1)];
}

export function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return gridDistance({ x: ax, y: ay }, { x: bx, y: by }) === 1;
}

/** A choice offered by a bracketed key, "Create [S]hots, [A]rrows or [B]olts?" → S Shots, A Arrows, B Bolts. */
interface BracketChoice {
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
