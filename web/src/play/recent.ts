import { KEY_BACKSLASH as BACKSLASH, keyCodes, typedAnswer } from '../input/keys.ts';
import type { ItemState } from '../render/snapshot.ts';
import { classifyPrompt } from './prompts.ts';
import type { Macro, MacroScreen } from './macro.ts';

/** Something the player does often, kept so it can be done again in one tap. */
export type RecentAction =
  | { kind: 'spell'; name: string }
  /** A power from a skill's own menu (Mindcraft, Necromancy, Mimicry...), or the skill itself when `power` is empty. */
  | { kind: 'power'; skill: string; power: string }
  /** An item used from the pack, by kind so it survives the stack changing size. */
  | { kind: 'item'; command: string; verb: string; tval: number; sval: number; name: string };

export const MAX_RECENT = 5;

/* tome2's "use a skill" menu key for school spells (MKEY_SCHOOL). */
export const MKEY_SCHOOL = 17;

export function recentKey(entry: RecentAction): string {
  switch (entry.kind) {
    case 'spell':
      return `spell:${entry.name}`;
    case 'power':
      return `power:${entry.skill}:${entry.power}`;
    case 'item':
      return `item:${entry.command}:${entry.tval}:${entry.sval}`;
  }
}

/** The list with `entry` moved (or added) to the front, keeping at most `max` of each kind. */
export function rememberRecent(list: readonly RecentAction[], entry: RecentAction, max = MAX_RECENT): RecentAction[] {
  const key = recentKey(entry);
  const next = [entry, ...list.filter((e) => recentKey(e) !== key)];
  const counts = new Map<string, number>();
  return next.filter((e) => {
    const group = e.kind === 'item' ? 'item' : 'magic';
    const n = (counts.get(group) ?? 0) + 1;
    counts.set(group, n);
    return n <= max;
  });
}

/** What the button for a recent action says. */
export function recentLabel(entry: RecentAction): string {
  switch (entry.kind) {
    case 'spell':
      return entry.name;
    case 'power':
      return entry.power || entry.skill;
    case 'item':
      return entry.name;
  }
}

/** An item's name without its count or article, for labels ("3 Potions of X" → "Potions of X"). */
export function itemBaseName(name: string): string {
  return name.replace(/^(a|an|the|some|\d+) /i, '');
}

export function itemRecent(command: string, verb: string, item: Pick<ItemState, 'tval' | 'sval' | 'name'>): RecentAction {
  return { kind: 'item', command, verb, tval: item.tval, sval: item.sval ?? -1, name: itemBaseName(item.name) };
}

/** The pack item a recent item action refers to, if one is still carried. */
export function recentItem(entry: Extract<RecentAction, { kind: 'item' }>, pack: readonly ItemState[]): ItemState | null {
  return pack.find((i) => i.tval === entry.tval && (i.sval ?? -1) === entry.sval) ?? null;
}

export interface SkillMenuEntry {
  letter: string;
  mkey: number;
  label: string;
}

/** Entries of tome2's "use a skill" menu ("  a - 17) Cast a spell"). */
export function skillMenu(screen: string): SkillMenuEntry[] {
  const out: SkillMenuEntry[] = [];
  for (const line of screen.split('\n')) {
    const m = /(?:^|\s)([a-z]) - (\d+)\) (.+?)\s*$/.exec(line);
    if (m) out.push({ letter: m[1], mkey: Number(m[2]), label: m[3] });
  }
  return out;
}

/** Names on a lettered list ("a) Manathrust   Mana ..."), cut to the name column's width. */
export function listedNames(screen: string, width: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of screen.split('\n')) {
    const m = /(?:^|[^A-Za-z0-9(])([a-z])\) (.+)$/.exec(line);
    if (!m || out.has(m[1])) continue;
    const name = m[2].slice(0, width).trim();
    if (name) out.set(m[1], name);
  }
  return out;
}

export const SKILL_PROMPT = /Select a skill \(/;
export const SPELL_PROMPT = /Cast which spell\?/;
export const POWER_PROMPT = /Use which power\?/;
/* Name columns: school spells are printed "%-20s", skill powers "%-30s". */
export const SPELL_NAME_WIDTH = 20;
export const POWER_NAME_WIDTH = 30;

function letterFor(names: Map<string, string>, wanted: string): string | null {
  const target = wanted.toLowerCase();
  for (const [letter, name] of names) if (name.toLowerCase() === target) return letter;
  return null;
}

/** When asked for a direction, aims at the nearest foe if `aim` (the toolbar's one-tap attacks). */
function* aimIfAsked(s: MacroScreen, aim: boolean): Macro {
  if (aim && classifyPrompt(s.prompt) === 'aim') yield keyCodes('*t');
}

/**
 * Casts a school spell by name: the "use a skill" menu, then tome2's
 * spell-by-name lookup at the book prompt, so the book need not be chosen.
 */
export function* castSpellMacro(name: string, aim = false): Macro {
  let s: MacroScreen = yield [BACKSLASH, ...keyCodes('m')];
  if (SKILL_PROMPT.test(s.prompt)) {
    const entry = skillMenu(s.screen).find((e) => e.mkey === MKEY_SCHOOL);
    if (!entry) return;
    s = yield keyCodes(entry.letter);
  }
  if (!/which book\?/i.test(s.prompt)) return;
  s = yield keyCodes('@');
  if (!/Spell name\?/.test(s.prompt)) return;
  s = yield typedAnswer(name, '');
  yield* aimIfAsked(s, aim);
}

/** Uses a skill from tome2's "use a skill" menu, then picks `power` from the skill's own list when given. */
export function* usePowerMacro(skill: string, power: string, aim = false): Macro {
  let s: MacroScreen = yield [BACKSLASH, ...keyCodes('m')];
  if (!SKILL_PROMPT.test(s.prompt)) return;
  const entry = skillMenu(s.screen).find((e) => e.label === skill);
  if (!entry) return;
  s = yield keyCodes(entry.letter);
  if (!power || !POWER_PROMPT.test(s.prompt)) return;
  const letter = letterFor(listedNames(s.screen, POWER_NAME_WIDTH), power);
  if (!letter) return;
  s = yield keyCodes(letter);
  yield* aimIfAsked(s, aim);
}

/** Fires the quiver at the nearest foe. */
export function* fireMacro(): Macro {
  const s: MacroScreen = yield [BACKSLASH, ...keyCodes('f')];
  yield* aimIfAsked(s, true);
}

/** Runs a recent spell or power again. */
export function recentMagicMacro(entry: RecentAction, aim = false): Macro | null {
  if (entry.kind === 'spell') return castSpellMacro(entry.name, aim);
  if (entry.kind === 'power') return usePowerMacro(entry.skill, entry.power, aim);
  return null;
}

/**
 * Follows the player through tome2's own casting menus (typed keys or taps on
 * its lists) and reports what was cast, so it joins the recent list.
 */
export class CastWatcher {
  private skill = '';

  /** A skill's own list is about to show (opened by a macro), so a power picked from it is recorded. */
  expect(skill: string): void {
    this.skill = skill;
  }

  /** Called with the key about to be sent and the screen it answers; returns what it chose, if anything. */
  note(prompt: string, screen: string, key: number): RecentAction | null {
    const ch = String.fromCharCode(key);
    if (!/^[a-z]$/.test(ch)) {
      if (key === 27) this.skill = '';
      return null;
    }
    if (SKILL_PROMPT.test(prompt)) {
      const entry = skillMenu(screen).find((e) => e.letter === ch);
      this.skill = entry && entry.mkey !== MKEY_SCHOOL ? entry.label : '';
      return null;
    }
    if (SPELL_PROMPT.test(prompt)) {
      const name = listedNames(screen, SPELL_NAME_WIDTH).get(ch);
      return name ? { kind: 'spell', name } : null;
    }
    if (POWER_PROMPT.test(prompt) && this.skill) {
      const name = listedNames(screen, POWER_NAME_WIDTH).get(ch);
      return name ? { kind: 'power', skill: this.skill, power: name } : null;
    }
    return null;
  }
}
