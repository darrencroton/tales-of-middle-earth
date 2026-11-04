/** tome2's monster statuses on the hero's side (MSTATUS_FRIEND, _PET, _COMPANION). */
export const FRIEND = 2;
export const PET = 3;
export const COMPANION = 4;

/** One creature on the hero's side (`web_companions_json`). */
export interface Companion {
  /** Its monster index, and its race's (for its recall). */
  id: number;
  r: number;
  name: string;
  ch: number;
  attr: number;
  status: number;
  unique: number;
  level: number;
  hp: number;
  maxhp: number;
  x: number;
  y: number;
  /** Steps from the hero. */
  dist: number;
  /** The hero can see it. */
  seen: number;
  asleep: number;
  /** It cannot die, so cannot be dismissed (RF_NO_DEATH). */
  stays: number;
  /** It is set on a creature; `target` names it when the hero can see that one. */
  hunting?: number;
  target?: string;
}

/** How far the hero's creatures stray (tome2's pet_follow_distance), as `P` sets it. */
export type Leash = 1 | 6 | 255;

/** The hero's creatures on this level and the orders they follow. */
export interface Companions {
  follow: number;
  doors: number;
  pickup: number;
  /** How much the hero's pets slow the return of mana, in percent (none while they are few). */
  upkeep: number;
  list: Companion[];
}

export const LEASHES: readonly [Leash, string][] = [
  [1, 'Stay close'],
  [6, 'Follow me'],
  [255, 'Seek and destroy'],
];

/** What a creature is to the hero: a companion stays with them from level to level, a pet stays behind, an ally helps for now. */
export function bondName(c: Pick<Companion, 'status'>): string {
  return c.status >= COMPANION ? 'Companion' : c.status >= PET ? 'Pet' : 'Ally';
}

/** The list as the player reads it: companions, then pets, then allies, each nearest first. */
export function companionOrder(list: readonly Companion[]): Companion[] {
  return [...list].sort((a, b) => b.status - a.status || a.dist - b.dist || a.id - b.id);
}

/** Why the hero cannot give orders now (tome2 refuses while confused), or null. */
export function orderRefusal(confused: boolean): string | null {
  return confused ? 'You are too confused to give orders.' : null;
}

/** The panel's subtitle: how many are with the hero. */
export function companionsLine(list: readonly Companion[]): string {
  return list.length === 0 ? 'No one with you' : `${list.length} with you`;
}
