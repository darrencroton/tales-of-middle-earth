/**
 * Merging the files every hero shares (the savefile index, the Hall of Fame,
 * the title details, the chronicle and map memory) from this device's copy and
 * another device's (`remote`), as a hero arrives: what belongs to a hero
 * follows the copy chosen for them (`Winner`); the rest is combined.
 */
import { saveBase } from './adventurers.ts';
import type { Career } from './chronicle.ts';

/** Whose copy of a hero is kept: this device's, the other's, or null to combine it as anything else. */
export type Winner = (base: string) => 'local' | 'remote' | null;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges records by key: a key `pick` names a side for takes that side's
 * value (or its absence); otherwise a key on one side is kept, and one that
 * differs on both is settled by `resolve`. Keys keep the local order, then the
 * other side's new ones.
 */
function mergeRecords<T>(
  local: Record<string, T>,
  remote: Record<string, T>,
  resolve: (local: T, remote: T) => T,
  pick: (key: string) => 'local' | 'remote' | null = () => null,
): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = Object.hasOwn(local, key) ? local[key] : undefined;
    const r = Object.hasOwn(remote, key) ? remote[key] : undefined;
    const side = pick(key);
    const value = side ? (side === 'remote' ? r : l) : l === undefined ? r : r === undefined || same(l, r) ? l : resolve(l, r);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = JSON.parse(decoder.decode(bytes)) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dict<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

function toBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/** The savefile name a hero entry is kept under: the name itself, or `Name#seed` in map memory. */
function heroBase(key: string): string {
  const hash = key.lastIndexOf('#');
  return saveBase(hash > 0 ? key.slice(0, hash) : key);
}

/** Merges a JSON store whose `heroes` are by hero (title details, map memory); its other fields come from this device's copy. */
function mergeHeroStore(local: Uint8Array, remote: Uint8Array, winner: Winner, resolve: (l: unknown, r: unknown) => unknown): Uint8Array {
  const l = parseJson(local);
  const r = parseJson(remote);
  if (!l || !r) return l ? local : remote;
  const heroes = mergeRecords(dict(l.heroes), dict(r.heroes), resolve, (key) => winner(heroBase(key)));
  return toBytes({ ...r, ...l, heroes });
}

/** Title details (`adventurers.json`): a hero's entry follows the copy chosen, else the one saved last. */
export function mergeAdventurers(local: Uint8Array, remote: Uint8Array, winner: Winner): Uint8Array {
  const saved = (v: unknown) => String((v as { saved?: unknown }).saved ?? '');
  return mergeHeroStore(local, remote, winner, (l, r) => (saved(r) > saved(l) ? r : l));
}

/** Map memory (`mapmemory.json`): a hero's memory follows the copy chosen, else this device's. */
export function mergeMapMemory(local: Uint8Array, remote: Uint8Array, winner: Winner): Uint8Array {
  return mergeHeroStore(local, remote, winner, (l) => l);
}

/** How each field of the career is combined: counts and bests take the higher (both may hold the same history), flags either. */
const CAREER: Record<keyof Career, 'higher' | 'either'> = {
  heroes: 'higher',
  fallen: 'higher',
  kills: 'higher',
  uniques: 'higher',
  closeCalls: 'higher',
  deepestFeet: 'higher',
  bestLevel: 'higher',
  bestStreak: 'higher',
  worldMap: 'either',
};

function mergeCareer(local: Record<string, unknown>, remote: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...remote, ...local };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const [key, rule] of Object.entries(CAREER)) out[key] = rule === 'either' ? !!local[key] || !!remote[key] : Math.max(num(local[key]), num(remote[key]));
  return out;
}

/** The chronicle (`chronicle.json`): the career combined, deeds kept from when first earned, a hero's tale following the copy chosen, the fallen from both. */
export function mergeChronicle(local: Uint8Array, remote: Uint8Array, winner: Winner): Uint8Array {
  const l = parseJson(local);
  const r = parseJson(remote);
  if (!l || !r) return l ? local : remote;
  const deeds = mergeRecords(dict<string>(l.deeds), dict<string>(r.deeds), (lv, rv) => (lv < rv ? lv : rv));
  const heroes = mergeRecords(dict(l.heroes), dict(r.heroes), (lv) => lv, (key) => winner(saveBase(key)));
  const memorials = mergeRecords(dict(l.memorials), dict(r.memorials), (lv) => lv);
  return toBytes({ ...r, ...l, career: mergeCareer(dict(l.career), dict(r.career)), deeds, heroes, memorials });
}

/** The savefile a line of tome2's index (`global.svg`: "module@1base@description") is for, or null. */
function indexBase(line: string): string | null {
  return /^(?:[^@]*@)?[01]([^@]*)@/.exec(line.trim())?.[1] ?? null;
}

function indexLines(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const line of decoder.decode(bytes).split('\n')) {
    const key = indexBase(line);
    if (key !== null && !Object.hasOwn(out, key)) out[key] = line.trim();
  }
  return out;
}

/**
 * tome2's savefile index: a hero's line follows the copy chosen, else this
 * device's. The title offers to continue the hero of the first line, so the
 * lines are ordered by when each hero was last saved (`recency`, newest
 * first); heroes without a time keep their place after them.
 */
export function mergeSaveIndex(local: Uint8Array, remote: Uint8Array, winner: Winner, recency: (base: string) => number): Uint8Array {
  const lines = mergeRecords(indexLines(local), indexLines(remote), (lv) => lv, winner);
  const order = Object.keys(lines).map((key, at) => ({ key, at, time: recency(key) }));
  order.sort((a, b) => b.time - a.time || a.at - b.at);
  const text = order.map((o) => lines[o.key]).join('\n');
  return encoder.encode(text ? `${text}\n` : '');
}

/** Bytes of one entry of tome2's `scores.raw` (struct high_score). */
export const SCORE_RECORD = 148;
const MAX_SCORES = 100;
/** Where the score (`pts`, ten characters) sits in a record, after `what[8]`. */
const POINTS_AT = 8;

function scoreRecords(bytes: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = Object.create(null);
  for (let at = 0; at + SCORE_RECORD <= bytes.length; at += SCORE_RECORD) {
    const record = bytes.slice(at, at + SCORE_RECORD);
    out[Array.from(record, (b) => b.toString(16).padStart(2, '0')).join('')] = record;
  }
  return out;
}

function points(record: Uint8Array): number {
  return parseInt(decoder.decode(record.subarray(POINTS_AT, POINTS_AT + 10)).replace(/\0.*$/, '').trim(), 10) || 0;
}

/** tome2's Hall of Fame (`scores.raw`): every entry from both, each once, best first as tome2 keeps them. */
export function mergeScores(local: Uint8Array, remote: Uint8Array): Uint8Array {
  const records = Object.values(mergeRecords(scoreRecords(local), scoreRecords(remote), (lv) => lv));
  records.sort((a, b) => points(b) - points(a));
  const kept = records.slice(0, MAX_SCORES);
  const out = new Uint8Array(kept.length * SCORE_RECORD);
  kept.forEach((record, i) => out.set(record, i * SCORE_RECORD));
  return out;
}
