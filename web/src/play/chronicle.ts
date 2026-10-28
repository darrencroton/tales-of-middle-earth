import type { MessageState, MonsterState, PlayerState } from '../render/snapshot.ts';

/** A creature the hero has slain. */
export interface Slain {
  name: string;
  level: number;
  unique: boolean;
  ch: number;
  attr: number;
  x: number;
  y: number;
}

/** One hero's story so far. */
export interface Chronicle {
  name: string;
  kills: number;
  uniques: string[];
  deepestFeet: number;
  deepestPlace: string;
  /** The highest-level creature slain. */
  mightiest: { name: string; level: number } | null;
  peakLevel: number;
  peakGold: number;
  /** Health once fell below a tenth of the maximum. */
  nearDeath: boolean;
  /** Deeds earned by this hero, in order. */
  deeds: string[];
  /** The hero has died; the name may be taken again by a new hero. */
  fallen?: boolean;
}

/** Totals across every hero on this device. */
export interface Career {
  heroes: number;
  fallen: number;
  kills: number;
  uniques: number;
  deepestFeet: number;
  bestLevel: number;
  bestStreak: number;
  worldMap: boolean;
  closeCalls: number;
}

export interface Deed {
  id: string;
  title: string;
  text: string;
  earned(c: Chronicle, career: Career): boolean;
}

export const DEEDS: readonly Deed[] = [
  { id: 'first-blood', title: 'First blood', text: 'Slay your first creature.', earned: (c) => c.kills >= 1 },
  { id: 'hunter', title: 'Hunter', text: 'Slay 100 creatures, across all your heroes.', earned: (_, k) => k.kills >= 100 },
  { id: 'slayer', title: 'Slayer of hundreds', text: 'Slay 1,000 creatures, across all your heroes.', earned: (_, k) => k.kills >= 1000 },
  { id: 'giant-slayer', title: 'Giant-slayer', text: 'Slay a creature of legend.', earned: (c) => c.uniques.length >= 1 },
  { id: 'bane', title: 'Bane of legends', text: 'Slay 10 creatures of legend, across all your heroes.', earned: (_, k) => k.uniques >= 10 },
  { id: 'rampage', title: 'Rampage', text: 'Slay five creatures in quick succession.', earned: (_, k) => k.bestStreak >= 5 },
  { id: 'delver', title: 'Delver', text: 'Reach 500 ft below the surface.', earned: (c) => c.deepestFeet >= 500 },
  { id: 'deep', title: 'Into the deep', text: 'Reach 1,500 ft below the surface.', earned: (c) => c.deepestFeet >= 1500 },
  { id: 'abyss', title: 'The abyss', text: 'Reach 3,000 ft below the surface.', earned: (c) => c.deepestFeet >= 3000 },
  { id: 'seasoned', title: 'Seasoned', text: 'Reach level 10.', earned: (c) => c.peakLevel >= 10 },
  { id: 'hero', title: 'Hero of the age', text: 'Reach level 25.', earned: (c) => c.peakLevel >= 25 },
  { id: 'champion', title: 'Champion', text: 'Reach level 40.', earned: (c) => c.peakLevel >= 40 },
  { id: 'hoard', title: 'Dragon’s hoard', text: 'Carry 10,000 gold.', earned: (c) => c.peakGold >= 10000 },
  { id: 'close-call', title: 'Close call', text: 'Fall below a tenth of your health, and live.', earned: (_, k) => k.closeCalls >= 1 },
  { id: 'wanderer', title: 'Wanderer', text: 'Set out across the world map.', earned: (_, k) => k.worldMap },
];

const KILL_TEXT = /\b(slain|destroyed|killed|dies|dissolves|shatters)\b/i;

/** Creatures that vanished since the last state with a message saying they were killed. */
export function slainMonsters(
  before: readonly MonsterState[],
  after: readonly MonsterState[],
  freshMessages: readonly MessageState[],
): Slain[] {
  const still = new Set(after.map((m) => m.id));
  const texts = freshMessages.filter((m) => KILL_TEXT.test(m.text)).map((m) => m.text.toLowerCase());
  if (texts.length === 0) return [];
  return before
    .filter((m) => !still.has(m.id) && texts.some((t) => t.includes(m.name.toLowerCase())))
    .map((m) => ({ name: m.name, level: m.level ?? 0, unique: !!m.unique, ch: m.ch, attr: m.attr, x: m.x, y: m.y }));
}

/** Kills that follow each other within this many game turns (three moves at normal speed) make a streak. */
export const STREAK_TURNS = 30;

export interface Streak {
  count: number;
  lastTurn: number;
}

const STREAK_NAMES: Readonly<Record<number, string>> = { 2: 'Double kill', 3: 'Triple kill', 5: 'Rampage', 8: 'Unstoppable' };

/** Adds kills made on `turn` to a streak; `name` is set when the streak reaches a named length. */
export function extendStreak(streak: Streak, kills: number, turn: number): { streak: Streak; name: string | null } {
  if (kills <= 0) return { streak, name: null };
  const continues = streak.count > 0 && turn - streak.lastTurn <= STREAK_TURNS;
  const before = continues ? streak.count : 0;
  const count = before + kills;
  let name: string | null = null;
  for (const [at, label] of Object.entries(STREAK_NAMES)) {
    if (before < Number(at) && count >= Number(at)) name = label;
  }
  return { streak: { count, lastTurn: turn }, name };
}

export function newChronicle(name: string): Chronicle {
  return { name, kills: 0, uniques: [], deepestFeet: 0, deepestPlace: '', mightiest: null, peakLevel: 1, peakGold: 0, nearDeath: false, deeds: [] };
}

export function newCareer(): Career {
  return { heroes: 0, fallen: 0, kills: 0, uniques: 0, deepestFeet: 0, bestLevel: 0, bestStreak: 0, worldMap: false, closeCalls: 0 };
}

type Progress = Pick<PlayerState, 'lev' | 'au' | 'chp' | 'mhp' | 'depth' | 'dungeon' | 'wild'>;

/**
 * Folds the hero's current state and new kills into their chronicle and the
 * career; `hurt` is true when health fell since the last state.
 */
export function record(c: Chronicle, career: Career, player: Progress, slain: readonly Slain[], streak = 0, hurt = false): void {
  for (const s of slain) {
    c.kills++;
    career.kills++;
    if (s.unique && !c.uniques.includes(s.name)) {
      c.uniques.push(s.name);
      career.uniques++;
    }
    if (!c.mightiest || s.level > c.mightiest.level) c.mightiest = { name: s.name, level: s.level };
  }
  const feet = player.wild ? 0 : player.depth * 50;
  if (feet > c.deepestFeet) {
    c.deepestFeet = feet;
    c.deepestPlace = player.dungeon;
  }
  career.deepestFeet = Math.max(career.deepestFeet, feet);
  c.peakLevel = Math.max(c.peakLevel, player.lev);
  career.bestLevel = Math.max(career.bestLevel, player.lev);
  c.peakGold = Math.max(c.peakGold, player.au);
  career.bestStreak = Math.max(career.bestStreak, streak);
  if (player.wild) career.worldMap = true;
  if (hurt && player.mhp > 0 && player.chp > 0 && player.chp < player.mhp * 0.1) c.nearDeath = true;
  else if (c.nearDeath && player.mhp > 0 && player.chp >= player.mhp * 0.5) {
    c.nearDeath = false;
    career.closeCalls++;
  }
}

/** Deeds earned for the first time, given those already earned on this device. */
export function newDeeds(c: Chronicle, career: Career, earned: ReadonlySet<string>): Deed[] {
  return DEEDS.filter((d) => !earned.has(d.id) && d.earned(c, career));
}

/** One piece of advice for the next hero, from how this one fell. */
export function nextTimeTip(c: Chronicle, cause: string, depth: number): string {
  const how = cause.toLowerCase();
  if (/poison/.test(how)) return 'Poison keeps hurting after a fight: carry healing potions and quaff one before it wears you down.';
  if (/starvation|hunger/.test(how)) return 'Keep food in your pack, and eat when the toolbar offers Eat.';
  if (c.peakLevel < 5 && depth >= 4) return 'Take the first levels slowly: gain a few hero levels near the surface before going deeper.';
  if (/^[A-Z]/.test(cause) && !/^(A|An|The) /.test(cause)) {
    return 'Creatures of legend are far stronger than their kin. Press and hold one to read about it before you fight.';
  }
  if (depth === 0) return 'Even the town has its dangers. Rest to full health before you pick a fight.';
  return 'Rest to full health before going deeper, and keep a way out in mind when a fight turns.';
}
