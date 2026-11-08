import type { Place } from '../audio/places.ts';
import type { Engine } from '../engine.ts';
import { CAVE_MARK, type GameState, type LevelSnapshot } from '../render/snapshot.ts';
import type { EmscriptenFS } from '../saves.ts';
import { adventurerOf, type AdventurerStore } from './adventurers.ts';
import { LevelExploration } from './explore.ts';
import { levelKey, MapMemoryStore, mergeKnown, missingCells, type Heading, type HeroMemory } from './mapmemory.ts';

/** What belongs to the level the hero is on: replaced on each level change and back at the title. */
export interface LevelState {
  /** The level (`levelKey`, or a stand-in where there is none) and its depth. */
  key: string | null;
  depth: number;
  /** Exploring's visits on this level are kept between visits: on the land, and on dungeon levels tome2 keeps. */
  keepsVisits: boolean;
  explore: LevelExploration;
  /* The turn and cell the hero's map memory last followed. */
  memoryTurn: number;
  memoryPos: number;
}

/**
 * Whether going from the level `from` to `to` (`LevelState.key`) is a move to another level: down or up, into or out
 * of a dungeon, a quest's own level or the world map. Not the first level seen after a game is loaded (`from` null),
 * nor walking on into the next area of the land.
 */
export function movedLevel(from: string | null, to: string): boolean {
  return from !== null && from !== to && !(from.startsWith('land:') && to.startsWith('land:'));
}

function newLevelState(): LevelState {
  return { key: null, depth: -1, keepsVisits: false, explore: new LevelExploration(), memoryTurn: -1, memoryPos: -1 };
}

interface HeroMemoryDeps {
  engine: Engine;
  adventurers: AdventurerStore;
  /** Where the player is (`engine.place()`, as last read). */
  place(): Place | null;
  state(): GameState | null;
  /**
   * The hero has entered another level (an exploration ends with the level it explored); `moved` when they went
   * there from one seen in this game, other than the next area of the land (`movedLevel`).
   */
  onLevel(moved: boolean): void;
  /** Grids tome2 had forgotten were marked again: the map is to be drawn again. */
  changed(): void;
}

/**
 * What the hero remembers (`mapmemory.json`): the grids seen on the land,
 * exploring's visits per level, the heading and the quests told; and the
 * level the hero is on. Its state belongs to one game (`reset` back at the
 * title).
 */
export class HeroMemoryKeeper {
  private readonly deps: HeroMemoryDeps;
  private readonly store = new MapMemoryStore();
  private current = newLevelState();
  /* The hero's memory (by `heroId`) and the land area's remembered grids. */
  private memoryId = '';
  private memory: HeroMemory | null = null;
  private landMemory: { key: string; width: number; height: number; mask: Uint8Array; changed: boolean } | null = null;

  constructor(deps: HeroMemoryDeps) {
    this.deps = deps;
  }

  /** The level the hero is on. */
  get level(): LevelState {
    return this.current;
  }

  /** Reads the store from the engine's storage, once it has been read from the browser. */
  load(fs: EmscriptenFS | null, root: string | null): void {
    if (!this.store.loaded) this.store.load(fs, root);
  }

  /** Which way the hero is heading below ground. */
  get heading(): Heading {
    return this.memory?.heading ?? 'down';
  }

  /** Stores what is remembered of the last game, then forgets it, to be loaded again with the next. */
  reset(): void {
    this.persist();
    this.current = newLevelState();
    this.memoryId = '';
    this.memory = null;
    this.landMemory = null;
    this.store.loaded = false;
  }

  private heroId(): string | null {
    const player = this.deps.state()?.player;
    const place = this.deps.place();
    if (!player?.name || player.dead || place?.heroId === undefined) return null;
    return `${player.name}#${(place.heroId >>> 0).toString(36)}`;
  }

  /** Puts what the hero remembers of the current level into the store, and the store into storage; notes where the hero is for the title screen. */
  persist(): void {
    const { adventurers } = this.deps;
    const player = this.deps.state()?.player;
    if (player?.name && !player.dead && adventurers.loaded) {
      adventurers.note(adventurerOf(player));
      adventurers.save();
    }
    if (this.memory) {
      if (this.landMemory?.changed) {
        this.store.setArea(this.memory, this.landMemory.key, this.landMemory.width, this.landMemory.height, this.landMemory.mask);
        this.landMemory.changed = false;
      }
      if (this.current.key && this.current.keepsVisits) this.store.setVisited(this.memory, this.current.key, this.current.explore.skip);
    }
    this.store.save();
  }

  /**
   * Which way the hero is now heading below ground, from the depth left and
   * the depth entered (tome2 depths hold across dungeons); null keeps it.
   */
  private headingInto(next: Place): Heading | null {
    if (this.current.key === null || next.depth === 0 || next.depth === this.current.depth) return null;
    return next.depth > this.current.depth ? 'down' : 'up';
  }

  private enterLevel(key: string, next: Place): void {
    this.persist();
    const heading = this.headingInto(next);
    if (this.memory && heading) this.store.setHeading(this.memory, heading);
    this.deps.onLevel(movedLevel(this.current.key, key));
    this.current = { ...newLevelState(), key, depth: next.depth, keepsVisits: key.startsWith('land:') || !!next.kept };
    this.landMemory = null;
    if (this.memory && this.current.keepsVisits) for (const cell of this.memory.visited[key] ?? []) this.current.explore.skip.add(cell);
  }

  /** Keeps the grids of an area of the land the hero has seen, and restores those tome2 has forgotten. */
  private rememberLand(snap: LevelSnapshot, key: string): void {
    if (!this.memory || !key.startsWith('land:')) return;
    const land = this.landMemory;
    if (!land || land.key !== key || land.width !== snap.width || land.height !== snap.height) {
      this.landMemory = { key, width: snap.width, height: snap.height, mask: this.store.area(this.memory, key, snap.width, snap.height), changed: false };
    }
    const memory = this.landMemory!;
    if (mergeKnown(memory.mask, snap.info)) memory.changed = true;
    const missing = missingCells(memory.mask, snap.info);
    if (missing.length === 0 || this.deps.engine.markKnown(missing) === 0) return;
    for (const cell of missing) snap.info[cell] |= CAVE_MARK;
    this.deps.changed();
  }

  /** Follows the hero on each snapshot: whose memory it is, the level they are on, where they have been. */
  update(snap: LevelSnapshot): void {
    const id = this.heroId();
    if (id && id !== this.memoryId && this.store.loaded) {
      this.persist();
      this.memoryId = id;
      this.memory = this.store.hero(id);
      this.current.key = null;
    }
    const place = this.deps.place();
    const current = place && place.depth === snap.depth && !!place.wild === snap.wild ? place : null;
    if (!current) return;
    const key = levelKey(current) ?? `other:${current.dungeon}:${current.depth}:${current.wild}`;
    const pos = snap.py * snap.width + snap.px;
    if (key !== this.current.key) {
      this.enterLevel(key, current);
      this.current.memoryPos = pos;
    }
    const level = this.current;
    if (snap.turn === level.memoryTurn && pos === level.memoryPos) return;
    level.memoryTurn = snap.turn;
    level.memoryPos = pos;
    level.explore.noteVisited(snap);
    this.rememberLand(snap, key);
  }

  /** The quest's arrival (by `questKey`) has already been told in a card, or cannot be noted. */
  questTold(key: string): boolean {
    return !this.memory || !key || this.memory.quests.includes(key);
  }

  noteQuest(key: string): void {
    if (this.memory) this.store.noteQuest(this.memory, key);
  }

  /** Forgets the hero's kept levels (Settings → Dungeon levels made new each visit). */
  forgetLevels(): void {
    if (this.memory) this.store.forgetLevels(this.memory);
    if (this.current.key?.startsWith('level:')) this.current.keepsVisits = false;
  }

  /** Forgets every hero of this name, the one in play too. */
  forget(name: string): void {
    this.store.forgetNamed(name);
    this.store.save();
    if (this.memoryId.startsWith(`${name}#`)) {
      this.memory = null;
      this.memoryId = '';
      this.landMemory = null;
    }
  }
}
