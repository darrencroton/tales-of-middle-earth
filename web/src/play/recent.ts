import { KEY_BACKSLASH as BACKSLASH, KEY_ESCAPE, keyCodes, typedAnswer } from '../input/keys.ts';
import type { ItemState, SpellState } from '../render/snapshot.ts';
import { useAction, type ItemAction } from './items.ts';
import { bracketChoices, classifyPrompt } from './prompts.ts';
import type { Macro, MacroScreen } from './macro.ts';

/** Something the player does often, kept so it can be done again in one tap. */
export type RecentAction =
  | { kind: 'spell'; name: string; aimed?: boolean }
  /**
   * Choices made through tome2's menus after `m` (use a skill) or `U` (use a
   * power): a skill, then its power, form, totem or ammunition... Steps are
   * the labels picked; "#x" stands for an unlabelled choice made with key x.
   */
  | { kind: 'path'; command: 'm' | 'U'; steps: string[]; aimed?: boolean }
  /** An item used from the pack, by kind so it survives the stack changing size. */
  | { kind: 'item'; command: string; verb: string; tval: number; sval: number; name: string; aimed?: boolean };

export const MAX_RECENT = 5;

/* tome2's "use a skill" menu key for school spells (MKEY_SCHOOL). */
export const MKEY_SCHOOL = 17;

/* Item commands that ask for a direction. */
const AIMED_ITEM_COMMANDS = new Set(['a', 'z', 'v']);

export function recentKey(entry: RecentAction): string {
  switch (entry.kind) {
    case 'spell':
      return `spell:${entry.name}`;
    case 'path':
      return `path:${entry.command}:${entry.steps.join('/')}`;
    case 'item':
      return `item:${entry.command}:${entry.tval}:${entry.sval}`;
  }
}

/** Entries from storage that this version understands. */
export function validRecent(entry: unknown): entry is RecentAction {
  const e = entry as RecentAction | null;
  if (!e || typeof e !== 'object') return false;
  if (e.kind === 'spell') return typeof e.name === 'string';
  if (e.kind === 'path') return (e.command === 'm' || e.command === 'U') && Array.isArray(e.steps) && e.steps.length > 0;
  if (e.kind === 'item') return typeof e.command === 'string' && typeof e.tval === 'number';
  return false;
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

function namedSteps(steps: readonly string[]): string[] {
  return steps.filter((s) => !s.startsWith('#'));
}

/** What the button for a recent action says. */
export function recentLabel(entry: RecentAction): string {
  switch (entry.kind) {
    case 'spell':
      return entry.name;
    case 'path':
      return namedSteps(entry.steps).at(-1) ?? entry.steps[0];
    case 'item':
      return entry.name;
  }
}

/** A second line for a recent action: where it comes from. */
export function recentSource(entry: RecentAction): string {
  if (entry.kind === 'path') {
    const named = namedSteps(entry.steps);
    return named.length > 1 ? named[0] : entry.command === 'U' ? 'Power' : 'Skill';
  }
  return entry.kind === 'item' ? entry.verb : 'Spell';
}

/** An item's name without its count, article or charges, for labels ("3 Potions of X" → "Potions of X"). */
export function itemBaseName(name: string): string {
  return name.replace(/^(a|an|the|some|\d+) /i, '').replace(/ \(\d+ charges?\)/, '');
}

export function itemRecent(command: string, verb: string, item: Pick<ItemState, 'tval' | 'sval' | 'name'>): RecentAction {
  return {
    kind: 'item',
    command,
    verb,
    tval: item.tval,
    sval: item.sval ?? -1,
    name: itemBaseName(item.name),
    aimed: AIMED_ITEM_COMMANDS.has(command),
  };
}

/** The pack item a recent item action refers to, if one is still carried. */
export function recentItem(entry: Extract<RecentAction, { kind: 'item' }>, pack: readonly ItemState[]): ItemState | null {
  return pack.find((i) => i.tval === entry.tval && (i.sval ?? -1) === entry.sval) ?? null;
}

/** The item action a recent item entry repeats (its use, or a throw). */
export function recentItemAction(entry: Extract<RecentAction, { kind: 'item' }>, item: Pick<ItemState, 'tval'>): ItemAction | null {
  if (entry.command === 'v') return { id: 'throw', label: 'Throw', command: 'v', quantity: 'one' };
  const use = useAction(item.tval);
  return use && use.command === entry.command ? use : null;
}

/** Whether a recent spell or power can be used now (the spell is in a book carried, the skill or power is known). */
function recentUsable(entry: RecentAction, spells: SpellState | null): boolean {
  if (entry.kind === 'spell') return !!spells?.books.some((b) => b.spells.some((s) => s.ok && s.name === entry.name));
  if (entry.kind === 'path' && entry.command === 'm') return !!spells?.powers.some((p) => p.label === entry.steps[0]);
  if (entry.kind === 'path') return !!spells?.bonus.some((p) => p.name === entry.steps[0]);
  return false;
}

/** Spells and powers recently used that can be used now. */
export function usableRecents(recents: readonly RecentAction[], spells: SpellState | null): RecentAction[] {
  return recents.filter((e) => recentUsable(e, spells));
}

/**
 * The toolbar's quick repeat. For a hero who uses magic, the last spell or
 * power that can be used again, or before any, the first spell in their
 * books (or their first race or class power); for others, the last aimed
 * thing they did that can be done again (a wand or rod, a thrown flask, a power).
 */
export function quickRecent(
  recent: readonly RecentAction[],
  spells: SpellState | null,
  pack: readonly ItemState[],
  usesMagic: boolean,
  level: number,
): RecentAction | null {
  const usable = (e: RecentAction) => {
    if (e.kind !== 'item') return recentUsable(e, spells);
    const item = recentItem(e, pack);
    return !!item && !!recentItemAction(e, item);
  };
  if (usesMagic) {
    const magic = recent.find((e) => e.kind !== 'item' && usable(e));
    if (magic) return magic;
    const first = spells?.books.flatMap((b) => b.spells).find((spell) => spell.ok);
    if (first) return { kind: 'spell', name: first.name };
    const power = spells?.bonus.find((p) => p.level <= level);
    if (power) return { kind: 'path', command: 'U', steps: [power.name] };
    return null;
  }
  return recent.find((e) => e.aimed && usable(e)) ?? null;
}

export const NO_TARGET = 'No target in sight.';

/**
 * Why a recent spell, power or item cannot be done now: too little mana for
 * the spell (tome2 would only let it be tried at great risk), a wand or
 * staff out of charges, or, for the toolbar's one tap (`needTarget`),
 * nothing in sight to aim it at.
 */
export function recentBlocked(
  entry: RecentAction,
  spells: SpellState | null,
  pack: readonly ItemState[],
  needTarget: boolean,
  targetInSight: boolean,
): string | null {
  if (entry.kind === 'spell') {
    const spell = spells?.books.flatMap((b) => b.spells).find((s) => s.name === entry.name);
    if (spell?.short) return `Not enough mana for ${entry.name}.`;
  }
  if (entry.kind === 'item' && /\(0 charges\)/.test(recentItem(entry, pack)?.name ?? '')) {
    return `The ${entry.name} is out of charges.`;
  }
  if (needTarget && entry.aimed && !targetInSight) return NO_TARGET;
  return null;
}

export interface MenuChoice {
  key: string;
  label: string;
  /** tome2's action key for "use a skill" entries (17 = school spells). */
  mkey?: number;
}

/* Name columns: school spells are printed "%-20s", most other lists "%-30s". */
const SPELL_NAME_WIDTH = 20;
const NAME_WIDTH = 30;

/** Entries of tome2's "use a skill" and "use a power" menus ("  a - 17) Cast a spell", "  b -  12) Bear form"). */
export function numberedMenu(screen: string): MenuChoice[] {
  const out: MenuChoice[] = [];
  for (const line of screen.split('\n')) {
    const m = /(?:^|\s)([a-z]) -\s*(\d+)\) (.+)$/.exec(line);
    if (m) out.push({ key: m[1], mkey: Number(m[2]), label: m[3].slice(0, NAME_WIDTH).trim() });
  }
  return out;
}

/** Names on a lettered list ("a) Manathrust   Mana ..."), cut to the name column's width; two columns per line are read. */
export function listedChoices(screen: string, width: number, skipCost = false): MenuChoice[] {
  const out: MenuChoice[] = [];
  const seen = new Set<string>();
  for (const line of screen.split('\n')) {
    for (const m of line.matchAll(/(?:^|[^A-Za-z0-9(])([a-z0-9])\) (.+?)(?=\s{2,}[a-z0-9]\) |$)/g)) {
      if (seen.has(m[1])) continue;
      let name = m[2].slice(0, width).trim();
      if (skipCost) name = name.replace(/^\d+\s+/, '');
      if (!name) continue;
      seen.add(m[1]);
      out.push({ key: m[1], label: name });
    }
  }
  return out;
}

export const SKILL_PROMPT = /Select a skill \(/;
export const POWER_MENU_PROMPT = /Select a power \(/;
export const SPELL_PROMPT = /Cast which spell\?/;

/** The choices tome2 is offering, read from its prompt and screen; empty when it is not a menu this knows. */
export function screenChoices(prompt: string, screen: string): MenuChoice[] {
  const bracketed = bracketChoices(prompt);
  if (bracketed.length > 1) return bracketed;
  if (SKILL_PROMPT.test(prompt) || POWER_MENU_PROMPT.test(prompt)) return numberedMenu(screen);
  const batch = /^\(a-([a-z])\) Select batch of powers/.exec(prompt);
  if (batch) {
    const out: MenuChoice[] = [];
    for (let c = 97; c <= batch[1].charCodeAt(0); c++) out.push({ key: String.fromCharCode(c), label: `#${String.fromCharCode(c)}` });
    return out;
  }
  if (/which spell\?/i.test(prompt)) return listedChoices(screen, SPELL_NAME_WIDTH);
  if (/Use which power of your/.test(prompt)) return listedChoices(screen, NAME_WIDTH, true);
  if (/Use which \w+\?|Select a power:|Choose a melee style/.test(prompt)) return listedChoices(screen, NAME_WIDTH);
  return [];
}

function choiceFor(choices: readonly MenuChoice[], step: string): MenuChoice | null {
  if (step.startsWith('#')) return choices.find((c) => c.key === step.slice(1)) ?? null;
  const wanted = step.toLowerCase();
  return choices.find((c) => c.label.toLowerCase() === wanted) ?? null;
}

/** When asked for a direction, aims at the nearest foe if `aim` (the toolbar's one-tap attacks). */
function* aimIfAsked(s: MacroScreen, aim: boolean): Macro {
  if (aim && classifyPrompt(s.prompt) === 'aim') yield keyCodes('*t');
}

/** Runs another macro, then aims at the nearest foe if it ends at a direction prompt and `aim`. */
export function* thenAim(inner: Macro, aim: boolean): Macro {
  let result = inner.next();
  let s: MacroScreen | undefined;
  while (!result.done) {
    s = yield result.value;
    result = inner.next(s);
  }
  if (s) yield* aimIfAsked(s, aim);
}

/**
 * Casts a school spell by name: the "use a skill" menu, then tome2's
 * spell-by-name lookup at the book prompt, so the book need not be chosen.
 */
export function* castSpellMacro(name: string, aim = false): Macro {
  let s: MacroScreen = yield [BACKSLASH, ...keyCodes('m')];
  if (SKILL_PROMPT.test(s.prompt)) {
    const entry = numberedMenu(s.screen).find((e) => e.mkey === MKEY_SCHOOL);
    if (!entry) return;
    s = yield keyCodes(entry.key);
  }
  if (!/which book\?/i.test(s.prompt)) return;
  s = yield keyCodes('@');
  if (!/Spell name\?/.test(s.prompt)) return;
  s = yield typedAnswer(name, '');
  yield* aimIfAsked(s, aim);
}

/** Gives `m` or `U` and picks each step by its label; stops (leaving tome2's menu up) at a step it cannot find. */
export function* pathMacro(command: 'm' | 'U', steps: readonly string[], aim = false): Macro {
  let s: MacroScreen = yield [BACKSLASH, ...keyCodes(command)];
  for (const step of steps) {
    const choice = choiceFor(screenChoices(s.prompt, s.screen), step);
    if (!choice) return;
    s = yield keyCodes(choice.key);
  }
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
  if (entry.kind === 'path') return pathMacro(entry.command, entry.steps, aim);
  return null;
}

/**
 * Follows the player through tome2's menus after `m` or `U` (typed keys or
 * taps on its lists and cards) and reports what was done once tome2 asks
 * for a direction or is back at the command prompt, so it joins the
 * recent list and is known to be aimed or not.
 */
export class CastWatcher {
  private command: 'm' | 'U' | null = null;
  private steps: string[] = [];
  private spell: string | null = null;
  private spellMode = false;

  /** The spell being cast, once it is known. */
  get casting(): string | null {
    return this.command && this.spellMode ? this.spell : null;
  }

  /** A command that opens tome2's menus was given (or a recent one is being replayed). */
  begin(command: 'm' | 'U', steps: readonly string[] = [], spell: string | null = null): void {
    this.command = command;
    this.steps = [...steps];
    this.spell = spell;
    this.spellMode = spell !== null;
  }

  /** Called with each single key the player sends and the screen it answers. */
  note(prompt: string, screen: string, key: number, atCommand: boolean): void {
    const ch = String.fromCharCode(key);
    if (atCommand) {
      if (ch === 'm' || ch === 'U') this.begin(ch);
      return;
    }
    if (!this.command) return;
    if (key === KEY_ESCAPE) {
      this.command = null;
      return;
    }
    if (this.spellMode) {
      if (SPELL_PROMPT.test(prompt)) this.spell = listedChoices(screen, SPELL_NAME_WIDTH).find((c) => c.key === ch)?.label ?? this.spell;
      return;
    }
    const choice = screenChoices(prompt, screen).find((c) => c.key.toLowerCase() === ch.toLowerCase());
    if (!choice) return;
    if (this.command === 'm' && this.steps.length === 0 && choice.mkey === MKEY_SCHOOL) {
      this.spellMode = true;
      return;
    }
    this.steps.push(choice.label);
  }

  /** Called whenever tome2 waits; returns the finished action once it asks for a direction or is back at the command prompt. */
  idle(prompt: string, atCommand: boolean): RecentAction | null {
    if (!this.command) return null;
    const kind = classifyPrompt(prompt);
    const aimed = kind === 'aim' || kind === 'direction';
    if (!aimed && !atCommand) return null;
    const command = this.command;
    this.command = null;
    if (this.spellMode) return this.spell ? { kind: 'spell', name: this.spell, aimed } : null;
    return this.steps.length ? { kind: 'path', command, steps: this.steps, aimed } : null;
  }
}
