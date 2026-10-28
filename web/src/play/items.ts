import { KEY_BACKSLASH as BACKSLASH, KEY_ENTER as ENTER, keyCodes, typedAnswer } from '../input/keys.ts';
import type { InventoryState, ItemState } from '../render/snapshot.ts';
import { pickupCommand } from './actions.ts';
import type { Macro, MacroScreen } from './macro.ts';

export type ItemPlace = 'pack' | 'equip' | 'floor';

export interface ItemAction {
  id: string;
  label: string;
  /** Original-keyset command, sent after '\' so keymaps cannot interfere. */
  command: string;
  primary?: boolean;
  /** Answer to a quantity prompt: one item, the whole stack, a number, or (for a stack) a number the player picks first. */
  quantity?: 'one' | 'all' | 'ask' | number;
  /** Needs text (an inscription) from the player first. */
  needsText?: boolean;
  danger?: boolean;
  /** Shows a tome2 screen to read; the item sheet reopens when it closes. */
  reading?: boolean;
}

export const INVEN_WIELD = 24;

export const TV = {
  PARCHMENT: 8,
  CORPSE: 9,
  SHOT: 16,
  ARROW: 17,
  BOLT: 18,
  BOW: 19,
  LITE: 39,
  STAFF: 55,
  WAND: 65,
  ROD_MAIN: 67,
  SCROLL: 70,
  POTION: 71,
  POTION2: 72,
  FLASK: 77,
  FOOD: 80,
  BOOK: 111,
} as const;

/* Mage staffs, boomerangs, launchers, diggers and melee weapons. */
const WEAPON_TVALS = new Set([6, 15, 19, 20, 21, 22, 23, 24]);

/** Equipment index of the light source slot. */
export const INVEN_LITE = 36;
/** Equipment indexes of the launcher and the quiver. */
export const INVEN_BOW = 27;
export const INVEN_AMMO = 50;

/** Equipment slot groups, keyed by their first inventory index. */
export const SLOT_NAMES: Readonly<Record<number, string>> = {
  24: 'Weapon',
  27: 'Launcher',
  28: 'Ring',
  34: 'Neck',
  36: 'Light',
  37: 'Body',
  38: 'Cloak',
  39: 'Shield',
  42: 'Head',
  44: 'Hands',
  47: 'Feet',
  49: 'Carried',
  50: 'Quiver',
  51: 'Tool',
};

/** The main "use" action for an item, by its type. */
export function useAction(tval: number): ItemAction | null {
  switch (tval) {
    case TV.FOOD:
    case TV.CORPSE:
      return { id: 'eat', label: 'Eat', command: 'E' };
    case TV.POTION:
    case TV.POTION2:
      return { id: 'quaff', label: 'Quaff', command: 'q' };
    case TV.SCROLL:
      return { id: 'read', label: 'Read', command: 'r' };
    case TV.PARCHMENT:
      return { id: 'read', label: 'Read', command: 'r', reading: true };
    case TV.WAND:
      return { id: 'aim', label: 'Aim', command: 'a' };
    case TV.STAFF:
      return { id: 'use', label: 'Use', command: 'u' };
    case TV.ROD_MAIN:
      return { id: 'zap', label: 'Zap', command: 'z' };
    case TV.BOOK:
      return { id: 'browse', label: 'Browse', command: 'b', reading: true };
    case TV.FLASK:
      return { id: 'refuel', label: 'Refuel light', command: 'F' };
    case TV.SHOT:
    case TV.ARROW:
    case TV.BOLT:
      return { id: 'fire', label: 'Fire', command: 'f' };
    default:
      return null;
  }
}

/** Actions offered for an item, most likely first. */
export function itemActions(item: ItemState, place: ItemPlace): ItemAction[] {
  const actions: ItemAction[] = [];
  const use = useAction(item.tval);

  if (place === 'floor') {
    actions.push({ id: 'pickup', label: 'Pick up', command: 'g', primary: true });
    if (use && use.id !== 'fire' && use.id !== 'refuel') actions.push(use);
    return actions;
  }

  if (place === 'equip') {
    if (item.activate) actions.push({ id: 'activate', label: 'Activate', command: 'A', primary: true });
    if (use?.id === 'fire') actions.push({ ...use, primary: actions.length === 0 });
    actions.push({ id: 'takeoff', label: 'Take off', command: 't', primary: actions.length === 0 });
    actions.push({ id: 'drop', label: 'Drop', command: 'd', quantity: item.number > 1 ? 'ask' : 'all' });
    actions.push({ id: 'inscribe', label: 'Inscribe', command: '{', needsText: true });
    return actions;
  }

  if (use) actions.push({ ...use, primary: true });
  if (item.tval === TV.BOOK) actions.push({ id: 'cast', label: 'Cast a spell', command: 'm' });
  if (item.wear) {
    const weapon = WEAPON_TVALS.has(item.tval);
    actions.push({ id: 'wear', label: weapon ? 'Wield' : 'Wear', command: 'w', primary: actions.length === 0 });
  }
  if (item.tval === TV.FLASK || (use?.id === 'fire')) actions.push({ id: 'throw', label: 'Throw', command: 'v', quantity: 'one' });
  actions.push({ id: 'drop', label: 'Drop', command: 'd', quantity: item.number > 1 ? 'ask' : 'all' });
  if (item.tval !== TV.FLASK && use?.id !== 'fire') actions.push({ id: 'throw', label: 'Throw', command: 'v', quantity: 'one' });
  actions.push({ id: 'inscribe', label: 'Inscribe', command: '{', needsText: true });
  actions.push({ id: 'destroy', label: 'Destroy', command: 'k', quantity: item.number > 1 ? 'ask' : 'all', danger: true });
  return actions;
}

/** The number to answer a quantity prompt with; a choice not yet made counts as the whole stack. */
export function quantityAnswer(quantity: ItemAction['quantity'], stack: number): number {
  if (typeof quantity === 'number') return Math.max(1, Math.min(stack, Math.round(quantity)));
  return quantity === 'one' ? 1 : Math.max(1, stack);
}

/** Menu letter tome2 uses for an inventory or equipment index. */
export function itemLetter(index: number): string {
  return String.fromCharCode(97 + (index >= INVEN_WIELD ? index - INVEN_WIELD : index));
}

const ITEM_PROMPT = /^\((Inven|Equip|Floor):/;

/** Letter of the listed item whose name matches (exactly, else by prefix), from a menu shown on screen; floor lists carry no symbol. */
export function findListedItem(screen: string, name: string): string | null {
  const wanted = name.toLowerCase();
  const listed: [string, string][] = [];
  for (const line of screen.split('\n')) {
    const m = /(?:^|\s)([a-z])\) (?:[^\w\s] )?(.*?)\s*(?:\d+\.\d lb)?\s*$/.exec(line);
    if (m) listed.push([m[1], m[2].toLowerCase()]);
  }
  const exact = listed.find(([, text]) => text === wanted);
  if (exact) return exact[0];
  const prefix = wanted.slice(0, Math.max(8, wanted.length - 4));
  return listed.find(([, text]) => text.startsWith(prefix))?.[0] ?? null;
}

/**
 * Runs an item command and answers tome2's prompts: picks the item from the
 * right list (switching between pack, equipment and floor as needed), then
 * answers quantity and inscription prompts. `alwaysPickup` mirrors tome2's
 * option, which swaps the meaning of its two pick-up keys.
 */
export function* itemMacro(action: ItemAction, item: ItemState, place: ItemPlace, text = '', alwaysPickup = false): Macro {
  const command = action.id === 'pickup' ? pickupCommand(alwaysPickup) : action.command;
  let s: MacroScreen = yield [BACKSLASH, ...keyCodes(command)];
  const want = place === 'pack' ? 'Inven' : place === 'equip' ? 'Equip' : 'Floor';

  for (let tries = 0; tries < 3; tries++) {
    const mode = ITEM_PROMPT.exec(s.prompt)?.[1];
    if (!mode) {
      if (action.id === 'pickup' && s.atCommand) return;
      if (action.id === 'pickup') break;
      return;
    }
    if (mode !== want) {
      if (want === 'Floor') {
        if (!/- for floor/.test(s.prompt)) return;
        s = yield keyCodes('-');
      } else {
        if (!/\/ for (Inven|Equip)/.test(s.prompt)) return;
        s = yield keyCodes('/');
      }
      continue;
    }
    const letter = place === 'floor' ? findListedItem(s.screen, item.name) : itemLetter(item.i);
    if (!letter) return;
    s = yield keyCodes(letter);
    break;
  }

  for (let follow = 0; follow < 3; follow++) {
    if (/Quantity/i.test(s.prompt)) {
      s = yield [...keyCodes(String(quantityAnswer(action.quantity, item.number))), ENTER];
    } else if (action.needsText && /Inscri/i.test(s.prompt)) {
      s = yield typedAnswer(text, item.ins);
    } else {
      return;
    }
  }
}

export interface GearSuggestion {
  kind: 'weapon' | 'light' | 'heal' | 'eat';
  item: ItemState;
}

export interface Situation {
  /** Below the town, where a light is needed. */
  inDungeon: boolean;
  /** Health under half. */
  hurt: boolean;
  hungry: boolean;
  /** The hero fights with weapons, so an empty weapon hand is worth filling. */
  wieldsWeapons?: boolean;
}

const HEALING = /Cure (Light|Serious|Critical) Wounds|\bHealing\b|\bof Life\b/i;

/**
 * The most useful thing to do with the pack right now: drink a known
 * healing potion when hurt, eat when hungry, wield a weapon when none is
 * wielded (for heroes who fight with weapons), or (below the town) light a light source.
 */
export function suggestedGear(inventory: Pick<InventoryState, 'pack' | 'equip'>, situation: Situation): GearSuggestion | null {
  const equipped = (index: number) => inventory.equip.some((slot) => slot.i === index && slot.name);
  const find = (kind: GearSuggestion['kind'], test: (item: ItemState) => boolean): GearSuggestion | null => {
    const item = inventory.pack.find(test);
    return item ? { kind, item } : null;
  };
  return (
    (situation.hurt ? find('heal', (i) => (i.tval === TV.POTION || i.tval === TV.POTION2) && HEALING.test(i.name)) : null) ??
    (situation.hungry ? find('eat', (i) => i.tval === TV.FOOD) : null) ??
    (situation.wieldsWeapons !== false && !equipped(INVEN_WIELD) ? find('weapon', (i) => WEAPON_TVALS.has(i.tval)) : null) ??
    (situation.inDungeon && !equipped(INVEN_LITE) ? find('light', (i) => i.tval === TV.LITE) : null)
  );
}

/** How the hero fights: with weapons, with magic and powers, or both. */
export interface FightingStyle {
  weapons: boolean;
  magic: boolean;
}

const WEAPON_SKILLS = new Set(['Combat', 'Weaponmastery', 'Sword-mastery', 'Axe-mastery', 'Polearm-mastery', 'Hafted-mastery', 'Backstab']);
const UNARMED_SKILLS = new Set(['Barehand-combat', 'Bearform-combat']);
const MAGIC_SKILLS = new Set([
  'Magic',
  'Sorcery',
  'Spell-power',
  'Necromancy',
  'Thaumaturgy',
  'Geomancy',
  'Udun',
  'Demonology',
  'Prayer',
  'Druidistic',
  'Mindcraft',
  'Music',
  'Summoning',
  'Possession',
  'Symbiosis',
  'Mimicry',
]);
/* Points a hero is expected to put into a skill they favour, to weigh growth against what is already learnt. */
const GROWTH_POINTS = 10;
/* Weapons count when they are at least this share of the hero's magic, and magic when it is this share of their fighting. */
const WEAPON_SHARE = 0.75;
const MAGIC_SHARE = 0.5;

/** Weighs the hero's weapon, unarmed and magic skills (value plus expected growth); a hero with no skills read yet does both. */
export function fightingStyle(skills: readonly { name: string; value: number; mod?: number }[] | null | undefined): FightingStyle {
  if (!skills?.length) return { weapons: true, magic: true };
  const best = (names: ReadonlySet<string>) =>
    Math.max(0, ...skills.filter((s) => names.has(s.name)).map((s) => s.value + (s.mod ?? 0) * GROWTH_POINTS));
  const weapons = best(WEAPON_SKILLS);
  const unarmed = best(UNARMED_SKILLS);
  const magic = best(MAGIC_SKILLS);
  const fighting = Math.max(weapons, unarmed);
  return {
    weapons: weapons > 0 && weapons >= unarmed && weapons >= magic * WEAPON_SHARE,
    magic: magic > 0 && magic >= fighting * MAGIC_SHARE,
  };
}
