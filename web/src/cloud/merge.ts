/**
 * Merging files every hero shares (the savefile index, the Hall of Fame, the
 * title details, the chronicle and map memory) from this device's copy, the
 * cloud's and the last one both had (`base`). What belongs to one hero follows
 * the copy of that hero that was kept (`Winner`); the rest is combined.
 */
import { saveBase } from '../play/adventurers.ts';

/** Whose copy of a hero is kept: this device's, the cloud's, or null when neither changed it. */
export type Winner = (base: string) => 'local' | 'remote' | null;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Three-way merge of records by key: a key `pick` names a side for takes that
 * side's value (or its absence); otherwise a key changed on one side takes
 * that side's value (or its removal), and changed on both, `resolve` decides
 * (undefined removes it). Keys keep the local order, then the cloud's new ones.
 */
export function mergeRecords<T>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
  resolve: (key: string, local: T | undefined, remote: T | undefined) => T | undefined,
  pick: (key: string) => 'local' | 'remote' | null = () => null,
): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])];
  for (const key of keys) {
    const l = Object.hasOwn(local, key) ? local[key] : undefined;
    const r = Object.hasOwn(remote, key) ? remote[key] : undefined;
    const b = Object.hasOwn(base, key) ? base[key] : undefined;
    const side = pick(key);
    const value = side ? (side === 'remote' ? r : l) : same(l, r) ? l : same(l, b) ? r : same(r, b) ? l : resolve(key, l, r);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function parseJson(bytes: Uint8Array | null): Record<string, unknown> | null {
  if (!bytes) return null;
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

/** The name a hero entry is kept under: the name itself, or `Name#seed` in map memory. */
function heroBase(key: string): string {
  const hash = key.lastIndexOf('#');
  return saveBase(hash > 0 ? key.slice(0, hash) : key);
}

/** Merges a JSON store whose `heroes` are by hero (title details, map memory); other fields come from the local copy. */
function mergeHeroStore(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array, winner: Winner, conflict?: (l: unknown, r: unknown) => unknown): Uint8Array {
  const b = parseJson(base) ?? {};
  const l = parseJson(local);
  const r = parseJson(remote);
  if (!l || !r) return l ? local : remote;
  const heroes = mergeRecords(
    dict(b.heroes),
    dict(l.heroes),
    dict(r.heroes),
    (_, lv, rv) => (conflict && lv !== undefined && rv !== undefined ? conflict(lv, rv) : lv),
    (key) => winner(heroBase(key)),
  );
  return toBytes({ ...l, heroes });
}

/** Title details (`adventurers.json`): a hero's entry follows the kept copy, else the one saved last. */
export function mergeAdventurers(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array, winner: Winner): Uint8Array {
  const saved = (v: unknown) => String((v as { saved?: unknown }).saved ?? '');
  return mergeHeroStore(base, local, remote, winner, (l, r) => (saved(r) > saved(l) ? r : l));
}

/** Map memory (`mapmemory.json`): a hero's memory follows the kept copy, else this device's. */
export function mergeMapMemory(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array, winner: Winner): Uint8Array {
  return mergeHeroStore(base, local, remote, winner);
}

const COUNTERS = ['heroes', 'fallen', 'kills', 'uniques', 'closeCalls'];
const BESTS = ['deepestFeet', 'bestLevel', 'bestStreak'];

/** The career across devices: counts add what each side added since they last agreed, bests take the higher, flags either. */
function mergeCareer(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...remote, ...local };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const key of COUNTERS) out[key] = Math.max(0, num(local[key]) + num(remote[key]) - num(base[key]));
  for (const key of BESTS) out[key] = Math.max(num(local[key]), num(remote[key]));
  out.worldMap = !!local.worldMap || !!remote.worldMap;
  return out;
}

/** The chronicle (`chronicle.json`): the career combined, deeds kept from when first earned, heroes' tales following the kept copy, the fallen from both. */
export function mergeChronicle(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array, winner: Winner): Uint8Array {
  const b = parseJson(base) ?? {};
  const l = parseJson(local);
  const r = parseJson(remote);
  if (!l || !r) return l ? local : remote;
  const deeds = mergeRecords(dict<string>(b.deeds), dict<string>(l.deeds), dict<string>(r.deeds), (_, lv, rv) =>
    lv === undefined ? rv : rv === undefined ? lv : lv < rv ? lv : rv,
  );
  const heroes = mergeRecords(dict(b.heroes), dict(l.heroes), dict(r.heroes), (_, lv) => lv, (key) => winner(saveBase(key)));
  const memorials = mergeRecords(dict(b.memorials), dict(l.memorials), dict(r.memorials), (_, lv, rv) => lv ?? rv);
  return toBytes({ ...l, career: mergeCareer(dict(b.career), dict(l.career), dict(r.career)), deeds, heroes, memorials });
}

/** The savefile a line of tome2's index (`global.svg`: "module@1base@description") is for, or null. */
function indexBase(line: string): string | null {
  return /^(?:[^@]*@)?[01]([^@]*)@/.exec(line.trim())?.[1] ?? null;
}

function indexLines(bytes: Uint8Array | null): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!bytes) return out;
  for (const line of decoder.decode(bytes).split('\n')) {
    const key = indexBase(line);
    if (key !== null && !Object.hasOwn(out, key)) out[key] = line.trim();
  }
  return out;
}

/**
 * tome2's savefile index: a hero's line follows the kept copy, else this
 * device's. The title offers to continue the hero of the first line, so the
 * lines are ordered by when each hero was last played (`recency`, newest
 * first); heroes without a time keep their place after them.
 */
export function mergeSaveIndex(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array, winner: Winner, recency: (base: string) => number): Uint8Array {
  const lines = mergeRecords(indexLines(base), indexLines(local), indexLines(remote), (_, lv) => lv, winner);
  const keys = Object.keys(lines);
  const order = keys.map((key, at) => ({ key, at, time: recency(key) }));
  order.sort((a, b) => b.time - a.time || a.at - b.at);
  const text = order.map((o) => lines[o.key]).join('\n');
  return encoder.encode(text ? `${text}\n` : '');
}

/** Bytes of one entry of tome2's `scores.raw` (struct high_score). */
export const SCORE_RECORD = 148;
const MAX_SCORES = 100;
/** Where the score (`pts`, ten characters) sits in a record, after `what[8]`. */
const POINTS_AT = 8;

function scoreRecords(bytes: Uint8Array | null): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = Object.create(null);
  if (!bytes) return out;
  for (let at = 0; at + SCORE_RECORD <= bytes.length; at += SCORE_RECORD) {
    const record = bytes.slice(at, at + SCORE_RECORD);
    let key = Array.from(record, (b) => b.toString(16).padStart(2, '0')).join('');
    while (Object.hasOwn(out, key)) key += '+';
    out[key] = record;
  }
  return out;
}

function points(record: Uint8Array): number {
  return parseInt(decoder.decode(record.subarray(POINTS_AT, POINTS_AT + 10)).replace(/\0.*$/, '').trim(), 10) || 0;
}

/** tome2's Hall of Fame (`scores.raw`): entries from both, an entry removed on either side gone, best first as tome2 keeps them. */
export function mergeScores(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array): Uint8Array {
  const records = Object.values(mergeRecords(scoreRecords(base), scoreRecords(local), scoreRecords(remote), () => undefined));
  records.sort((a, b) => points(b) - points(a));
  const kept = records.slice(0, MAX_SCORES);
  const out = new Uint8Array(kept.length * SCORE_RECORD);
  kept.forEach((record, i) => out.set(record, i * SCORE_RECORD));
  return out;
}
