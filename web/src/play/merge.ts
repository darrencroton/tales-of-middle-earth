/**
 * Bringing one hero's entries from another device's copy of the files every
 * hero shares (the savefile index, the title details, the chronicle and map
 * memory) into this device's, and combining what belongs to no hero alone
 * (the Hall of Fame, deeds, the career and the fallen remembered).
 */
import { saveBase } from './adventurers.ts';
import type { Career } from './chronicle.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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

/** Only the entries of `hero` (a savefile name), by key. */
function heroOnly<T>(records: Record<string, T>, hero: string): Record<string, T> {
  return Object.fromEntries(Object.entries(records).filter(([key]) => heroBase(key) === hero));
}

/** This device's entries with `hero`'s replaced by the other's, which go last (stores trim the earliest first). */
function withHero<T>(local: Record<string, T>, remote: Record<string, T>, hero: string): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const [key, value] of Object.entries(local)) if (heroBase(key) !== hero) out[key] = value;
  for (const [key, value] of Object.entries(remote)) if (heroBase(key) === hero) out[key] = value;
  return out;
}

/** Every key of both, this device's value kept where both have one. */
function union<T>(local: Record<string, T>, remote: Record<string, T>, both: (local: T, remote: T) => T = (l) => l): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const [key, value] of Object.entries(remote)) out[key] = value;
  for (const [key, value] of Object.entries(local)) out[key] = Object.hasOwn(remote, key) ? both(value, remote[key]) : value;
  return out;
}

/** A JSON store whose `heroes` are by hero (title details, map memory): `hero`'s entries from the other copy; its other fields from this device's. */
export function mergeHeroStore(local: Uint8Array, remote: Uint8Array, hero: string): Uint8Array {
  const l = parseJson(local);
  const r = parseJson(remote);
  if (!l || !r) return l ? local : remote;
  return toBytes({ ...r, ...l, heroes: withHero(dict(l.heroes), dict(r.heroes), hero) });
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

/** The chronicle (`chronicle.json`): `hero`'s tale from the other copy; the career combined, deeds kept from when first earned, the fallen remembered from both. */
export function mergeChronicle(local: Uint8Array, remote: Uint8Array, hero: string): Uint8Array {
  const l = parseJson(local);
  const r = parseJson(remote);
  if (!l || !r) return l ? local : remote;
  return toBytes({
    ...r,
    ...l,
    career: mergeCareer(dict(l.career), dict(r.career)),
    deeds: union(dict<string>(l.deeds), dict<string>(r.deeds), (lv, rv) => (rv < lv ? rv : lv)),
    heroes: withHero(dict(l.heroes), dict(r.heroes), hero),
    memorials: union(dict(l.memorials), dict(r.memorials)),
  });
}

/** A store whose `heroes` are by hero (title details, map memory, the chronicle) holding only `hero`'s. */
export function storeOf(bytes: Uint8Array, hero: string): Uint8Array {
  const value = parseJson(bytes);
  return value ? toBytes({ ...value, heroes: heroOnly(dict(value.heroes), hero) }) : bytes;
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

function indexText(lines: string[]): Uint8Array {
  return encoder.encode(lines.length ? `${lines.join('\n')}\n` : '');
}

/** tome2's savefile index holding only `hero`'s line. */
export function indexOf(bytes: Uint8Array, hero: string): Uint8Array {
  const line = indexLines(bytes)[hero];
  return indexText(line ? [line] : []);
}

/**
 * tome2's savefile index with `hero`'s line from the other copy. The title
 * offers to continue the hero of the first line, so the lines are ordered by
 * when each hero was last saved (`recency`, newest first); heroes without a
 * time keep their place after them.
 */
export function mergeSaveIndex(local: Uint8Array, remote: Uint8Array, hero: string, recency: (base: string) => number): Uint8Array {
  const lines = withHero(indexLines(local), indexLines(remote), hero);
  const order = Object.keys(lines).map((key, at) => ({ key, at, time: recency(key) }));
  order.sort((a, b) => b.time - a.time || a.at - b.at);
  return indexText(order.map((o) => lines[o.key]));
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
  const records = Object.values(union(scoreRecords(local), scoreRecords(remote)));
  records.sort((a, b) => points(b) - points(a));
  const kept = records.slice(0, MAX_SCORES);
  const out = new Uint8Array(kept.length * SCORE_RECORD);
  kept.forEach((record, i) => out.set(record, i * SCORE_RECORD));
  return out;
}
