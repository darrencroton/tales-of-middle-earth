/**
 * A hero carried from one device to another as a file (`.tome2hero`): their
 * savefile, lives, kept levels and notes, with the files every hero shares,
 * from which only their entries are taken, and the Hall of Fame and deeds
 * combined. Pure: `ui/transfer.ts` sends and receives it.
 */
import { base64ToBytes, bytesToBase64, isSafeRelativePath, type SaveFile } from '../saves.ts';
import { saveBase } from './adventurers.ts';
import { mergeAdventurers, mergeChronicle, mergeMapMemory, mergeSaveIndex, mergeScores, type Winner } from './merge.ts';

const HERO_FORMAT = 'tome2mobile-hero';
const HERO_FORMAT_VERSION = 1;
export const HERO_EXTENSION = '.tome2hero';

/** Files every hero shares, merged rather than taken whole. */
const SHARED_FILES = ['adventurers.json', 'chronicle.json', 'mapmemory.json', 'scores.raw', 'global.svg'] as const;
type SharedFile = (typeof SHARED_FILES)[number];

export interface HeroBundle {
  /** The hero's savefile name ("Old_Tom"). */
  hero: string;
  /** The hero's own name ("Old Tom"). */
  name: string;
  /** The device it was sent from: "iPhone". */
  device: string;
  /** When it was sent (ISO). */
  sent: string;
  files: SaveFile[];
}

function sharedFile(path: string): SharedFile | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (SHARED_FILES as readonly string[]).includes(name) ? (name as SharedFile) : null;
}

/** The hero (savefile name) a file belongs to: the savefile, its lives and kept levels (`save/Base`, `save/Base.lvl4_2`), and its notes (`Base.nte`). */
function heroOf(path: string): string | null {
  const save = /(?:^|\/)save\/([A-Za-z0-9_]+)(?:\.[^/]+)?$/.exec(path);
  if (save) return path.endsWith('/global.svg') ? null : save[1];
  return /(?:^|\/)([A-Za-z0-9_]+)\.nte$/.exec(path)?.[1] ?? null;
}

/** What the player calls a device, from its browser. */
export function deviceName(ua: string, touch: number): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'other device';
}

/** A hero's bundle from the files in storage: their own files and the shared ones. */
export function heroBundle(files: readonly SaveFile[], hero: { save: string; name: string }, device: string, now = new Date()): HeroBundle {
  return {
    hero: hero.save,
    name: hero.name,
    device,
    sent: now.toISOString(),
    files: files.filter((f) => heroOf(f.path) === hero.save || sharedFile(f.path)),
  };
}

export function encodeHeroBundle(bundle: HeroBundle): string {
  return JSON.stringify({
    format: HERO_FORMAT,
    version: HERO_FORMAT_VERSION,
    hero: bundle.hero,
    name: bundle.name,
    device: bundle.device,
    sent: bundle.sent,
    files: bundle.files.map((f) => ({ path: f.path, data: bytesToBase64(f.data) })),
  });
}

export function decodeHeroBundle(text: string): HeroBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a hero sent from the game.');
  }
  const value = raw as Partial<Record<'format' | 'version' | 'hero' | 'name' | 'device' | 'sent' | 'files', unknown>> | null;
  if (!value || value.format !== HERO_FORMAT) throw new Error('This is not a hero sent from the game.');
  if (typeof value.version !== 'number' || value.version > HERO_FORMAT_VERSION) throw new Error('This hero was sent from a newer version of the game.');
  if (typeof value.hero !== 'string' || saveBase(value.hero) !== value.hero || typeof value.name !== 'string' || !Array.isArray(value.files)) {
    throw new Error('This hero file is damaged.');
  }
  const files = value.files.map((entry: { path?: unknown; data?: unknown } | null) => {
    if (!entry || typeof entry.path !== 'string' || typeof entry.data !== 'string' || !isSafeRelativePath(entry.path)) throw new Error('This hero file is damaged.');
    if (heroOf(entry.path) !== value.hero && !sharedFile(entry.path)) throw new Error('This hero file holds more than one hero.');
    try {
      return { path: entry.path, data: base64ToBytes(entry.data) };
    } catch {
      throw new Error('This hero file is damaged.');
    }
  });
  if (!files.some((f) => f.path.endsWith(`save/${value.hero}`))) throw new Error('This hero file holds no saved game.');
  return {
    hero: value.hero,
    name: value.name,
    device: typeof value.device === 'string' ? value.device : 'another device',
    sent: typeof value.sent === 'string' ? value.sent : '',
    files,
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** What receiving a hero does to the files here. */
export interface Arrival {
  /** The hero is already here, as a different copy: the player chooses which goes on. */
  conflict: boolean;
  /** The hero is already here, exactly as sent. */
  same: boolean;
  write: SaveFile[];
  remove: string[];
}

/**
 * Receiving a hero: their files replace this device's copy of them (a kept
 * level only here goes), and from each shared file only their entries are
 * taken, the Hall of Fame, deeds and fallen heroes combined; every other hero
 * here stays as they are.
 */
export function arrival(local: readonly SaveFile[], bundle: HeroBundle): Arrival {
  const mine = local.filter((f) => heroOf(f.path) === bundle.hero);
  const theirs = bundle.files.filter((f) => heroOf(f.path) === bundle.hero);
  const same = mine.length === theirs.length && theirs.every((t) => mine.some((m) => m.path === t.path && sameBytes(m.data, t.data)));
  if (same) return { conflict: false, same: true, write: [], remove: [] };
  const winner: Winner = (hero) => (hero === bundle.hero ? 'remote' : 'local');
  const recency = savedTimes(bundle.files, local);
  const write: SaveFile[] = [...theirs];
  for (const file of bundle.files) {
    const kind = sharedFile(file.path);
    if (!kind) continue;
    const here = local.find((f) => f.path === file.path)?.data ?? emptyShared(kind);
    const merged = mergeShared(kind, here, file.data, winner, recency);
    if (!sameBytes(merged, here)) write.push({ path: file.path, data: merged });
  }
  return {
    conflict: mine.length > 0,
    same: false,
    write,
    remove: mine.filter((m) => !theirs.some((t) => t.path === m.path)).map((m) => m.path),
  };
}

function emptyShared(kind: SharedFile): Uint8Array {
  return new TextEncoder().encode(kind === 'scores.raw' || kind === 'global.svg' ? '' : '{}');
}

function mergeShared(kind: SharedFile, local: Uint8Array, remote: Uint8Array, winner: Winner, recency: (base: string) => number): Uint8Array {
  switch (kind) {
    case 'adventurers.json':
      return mergeAdventurers(local, remote, winner);
    case 'chronicle.json':
      return mergeChronicle(local, remote, winner);
    case 'mapmemory.json':
      return mergeMapMemory(local, remote, winner);
    case 'scores.raw':
      return mergeScores(local, remote);
    default:
      return mergeSaveIndex(local, remote, winner, recency);
  }
}

const decoder = new TextDecoder();

/** When each hero was last saved, by savefile name, from both sides' title details (ms; 0 when unknown). */
function savedTimes(...sides: (readonly SaveFile[])[]): (base: string) => number {
  const times = new Map<string, number>();
  for (const files of sides) {
    const details = files.find((f) => sharedFile(f.path) === 'adventurers.json');
    for (const entry of Object.values(heroEntries(details?.data ?? null))) {
      const time = Date.parse(entry.saved ?? '');
      if (entry.name && Number.isFinite(time)) times.set(saveBase(entry.name), Math.max(time, times.get(saveBase(entry.name)) ?? 0));
    }
  }
  return (base) => times.get(base) ?? 0;
}

interface HeroEntry {
  name?: string;
  level?: number;
  race?: string;
  cls?: string;
  place?: string;
  saved?: string;
}

function heroEntries(bytes: Uint8Array | null): Record<string, HeroEntry> {
  try {
    return (JSON.parse(decoder.decode(bytes ?? new Uint8Array())) as { heroes?: Record<string, HeroEntry> }).heroes ?? {};
  } catch {
    return {};
  }
}

/** One copy of a hero in "Which journey continues?". */
export interface JourneySide {
  /** Where this copy is: "This iPhone", "Sent from your iPad". */
  where: string;
  /** "Level 12 Human Warrior". */
  line?: string;
  level?: number;
  place?: string;
  /** When last saved (ISO). */
  saved?: string;
  /** When it was sent (ISO), for the copy that came in. */
  sent?: string;
  fallen: boolean;
}

export interface JourneyChoice {
  hero: string;
  local: JourneySide;
  remote: JourneySide;
  /** The copy played furthest: a fallen one, else the higher level, else the one saved last. */
  suggested: 'local' | 'remote';
}

/** A hero's title details and whether tome2's index has them fallen, from a side's files. */
function heroFacts(hero: string, files: readonly SaveFile[]): Omit<JourneySide, 'where'> & { name?: string } {
  const facts: Omit<JourneySide, 'where'> & { name?: string } = { fallen: false };
  const details = files.find((f) => sharedFile(f.path) === 'adventurers.json')?.data ?? null;
  const entry = Object.values(heroEntries(details)).find((h) => h.name && saveBase(h.name) === hero);
  if (entry) {
    Object.assign(facts, {
      name: entry.name,
      level: entry.level,
      line: entry.level ? `Level ${entry.level} ${[entry.race, entry.cls].filter(Boolean).join(' ')}` : undefined,
      place: entry.place,
      saved: entry.saved,
    });
  }
  const index = files.find((f) => sharedFile(f.path) === 'global.svg')?.data;
  const line = index ? decoder.decode(index).split('\n').find((l) => new RegExp(`^(?:[^@]*@)?[01]${hero}@`).test(l.trim())) : undefined;
  if (line && /^(?:[^@]*@)?0/.test(line.trim())) facts.fallen = true;
  return facts;
}

function suggestion(local: JourneySide, remote: JourneySide): 'local' | 'remote' {
  if (local.fallen !== remote.fallen) return local.fallen ? 'local' : 'remote';
  if ((local.level ?? 0) !== (remote.level ?? 0)) return (local.level ?? 0) > (remote.level ?? 0) ? 'local' : 'remote';
  return (remote.saved ?? '') > (local.saved ?? '') ? 'remote' : 'local';
}

/** "Which journey continues?" for a hero here and the copy sent from another device. */
export function journeyChoice(local: readonly SaveFile[], bundle: HeroBundle, here: string): JourneyChoice {
  const mine = heroFacts(bundle.hero, local);
  const theirs = heroFacts(bundle.hero, bundle.files);
  const localSide: JourneySide = { ...mine, where: `This ${here}` };
  const remoteSide: JourneySide = { ...theirs, where: bundle.device === here ? `Your other ${here}` : `Your ${bundle.device}`, sent: bundle.sent || undefined };
  return { hero: mine.name ?? theirs.name ?? bundle.name, local: localSide, remote: remoteSide, suggested: suggestion(localSide, remoteSide) };
}
