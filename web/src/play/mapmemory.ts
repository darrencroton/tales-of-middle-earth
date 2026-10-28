import { CAVE_MARK } from '../render/snapshot.ts';
import type { EmscriptenFS } from '../saves.ts';

/** Which way the hero is going through a dungeon: exploring ends at the way on in that direction. */
export type Heading = 'down' | 'up';

export interface HeroMemory {
  heading: Heading;
  /** Remembered grids of areas of the land, by area key: `<width>x<height>:<runs>`. */
  areas: Record<string, string>;
  /** Grids exploring is done with (visited, or out of reach), by level key. */
  visited: Record<string, number[]>;
}

interface Stored {
  version: 1;
  heroes: Record<string, HeroMemory>;
}

const FILE = 'mapmemory.json';
/* Most areas and levels kept per hero; the oldest are dropped first. */
const MAX_AREAS = 400;
const MAX_LEVELS = 400;

export interface PlaceKeyInput {
  dungeon: number;
  depth: number;
  wild: number;
  wx?: number;
  wy?: number;
  quest?: number;
}

/** An area of the land (its layout is the same on every visit), or null elsewhere. */
export function areaKey(place: PlaceKeyInput): string | null {
  if (place.depth !== 0 || place.wild || place.quest || place.wx === undefined || place.wy === undefined) return null;
  return `land:${place.wx},${place.wy}`;
}

/** A dungeon level or an area of the land; null on the world map and in quests. */
export function levelKey(place: PlaceKeyInput): string | null {
  if (place.depth === 0) return areaKey(place);
  if (place.quest) return null;
  return `level:${place.dungeon}:${place.depth}`;
}

/** Run lengths of alternating unset and set bytes, starting with unset, in base 36. */
export function encodeRuns(mask: Uint8Array): string {
  const runs: string[] = [];
  let value = 0;
  let run = 0;
  for (const byte of mask) {
    const bit = byte ? 1 : 0;
    if (bit === value) {
      run++;
      continue;
    }
    runs.push(run.toString(36));
    value = bit;
    run = 1;
  }
  runs.push(run.toString(36));
  return runs.join(',');
}

/** Inverse of `encodeRuns`; null when the text does not describe `length` bytes. */
export function decodeRuns(text: string, length: number): Uint8Array | null {
  const mask = new Uint8Array(length);
  let at = 0;
  let value = 0;
  for (const part of text.split(',')) {
    const run = parseInt(part, 36);
    if (!Number.isInteger(run) || run < 0 || at + run > length) return null;
    if (value) mask.fill(1, at, at + run);
    at += run;
    value ^= 1;
  }
  return at === length ? mask : null;
}

/** Adds the grids the engine has marked as remembered; true when any were new. */
export function mergeKnown(mask: Uint8Array, info: Uint16Array): boolean {
  let changed = false;
  const n = Math.min(mask.length, info.length);
  for (let i = 0; i < n; i++) {
    if (!mask[i] && info[i] & CAVE_MARK) {
      mask[i] = 1;
      changed = true;
    }
  }
  return changed;
}

/** Remembered grids the engine has forgotten (as the land does at nightfall). */
export function missingCells(mask: Uint8Array, info: Uint16Array): number[] {
  const cells: number[] = [];
  const n = Math.min(mask.length, info.length);
  for (let i = 0; i < n; i++) if (mask[i] && !(info[i] & CAVE_MARK)) cells.push(i);
  return cells;
}

function newHero(): HeroMemory {
  return { heading: 'down', areas: {}, visited: {} };
}

function sanitiseHero(raw: unknown): HeroMemory {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<HeroMemory>;
  const areas: Record<string, string> = {};
  for (const [key, text] of Object.entries(value.areas ?? {})) if (typeof text === 'string') areas[key] = text;
  const visited: Record<string, number[]> = {};
  for (const [key, cells] of Object.entries(value.visited ?? {})) {
    if (Array.isArray(cells)) visited[key] = cells.filter((c): c is number => Number.isInteger(c) && c >= 0);
  }
  return { heading: value.heading === 'up' ? 'up' : 'down', areas, visited };
}

export function sanitiseMemory(raw: unknown): Stored {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Stored>;
  const heroes: Record<string, HeroMemory> = {};
  for (const [id, hero] of Object.entries(value.heroes ?? {})) heroes[id] = sanitiseHero(hero);
  return { version: 1, heroes };
}

function trim<T>(record: Record<string, T>, max: number): void {
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length - max; i++) delete record[keys[i]];
}

/**
 * What each hero remembers between sessions, kept as `mapmemory.json` next to
 * the savefiles: the areas of the land they have walked, which way they are
 * heading, and where exploring has already been on each level.
 */
export class MapMemoryStore {
  private data: Stored = sanitiseMemory(null);
  private fs: EmscriptenFS | null = null;
  private path = '';
  private dirty = false;
  loaded = false;

  load(fs: EmscriptenFS | null, root: string | null): void {
    if (!fs || !root) return;
    this.loaded = true;
    this.fs = fs;
    this.path = `${root}/${FILE}`;
    try {
      this.data = sanitiseMemory(JSON.parse(new TextDecoder().decode(fs.readFile(this.path))));
    } catch {
      this.data = sanitiseMemory(null);
    }
  }

  hero(id: string): HeroMemory {
    let hero = this.data.heroes[id];
    if (!hero) {
      hero = newHero();
      this.data.heroes[id] = hero;
    }
    return hero;
  }

  /** The remembered grids of an area, or a blank mask when none (or the size differs). */
  area(hero: HeroMemory, key: string, width: number, height: number): Uint8Array {
    const text = hero.areas[key];
    const prefix = `${width}x${height}:`;
    const mask = text?.startsWith(prefix) ? decodeRuns(text.slice(prefix.length), width * height) : null;
    return mask ?? new Uint8Array(width * height);
  }

  setArea(hero: HeroMemory, key: string, width: number, height: number, mask: Uint8Array): void {
    delete hero.areas[key];
    hero.areas[key] = `${width}x${height}:${encodeRuns(mask)}`;
    trim(hero.areas, MAX_AREAS);
    this.dirty = true;
  }

  setVisited(hero: HeroMemory, key: string, cells: Iterable<number>): void {
    delete hero.visited[key];
    hero.visited[key] = [...cells];
    trim(hero.visited, MAX_LEVELS);
    this.dirty = true;
  }

  /** Forgets every level's visits (kept levels were turned off, so the levels will be new). */
  forgetLevels(hero: HeroMemory): void {
    for (const key of Object.keys(hero.visited)) if (key.startsWith('level:')) delete hero.visited[key];
    this.dirty = true;
  }

  setHeading(hero: HeroMemory, heading: Heading): void {
    if (hero.heading === heading) return;
    hero.heading = heading;
    this.dirty = true;
  }

  forget(id: string): void {
    if (!this.data.heroes[id]) return;
    delete this.data.heroes[id];
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty || !this.fs || !this.path) return;
    try {
      this.fs.writeFile(this.path, new TextEncoder().encode(JSON.stringify(this.data)));
      this.dirty = false;
    } catch (err) {
      console.warn('Could not write the map memory', err);
    }
  }
}
