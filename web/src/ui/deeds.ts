import {
  DEEDS,
  newCareer,
  newChronicle,
  type Career,
  type Chronicle,
  type Deed,
} from '../play/chronicle.ts';
import type { Memorial } from '../play/memorial.ts';
import type { EmscriptenFS } from '../saves.ts';
import { el, iconText, section } from './dom.ts';

const FILE = 'chronicle.json';
const VERSION = 1;
/* Fallen heroes remembered in full, most recent kept. */
const MAX_MEMORIALS = 60;

interface Stored {
  version: number;
  career: Career;
  /** Deed id → date earned (ISO). */
  deeds: Record<string, string>;
  heroes: Record<string, Chronicle>;
  /** Fallen heroes as they were at the end, by name and final turn. */
  memorials: Record<string, Memorial>;
}

/* Keyed by hero name, so it has no prototype: a hero called "constructor" or "__proto__" is just a name. */
function dictionary<T>(from: unknown): Record<string, T> {
  const dict = Object.create(null) as Record<string, T>;
  if (from && typeof from === 'object') {
    for (const [key, value] of Object.entries(from)) dict[key] = value as T;
  }
  return dict;
}

function sanitise(raw: unknown): Stored {
  const empty: Stored = { version: VERSION, career: newCareer(), deeds: dictionary(null), heroes: dictionary(null), memorials: dictionary(null) };
  if (!raw || typeof raw !== 'object') return empty;
  const data = raw as Partial<Stored>;
  if (data.version !== VERSION) return empty;
  return {
    version: VERSION,
    career: { ...newCareer(), ...(data.career ?? {}) },
    deeds: dictionary(data.deeds),
    heroes: dictionary(data.heroes),
    memorials: dictionary(data.memorials),
  };
}

/**
 * Heroes' chronicles, the career and the deeds earned, kept as a file next
 * to the savefiles so exporting saves takes them along.
 */
export class ChronicleStore {
  private data: Stored = sanitise(null);
  private fs: EmscriptenFS | null = null;
  private path = '';
  loaded = false;

  /** Reads the file from the engine's storage (once the engine runs). */
  load(fs: EmscriptenFS | null, root: string | null): void {
    if (!fs || !root) return;
    this.loaded = true;
    this.fs = fs;
    this.path = `${root}/${FILE}`;
    try {
      this.data = sanitise(JSON.parse(new TextDecoder().decode(fs.readFile(this.path))));
    } catch {
      this.data = sanitise(null);
    }
  }

  get career(): Career {
    return this.data.career;
  }

  get earned(): ReadonlySet<string> {
    return new Set(Object.keys(this.data.deeds));
  }

  earnedOn(id: string): string | null {
    return this.data.deeds[id] ?? null;
  }

  /** The hero's chronicle; a new one when the name is new or belonged to a fallen hero. */
  hero(name: string): Chronicle {
    const existing = this.data.heroes[name];
    if (existing && !existing.fallen) return existing;
    const chronicle = newChronicle(name);
    this.data.heroes[name] = chronicle;
    this.data.career.heroes++;
    return chronicle;
  }

  /** Forgets a living hero's chronicle (their adventure was deleted); the career and the fallen stay. */
  forget(name: string): void {
    if (this.data.heroes[name] && !this.data.heroes[name].fallen) delete this.data.heroes[name];
  }

  peek(name: string): Chronicle | null {
    return this.data.heroes[name] ?? null;
  }

  award(chronicle: Chronicle, deeds: readonly Deed[], now = new Date()): void {
    for (const deed of deeds) {
      this.data.deeds[deed.id] = now.toISOString();
      chronicle.deeds.push(deed.id);
    }
  }

  /** Closes a hero's chronicle once, counting them among the fallen unless their adventure was abandoned; true when this is the first time. */
  fall(name: string, abandoned = false): boolean {
    const chronicle = this.data.heroes[name];
    if (!chronicle || chronicle.fallen) return false;
    chronicle.fallen = true;
    if (!abandoned) this.data.career.fallen++;
    return true;
  }

  /** Keeps a fallen hero as they were at the end; false when already kept. */
  remember(key: string, memorial: Memorial): boolean {
    if (this.data.memorials[key]) return false;
    this.data.memorials[key] = memorial;
    const keys = Object.keys(this.data.memorials);
    if (keys.length > MAX_MEMORIALS) {
      keys.sort((a, b) => this.data.memorials[a].date.localeCompare(this.data.memorials[b].date));
      for (const old of keys.slice(0, keys.length - MAX_MEMORIALS)) delete this.data.memorials[old];
    }
    return true;
  }

  memorial(key: string): Memorial | null {
    return this.data.memorials[key] ?? null;
  }

  /** Forgets a hero kept as they were at the end; false when none was. */
  forgetMemorial(key: string): boolean {
    if (!this.data.memorials[key]) return false;
    delete this.data.memorials[key];
    return true;
  }

  save(): void {
    if (!this.fs || !this.path) return;
    try {
      this.fs.writeFile(this.path, new TextEncoder().encode(JSON.stringify(this.data)));
    } catch (err) {
      console.warn('Could not write the chronicle', err);
    }
  }
}

function fact(label: string, value: string): HTMLElement {
  const node = el('div', 'stat');
  node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return node;
}

/** The career and every deed, earned or not, for the title screen. */
export function careerElements(store: ChronicleStore): HTMLElement[] {
  const k = store.career;
  const grid = el('div', 'stat-grid');
  grid.append(
    fact('Heroes', String(k.heroes)),
    fact('Fallen', String(k.fallen)),
    fact('Creatures slain', k.kills.toLocaleString('en-GB')),
    fact('Legends slain', String(k.uniques)),
    fact('Deepest', k.deepestFeet ? `${k.deepestFeet} ft` : '—'),
    fact('Best level', k.bestLevel ? String(k.bestLevel) : '—'),
  );
  const earned = store.earned;
  const list = el('ul', 'deed-list');
  for (const deed of DEEDS) {
    const item = el('li', earned.has(deed.id) ? 'deed earned' : 'deed');
    const when = store.earnedOn(deed.id);
    item.append(
      el('span', 'deed-star', iconText(earned.has(deed.id) ? '★' : '☆')),
      el('span', 'deed-title', deed.title),
      el('span', 'deed-text', when ? `${deed.text} Earned ${new Date(when).toLocaleDateString('en-GB')}.` : deed.text),
    );
    list.append(item);
  }
  return [section('Career', grid), section(`Deeds · ${earned.size} of ${DEEDS.length}`, list)];
}
