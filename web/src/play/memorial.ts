import type { Chronicle } from './chronicle.ts';
import { isNotice, type CharacterState, type InventoryState, type MessageState, type MonsterState, type PlayerState, type ScoreEntry } from '../render/snapshot.ts';

/** Game turns in a day of Middle-earth (tome2's DAY at ten game turns a player turn). */
export const TURNS_PER_DAY = 115200;
/** The end of a run the player abandoned, as tome2's Hall of Fame records it (engine `web_mark_abandoned`). */
export const ABANDONED = 'Abandoned';
/** Messages kept from the hero's last moments. */
export const LAST_WORDS = 14;

export interface MemorialItem {
  name: string;
  /** Equipment slot, for worn items. */
  slot?: string;
  ch: number;
  colour: string;
  /** What the hero knew of it, as paragraphs. */
  text: string[];
}

export interface MemorialLine {
  text: string;
  colour: string;
}

export interface MemorialFoe {
  name: string;
  level: number;
  unique: boolean;
  ch: number;
  colour: string;
  /** The hero's recall of the creature, as runs of coloured text. */
  recall: MemorialLine[];
}

/** A fallen hero as they were at the end: kept so the Hall of Fame can show them again. */
export interface Memorial {
  name: string;
  race: string;
  cls: string;
  title: string;
  level: number;
  exp: number;
  gold: number;
  /** Game turn at death; matches the Hall of Fame entry. */
  turn: number;
  feet: number;
  place: string;
  cause: string;
  /** ISO date of the fall. */
  date: string;
  mhp: number;
  msp: number;
  speed: number;
  god: string;
  stats: { name: string; value: string }[];
  combat: { toHit: number; toDam: number; ac: number; toAc: number; blows: number; shots: number };
  skills: { name: string; value: number }[];
  abilities: string[];
  equipment: MemorialItem[];
  pack: MemorialItem[];
  /** Messages before the end, oldest first. */
  lastWords: MemorialLine[];
  foe: MemorialFoe | null;
  /** The hero's chronicle at the end. */
  tale?: Chronicle;
}

/** Strips a leading article so "a Cave spider" matches the creature "Cave spider". */
export function bareName(name: string): string {
  return name.replace(/^(a|an|the|some)\s+/i, '').trim().toLowerCase();
}

/** The creature in sight whose name matches what killed the hero, nearest first. */
export function findKiller(cause: string, monsters: readonly MonsterState[], px: number, py: number): MonsterState | null {
  const wanted = bareName(cause);
  if (!wanted) return null;
  const matches = monsters.filter((m) => bareName(m.name) === wanted);
  matches.sort((a, b) => Math.max(Math.abs(a.x - px), Math.abs(a.y - py)) - Math.max(Math.abs(b.x - px), Math.abs(b.y - py)));
  return matches[0] ?? null;
}

/** tome2's last messages before the end, oldest first, without blank or repeated filler lines. */
export function lastWords(messages: readonly MessageState[], palette: readonly string[], count = LAST_WORDS): MemorialLine[] {
  return messages
    .filter((m) => !isNotice(m) && /[^\s=\-_~*]/.test(m.text))
    .slice(0, count)
    .reverse()
    .map((m) => ({ text: m.text, colour: palette[m.color] ?? '' }));
}

/** "Day 12" of the hero's adventure, from the game turn. */
export function dayOf(turn: number): number {
  return Math.floor(Math.max(0, turn) / TURNS_PER_DAY) + 1;
}

/** The Hall of Fame entry this memorial belongs to. */
export function memorialKey(hero: { name: string; turn: number }): string {
  return `${hero.name}@${hero.turn}`;
}

export function entryKey(entry: Pick<ScoreEntry, 'name' | 'turns'>): string {
  return `${entry.name}@${entry.turns}`;
}

/** Skill values as tome2 shows them: thousandths to "12.345". */
export function skillValue(value: number): string {
  const sign = value < 0 ? '−' : '';
  const v = Math.abs(value);
  return `${sign}${Math.floor(v / 1000)}.${String(v % 1000).padStart(3, '0')}`;
}

export interface MemorialSources {
  player: PlayerState;
  character: CharacterState | null;
  inventory: InventoryState | null;
  messages: readonly MessageState[];
  monsters: readonly MonsterState[];
  px: number;
  py: number;
  turn: number;
  place: string;
  palette: readonly string[];
  slotName(part: number): string;
  describe(item: number): string[];
  recall(monster: MonsterState): MemorialLine[];
  now?: Date;
}

/** Gathers everything worth remembering about a hero who has just fallen. */
export function buildMemorial(s: MemorialSources): Memorial {
  const p = s.player;
  const c = s.character;
  const colour = (attr: number) => s.palette[attr] ?? '#fff';
  const item = (i: { i: number; name: string; ch: number; attr: number }, slot?: string): MemorialItem => ({
    name: i.name,
    slot,
    ch: i.ch,
    colour: colour(i.attr),
    text: s.describe(i.i),
  });
  const equipment: MemorialItem[] = [];
  for (const slot of s.inventory?.equip ?? []) {
    if (slot.empty || !slot.name || slot.ch === undefined || slot.attr === undefined) continue;
    equipment.push(item({ i: slot.i, name: slot.name, ch: slot.ch, attr: slot.attr }, s.slotName(slot.part)));
  }
  const cause = p.diedFrom ?? '';
  const killer = findKiller(cause, s.monsters, s.px, s.py);
  return {
    name: p.name,
    race: p.race,
    cls: p.cls,
    title: p.title ?? '',
    level: p.lev,
    exp: p.exp,
    gold: p.au,
    turn: s.turn,
    feet: p.wild ? 0 : p.depth * 50,
    place: s.place,
    cause,
    date: (s.now ?? new Date()).toISOString(),
    mhp: p.mhp,
    msp: p.msp,
    speed: p.speed,
    god: c?.god ?? '',
    stats: (c?.stats ?? []).map((st) => ({ name: st.name, value: st.use.trim() })),
    combat: {
      toHit: c?.toHit ?? 0,
      toDam: c?.toDam ?? 0,
      ac: c?.ac ?? 0,
      toAc: c?.toAc ?? 0,
      blows: c?.blows ?? 0,
      shots: c?.shots ?? 0,
    },
    skills: [...(c?.skills ?? [])].sort((a, b) => b.value - a.value),
    abilities: [...(c?.abilities ?? [])],
    equipment,
    pack: (s.inventory?.pack ?? []).map((i) => item(i)),
    lastWords: lastWords(s.messages, s.palette),
    foe: killer
      ? {
          name: killer.name,
          level: killer.level ?? 0,
          unique: !!killer.unique,
          ch: killer.ch,
          colour: colour(killer.attr),
          recall: s.recall(killer),
        }
      : null,
  };
}
