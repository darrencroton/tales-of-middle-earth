import { KEY_BACKSLASH as BACKSLASH, KEY_ESCAPE, keyCodes, typedAnswer } from '../input/keys.ts';
import type { InventoryState, ItemState, MagicItem, SpellState } from '../render/snapshot.ts';
import { INVEN_WIELD, useAction, type ItemAction, type ItemPlace } from './items.ts';
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
  /**
   * An item used (from the pack, or activated where it is worn): by its kind
   * and, where the kind does not say what it does (activations, rods), its
   * name, so it survives the stack changing size and never finds another
   * item; `i` is where it was, preferred while the same item is there.
   */
  | { kind: 'item'; command: string; verb: string; tval: number; sval: number; name: string; i?: number; aimed?: boolean };

/** Something to use as a recent item: what `itemRecent` and `recentItem` read of an item. */
type ItemKind = Pick<ItemState, 'i' | 'tval' | 'sval' | 'base'>;

const MAX_RECENT = 5;

/* tome2's "use a skill" menu keys for school spells (MKEY_SCHOOL) and stealing (MKEY_STEAL, under More's Steal). */
const MKEY_SCHOOL = 17;
const MKEY_STEAL = 15;

/**
 * tome2's "use a skill" entries, by their label: what the player sees, and
 * whether it is a magic art (the Magic tab) or a technique (the Powers tab).
 */
const SKILL_ACTIONS: Readonly<Record<string, [name: string, magic: boolean]>> = {
  'Use Necromancy': ['Necromancy', true],
  'Cast a thaumaturgy spell': ['Thaumaturgy', true],
  'Use Geomancy': ['Geomancy', true],
  'Cast a druidistic spell': ['Druidistic magic', true],
  'Use Mindcraft': ['Mindcraft', true],
  'Use antimagic': ['Antimagic', true],
  'Copy a spell': ['Copy a spell', true],
  'Use symbiotic powers': ['Symbiosis', false],
  'Use Mimicry': ['Mimicry', false],
  'Use the possession skill': ['Possession', false],
  'Manipulate totems': ['Totems', false],
  'Fire piercing shots': ['Piercing shots', false],
  'Far reaching attack': ['Far-reaching attack', false],
  'Activate touch of death': ['Touch of death', false],
  'Tear down a wall to create boulders': ['Make boulders', false],
  'Change melee mode': ['Change melee mode', false],
  'Check dodge chance': ['Check dodge chance', false],
  'Forge ammo': ['Forge ammo', false],
  'Turn pet into companion': ['Make a pet a companion', false],
};

/** A name as the player sees it, with a capital first letter (tome2 names most powers in lower case: "blink"). */
export function displayName(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : name;
}

/** What a "use a skill" entry is called for the player ("Use Necromancy" → "Necromancy"). */
export function skillActionName(label: string): string {
  return SKILL_ACTIONS[label]?.[0] ?? displayName(label);
}

function isMagicArt(label: string): boolean {
  return SKILL_ACTIONS[label]?.[1] ?? false;
}

/** The "use a skill" entries that are magic arts: Necromancy, Mindcraft, Copy a spell… */
export function magicArts(spells: SpellState | null): SpellState['powers'] {
  return (spells?.powers ?? []).filter((p) => p.mkey !== MKEY_SCHOOL && isMagicArt(p.label));
}

/** The other "use a skill" entries: techniques such as Piercing shots, Mimicry or Forge ammo (Steal is More's). */
export function techniques(spells: SpellState | null): SpellState['powers'] {
  return (spells?.powers ?? []).filter((p) => p.mkey !== MKEY_SCHOOL && p.mkey !== MKEY_STEAL && !isMagicArt(p.label));
}

/** The hero has spells in their books or a magic art to use. */
export function hasMagic(spells: SpellState | null): boolean {
  return !!spells?.books.length || magicArts(spells).length > 0;
}

/** The hero has a power (from race, class, gear, corruption or form), an item to use as magic or a technique. */
export function hasPowers(spells: SpellState | null): boolean {
  return !!spells?.bonus.length || !!spells?.items.length || techniques(spells).length > 0;
}

/* Techniques that only check or switch something, not worth a toolbar button of their own. */
const MINOR_TECHNIQUES: ReadonlySet<string> = new Set(['Check dodge chance', 'Change melee mode']);

/** The hero has a power, an item to use as magic, or a technique that acts (not only a check or a switch), worth the toolbar's Powers button. */
export function hasActivePowers(spells: SpellState | null): boolean {
  return !!spells?.bonus.length || !!spells?.items.length || techniques(spells).some((t) => !MINOR_TECHNIQUES.has(t.label));
}

/*
 * Item commands that use an item as magic: activate it, aim a wand, use a
 * staff, zap a rod. Its kind does not say what it does (an ego's or
 * artifact's activation, a rod's tip, the spell of a wand or staff), so its
 * name must match too.
 */
const MAGIC_ITEM_COMMANDS: ReadonlySet<string> = new Set(['A', 'a', 'u', 'z']);

/** A spell, a power or an item used as magic: what the Magic panel's Recent offers, and the quick repeat of a hero who uses magic. */
export function isAbility(entry: RecentAction): boolean {
  return entry.kind !== 'item' || MAGIC_ITEM_COMMANDS.has(entry.command);
}

export function recentKey(entry: RecentAction): string {
  switch (entry.kind) {
    case 'spell':
      return `spell:${entry.name}`;
    case 'path':
      return `path:${entry.command}:${entry.steps.join('/')}`;
    case 'item':
      return `item:${entry.command}:${entry.tval}:${entry.sval}${MAGIC_ITEM_COMMANDS.has(entry.command) ? `:${entry.name}` : ''}`;
  }
}

/** Entries from storage that this version understands. */
export function validRecent(entry: unknown): entry is RecentAction {
  const e = entry as RecentAction | null;
  if (!e || typeof e !== 'object') return false;
  if (e.kind === 'spell') return typeof e.name === 'string';
  if (e.kind === 'path') return (e.command === 'm' || e.command === 'U') && Array.isArray(e.steps) && e.steps.length > 0;
  if (e.kind === 'item') return typeof e.command === 'string' && typeof e.tval === 'number' && typeof e.sval === 'number' && typeof e.name === 'string';
  return false;
}

/**
 * The list with `entry` moved (or added) to the front, keeping at most `max`
 * of each kind. Once aimed, it stays so: a use that failed before tome2 asked
 * where says nothing of it.
 */
export function rememberRecent(list: readonly RecentAction[], entry: RecentAction, max = MAX_RECENT): RecentAction[] {
  const key = recentKey(entry);
  const aimed = entry.aimed || list.some((e) => recentKey(e) === key && e.aimed);
  const next = [{ ...entry, ...(aimed ? { aimed } : {}) }, ...list.filter((e) => recentKey(e) !== key)];
  const counts = new Map<string, number>();
  return next.filter((e) => {
    const group = isAbility(e) ? 'magic' : 'item';
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
    case 'path': {
      const last = namedSteps(entry.steps).at(-1) ?? entry.steps[0];
      return last === entry.steps[0] && entry.command === 'm' ? skillActionName(last) : displayName(last);
    }
    case 'item':
      return entry.name;
  }
}

/** A second line for a recent menu path: where it comes from. */
export function recentSource(entry: Extract<RecentAction, { kind: 'path' }>): string {
  const named = namedSteps(entry.steps);
  if (named.length > 1) return entry.command === 'm' ? skillActionName(named[0]) : displayName(named[0]);
  return entry.command === 'U' ? 'Power' : isMagicArt(entry.steps[0]) ? 'Magic' : 'Technique';
}

type ItemRecent = Extract<RecentAction, { kind: 'item' }>;
type Carried = Pick<InventoryState, 'pack' | 'equip'>;

/** Using an item again: `command` with `verb` (its button's label) on this item. */
export function itemRecent(command: string, verb: string, item: ItemKind): ItemRecent {
  return { kind: 'item', command, verb, tval: item.tval, sval: item.sval ?? -1, name: item.base, i: item.i };
}

/**
 * The item a recent item action refers to and where it is, if still carried
 * (an activation also where it is worn, the worn one first): the one at its
 * last place when that is still it, else the first of its kind.
 */
export function recentItem(entry: ItemRecent, carried: Carried): { item: ItemState; place: ItemPlace } | null {
  const named = MAGIC_ITEM_COMMANDS.has(entry.command);
  const fits = (i: Partial<ItemKind>) => i.tval === entry.tval && (i.sval ?? -1) === entry.sval && (!named || i.base === entry.name);
  const worn = entry.command === 'A' ? carried.equip.filter((slot): slot is typeof slot & ItemState => !slot.empty && !!slot.name && fits(slot)) : [];
  const found = [...worn, ...carried.pack.filter(fits)];
  const item = found.find((i) => i.i === entry.i) ?? found[0];
  return item ? { item, place: item.i >= INVEN_WIELD ? 'equip' : 'pack' } : null;
}

/** The item action a recent item entry repeats (its use, an activation or a throw). */
export function recentItemAction(entry: ItemRecent, item: Pick<ItemState, 'tval'>): ItemAction | null {
  if (entry.command === 'v') return { id: 'throw', label: 'Throw', command: 'v', quantity: 'one' };
  if (entry.command === 'A') return { id: 'activate', label: 'Activate', command: 'A' };
  const use = useAction(item.tval);
  return use && use.command === entry.command ? use : null;
}

/** How the hero can use an item as magic now, for a recent item action that is one (`web_spells_json`'s items). */
export function recentMagicItem(entry: ItemRecent, spells: SpellState | null, carried: Carried): MagicItem | null {
  if (!MAGIC_ITEM_COMMANDS.has(entry.command)) return null;
  const found = recentItem(entry, carried);
  return (found && spells?.items.find((m) => m.i === found.item.i && m.command === entry.command)) ?? null;
}

/** Whether a recent action can be had now: the spell is in a book carried, the skill or power is known, the item is carried (and usable as magic, when used so). */
function recentUsable(entry: RecentAction, spells: SpellState | null, carried: Carried): boolean {
  if (entry.kind === 'spell') return !!spells?.books.some((b) => b.spells.some((s) => s.ok && s.name === entry.name));
  if (entry.kind === 'path' && entry.command === 'm') return !!spells?.powers.some((p) => p.label === entry.steps[0]);
  if (entry.kind === 'path') return !!spells?.bonus.some((p) => p.name === entry.steps[0]);
  if (MAGIC_ITEM_COMMANDS.has(entry.command)) return !!recentMagicItem(entry, spells, carried);
  const found = recentItem(entry, carried);
  return !!found && !!recentItemAction(entry, found.item);
}

/** Spells, powers and items used as magic recently that the hero still has. */
export function usableRecents(recents: readonly RecentAction[], spells: SpellState | null, carried: Carried): RecentAction[] {
  return recents.filter((e) => isAbility(e) && recentUsable(e, spells, carried));
}

/**
 * Why an item cannot be used as magic now, as tome2 would refuse it or spend
 * a turn for nothing: worn only, no charges, recharging. `name` is what the
 * player calls it.
 */
export function magicItemRefusal(item: MagicItem, name: string): string | null {
  if (item.wear) return `Wear the ${name} to activate it.`;
  if (item.charges === 0) return `The ${name} has no charges left.`;
  if (item.charging) return `The ${name} is still ${item.command === 'A' ? 'recharging' : 'charging'}.`;
  return null;
}

/**
 * The toolbar's quick repeat. For a hero who uses magic, the last spell,
 * power or item used as magic that can be used again, or before any, the
 * first spell in their books (or their first race or class power); for
 * others, the last aimed thing they did that can be done again (a wand or
 * rod, an activation, a thrown flask, a power).
 */
export function quickRecent(
  recent: readonly RecentAction[],
  spells: SpellState | null,
  carried: Carried,
  usesMagic: boolean,
  level: number,
): RecentAction | null {
  const usable = (e: RecentAction) => recentUsable(e, spells, carried);
  if (usesMagic) {
    const magic = recent.find((e) => isAbility(e) && usable(e));
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
 * the spell (tome2 would only let it be tried at great risk), an item that
 * cannot be used as magic now (`magicItemRefusal`), or, for the toolbar's
 * one tap (`needTarget`), nothing in sight to aim it at.
 */
export function recentBlocked(
  entry: RecentAction,
  spells: SpellState | null,
  carried: Carried,
  needTarget: boolean,
  targetInSight: boolean,
): string | null {
  if (entry.kind === 'spell') {
    const spell = spells?.books.flatMap((b) => b.spells).find((s) => s.name === entry.name);
    if (spell?.short) return `Not enough ${spell.piety ? 'piety' : 'mana'} for ${entry.name}.`;
  }
  if (entry.kind === 'item') {
    const item = recentMagicItem(entry, spells, carried);
    const why = item ? magicItemRefusal(item, entry.name) : entry.command === 'z' && recentItem(entry, carried) ? `Attach a rod tip to the ${entry.name} first.` : null;
    if (why) return why;
  }
  if (needTarget && entry.aimed && !targetInSight) return NO_TARGET;
  return null;
}

interface MenuChoice {
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

const SKILL_PROMPT = /Select a skill \(/;
const POWER_MENU_PROMPT = /Select a power \(/;
const SPELL_PROMPT = /Cast which spell\?/;

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

/** When asked for a direction, aims if `aim` (the toolbar's one-tap attacks): at the target while tome2 still offers it, else at the nearest foe. */
function* aimIfAsked(s: MacroScreen, aim: boolean): Macro {
  if (aim && classifyPrompt(s.prompt) === 'aim') yield keyCodes(/'5' for target/.test(s.prompt) ? '5' : '*t');
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
 * taps on its lists and cards), and an item used from a button, and reports
 * what was done once tome2 asks for a direction or is back at the command
 * prompt, so it joins the recent list and is known to be aimed or not.
 */
export class CastWatcher {
  private command: 'm' | 'U' | null = null;
  private steps: string[] = [];
  private spell: string | null = null;
  private spellMode = false;
  /* An item being used from a button, reported (aimed or not) as a spell is. */
  private item: ItemRecent | null = null;

  /** The spell being cast, once it is known. */
  get casting(): string | null {
    return this.command && this.spellMode ? this.spell : null;
  }

  /** A command that opens tome2's menus was given (or a recent one is being replayed). */
  begin(command: 'm' | 'U', steps: readonly string[] = [], spell: string | null = null): void {
    this.item = null;
    this.command = command;
    this.steps = [...steps];
    this.spell = spell;
    this.spellMode = spell !== null;
  }

  /** An item is being used from a button. */
  useItem(entry: ItemRecent): void {
    this.command = null;
    this.item = entry;
  }

  /** Called with each single key the player sends and the screen it answers. */
  note(prompt: string, screen: string, key: number, atCommand: boolean): void {
    const ch = String.fromCharCode(key);
    if (atCommand) {
      if (ch === 'm' || ch === 'U') this.begin(ch);
      return;
    }
    if (key === KEY_ESCAPE) {
      this.command = null;
      this.item = null;
      return;
    }
    if (!this.command) return;
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
    if (!this.command && !this.item) return null;
    const kind = classifyPrompt(prompt);
    const aimed = kind === 'aim' || kind === 'direction';
    if (!aimed && !atCommand) return null;
    const { command, item } = this;
    this.command = null;
    this.item = null;
    if (item) return { ...item, aimed };
    if (this.spellMode) return this.spell ? { kind: 'spell', name: this.spell, aimed } : null;
    return command && this.steps.length ? { kind: 'path', command, steps: this.steps, aimed } : null;
  }
}
