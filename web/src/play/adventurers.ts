import type { PlayerState } from '../render/snapshot.ts';
import type { EmscriptenFS } from '../saves.ts';

const FILE = 'adventurers.json';
const VERSION = 1;

/** What the title screen shows of a saved hero, noted whenever the game is saved. */
export interface Adventurer {
  name: string;
  level: number;
  race: string;
  cls: string;
  /** Where they were: "Barrow-downs, level 8", "Bree", "World map". */
  place: string;
  /** When last saved (ISO). */
  saved: string;
}

/** "Level 12 High-Elf Sorcerer". */
export function heroLine(a: Pick<Adventurer, 'level' | 'race' | 'cls'>): string {
  return `Level ${a.level} ${[a.race, a.cls].filter(Boolean).join(' ')}`.trim();
}

/** Where a hero is, in a few words: a dungeon and its level, the town or land they walk, or the world map. */
export function placeLine(player: Pick<PlayerState, 'depth' | 'dungeon' | 'wild' | 'area'>): string {
  if (player.depth > 0) return `${player.dungeon}, level ${player.depth}`;
  return player.area || (player.wild ? 'World map' : 'Middle-earth');
}

/** The adventurer as the game shows them now. */
export function adventurerOf(player: PlayerState, now = new Date()): Adventurer {
  return { name: player.name, level: player.lev, race: player.race, cls: player.cls, place: placeLine(player), saved: now.toISOString() };
}

/** tome2's savefile name for a hero (files.cc process_player_name): letters and digits kept, space, dot, @ and _ as _, the rest left out. */
export function saveBase(name: string): string {
  let base = '';
  for (const c of name) {
    if (/[A-Za-z0-9]/.test(c)) base += c;
    else if ('@. _'.includes(c)) base += '_';
  }
  return base || 'PLAYER';
}

/** The files of a hero among those in the save directory: the savefile and the levels kept with it (`Base.lvl4_2`). */
export function heroFiles(names: readonly string[], base: string): string[] {
  return names.filter((n) => n === base || n.startsWith(`${base}.`));
}

/** tome2's savefile index (global.svg, "module@1base@description" a line) without the hero's line. */
export function withoutIndexEntry(text: string, base: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const m = /^(?:[^@]*@)?[01]([^@]*)@/.exec(line.trim());
      return !m || m[1] !== base;
    })
    .join('\n');
}

/**
 * Deletes a hero's saved game: the savefile and the levels kept with it, in
 * the directory of tome2's index (`indexPath`, global.svg), their notes
 * (`Base.nte`, in the directory above), and the hero's line in the index.
 * Other heroes' files are left alone. Returns the files removed.
 */
export function deleteHeroSave(fs: Pick<EmscriptenFS, 'readdir' | 'readFile' | 'writeFile' | 'unlink'>, indexPath: string, name: string): string[] {
  const dir = indexPath.slice(0, indexPath.lastIndexOf('/'));
  const up = dir.slice(0, dir.lastIndexOf('/'));
  const base = saveBase(name);
  const notes = `${base}.nte`;
  const removed = [
    ...heroFiles(fs.readdir(dir), base)
      .map((file) => `${dir}/${file}`)
      .filter((path) => path !== indexPath),
    ...fs.readdir(up).filter((file) => file === notes).map((file) => `${up}/${file}`),
  ];
  for (const path of removed) fs.unlink(path);
  const index = new TextDecoder().decode(fs.readFile(indexPath));
  fs.writeFile(indexPath, new TextEncoder().encode(withoutIndexEntry(index, base)));
  return removed;
}

/** Heroes' title-screen details, by name, kept as a file next to the savefiles. */
export class AdventurerStore {
  private heroes: Record<string, Adventurer> = Object.create(null) as Record<string, Adventurer>;
  private fs: EmscriptenFS | null = null;
  private path = '';
  loaded = false;

  load(fs: EmscriptenFS | null, root: string | null): void {
    if (!fs || !root) return;
    this.loaded = true;
    this.fs = fs;
    this.path = `${root}/${FILE}`;
    this.heroes = Object.create(null) as Record<string, Adventurer>;
    try {
      const data = JSON.parse(new TextDecoder().decode(fs.readFile(this.path))) as { version?: number; heroes?: Record<string, Adventurer> };
      if (data.version === VERSION && data.heroes && typeof data.heroes === 'object') Object.assign(this.heroes, data.heroes);
    } catch {
      /* None kept yet. */
    }
  }

  get(name: string): Adventurer | null {
    return this.heroes[name] ?? null;
  }

  /** Notes the hero as they are now; true when anything shown changed. */
  note(adventurer: Adventurer): boolean {
    const old = this.heroes[adventurer.name];
    this.heroes[adventurer.name] = adventurer;
    return !old || heroLine(old) !== heroLine(adventurer) || old.place !== adventurer.place;
  }

  forget(name: string): void {
    delete this.heroes[name];
  }

  save(): void {
    if (!this.fs || !this.path) return;
    try {
      this.fs.writeFile(this.path, new TextEncoder().encode(JSON.stringify({ version: VERSION, heroes: this.heroes })));
    } catch (err) {
      console.warn('Could not write the adventurers', err);
    }
  }
}
