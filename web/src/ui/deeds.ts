import {
  DEEDS,
  newCareer,
  newChronicle,
  nextTimeTip,
  type Career,
  type Chronicle,
  type Deed,
} from '../play/chronicle.ts';
import type { EmscriptenFS } from '../saves.ts';
import { el, iconText, section } from './dom.ts';

const FILE = 'chronicle.json';
const VERSION = 1;

interface Stored {
  version: number;
  career: Career;
  /** Deed id → date earned (ISO). */
  deeds: Record<string, string>;
  heroes: Record<string, Chronicle>;
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
  const empty: Stored = { version: VERSION, career: newCareer(), deeds: dictionary(null), heroes: dictionary(null) };
  if (!raw || typeof raw !== 'object') return empty;
  const data = raw as Partial<Stored>;
  if (data.version !== VERSION) return empty;
  return {
    version: VERSION,
    career: { ...newCareer(), ...(data.career ?? {}) },
    deeds: dictionary(data.deeds),
    heroes: dictionary(data.heroes),
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

  peek(name: string): Chronicle | null {
    return this.data.heroes[name] ?? null;
  }

  award(chronicle: Chronicle, deeds: readonly Deed[], now = new Date()): void {
    for (const deed of deeds) {
      this.data.deeds[deed.id] = now.toISOString();
      chronicle.deeds.push(deed.id);
    }
  }

  /** Counts a fallen hero once; true when this is the first time. */
  fall(name: string): boolean {
    const chronicle = this.data.heroes[name];
    if (!chronicle || chronicle.fallen) return false;
    chronicle.fallen = true;
    this.data.career.fallen++;
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

/** The "Your tale" part of the end-of-game summary. */
export function taleElements(chronicle: Chronicle, cause: string, depth: number): HTMLElement[] {
  const grid = el('div', 'stat-grid');
  grid.append(
    fact('Creatures slain', chronicle.kills.toLocaleString('en-GB')),
    fact('Deepest', chronicle.deepestFeet ? `${chronicle.deepestFeet} ft` : 'The surface'),
  );
  if (chronicle.mightiest) grid.append(fact('Mightiest foe', chronicle.mightiest.name));
  if (chronicle.uniques.length) grid.append(fact('Legends slain', String(chronicle.uniques.length)));
  const parts: HTMLElement[] = [section('Your tale', grid)];
  if (chronicle.uniques.length) {
    parts.push(el('p', 'tale-legends', `Slew ${chronicle.uniques.slice(0, 4).join(', ')}${chronicle.uniques.length > 4 ? ' and more' : ''}.`));
  }
  const deeds = chronicle.deeds.map((id) => DEEDS.find((d) => d.id === id)).filter((d): d is Deed => !!d);
  if (deeds.length) {
    const list = el('div', 'deed-chips');
    for (const deed of deeds) list.append(el('span', 'deed-chip', `${iconText('★')} ${deed.title}`));
    parts.push(section('Deeds', list));
  }
  const tip = el('p', 'tale-tip');
  tip.append(el('strong', undefined, 'Next time: '), document.createTextNode(nextTimeTip(chronicle, cause, depth)));
  parts.push(tip);
  return parts;
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
