import type { Place } from './audio/places.ts';
import type { FeatureInfo } from './render/materials.ts';
import {
  readSnapshot,
  type AbilityTable,
  type BirthData,
  type CharacterState,
  type GameState,
  type InventoryState,
  type LevelSnapshot,
  type MonsterRecall,
  type ScoreEntry,
  type SkillTable,
  type SpellState,
} from './render/snapshot.ts';
import type { RunOptions } from './flow/runoptions.ts';
import type { ScreenCopy, TerminalBuffer } from './terminal.ts';
import { syncToStorage, type EmscriptenFS } from './saves.ts';
import { keyCodes } from './input/keys.ts';

/** Functions the C++ frontend (engine/main-web.cc) calls through Module.tome. */
export interface TomeBridge {
  /** Set once saves were loaded; syncing is disabled while unset. */
  storagePath?: string;
  /** Set when loading saves from IndexedDB failed. */
  storageError?: string;
  waitKey(): Promise<number>;
  pollKey(): number;
  drawText(x: number, y: number, attr: number, text: Uint8Array): void;
  drawCursor(x: number, y: number): void;
  clear(): void;
  flush(): void;
  bell(): void;
  setTitle(title: string): void;
  setColour(index: number, r: number, g: number, b: number): void;
  effectFrame(): void;
  quit(message: string | null): void;
}

interface EmscriptenModule {
  FS: EmscriptenFS;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  UTF8ToString(ptr: number): string;
  _web_snapshot(): number;
  _web_features_json(): number;
  _web_state_json(maxMessages: number): number;
  _web_inventory_json(): number;
  _web_object_desc(item: number): number;
  _web_store_object_desc(index: number): number;
  _web_monster_desc(index: number): number;
  _web_character_json(): number;
  _web_set_auto_more(on: number): void;
  _web_set_effect_delay(factor: number): void;
  _web_run_options_json(): number;
  _web_set_run_option(index: number, on: number): number;
  _web_set_random_quests(count: number): number;
  _web_place_json(): number;
  _web_scores_json(): number;
  _web_birth_json(): number;
  _web_spells_json(): number;
  _web_skills_json(): number;
  _web_abilities_json(): number;
  _web_saved_screen(): number;
  _web_set_persistent_levels(on: number): void;
  _web_mark_buffer(count: number): number;
  _web_mark_known(): number;
  _web_notice_buffer(bytes: number): number;
  _web_add_notice(): void;
}

interface ModuleOptions {
  tome: TomeBridge;
  arguments: string[];
  locateFile(path: string, prefix: string): string;
  print(text: string): void;
  printErr(text: string): void;
  setStatus(text: string): void;
  onExit(status: number): void;
  onAbort(what: unknown): void;
}

type CreateModule = (options: ModuleOptions) => Promise<EmscriptenModule>;

export type EngineState = 'idle' | 'loading' | 'running' | 'exited' | 'failed';

export interface EngineEvents {
  onStatus(text: string, fraction: number | null): void;
  onRunning(): void;
  onExit(message: string | null): void;
  onError(message: string): void;
  /** Engine flushed output to the screen. */
  onFlush?(): void;
  /** Engine is idle, waiting for a key. */
  onIdle?(): void;
  /** Engine is pausing mid-animation (bolts, explosions). */
  onEffectFrame?(): void;
  /** Engine took a key from the queue. */
  onKey?(code: number): void;
}

const SAVE_SYNC_DELAY_MS = 1500;

export function parseDownloadStatus(text: string): number | null {
  const match = /\((\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\)/.exec(text);
  if (!match) return null;
  const total = Number(match[2]);
  return total > 0 ? Math.min(1, Number(match[1]) / total) : null;
}

export class Engine {
  state: EngineState = 'idle';
  private readonly queue: number[] = [];
  private waiter: ((key: number) => void) | null = null;
  private module: EmscriptenModule | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private quitMessage: string | null = null;
  private cursorDrawn = false;
  private readonly buffer: TerminalBuffer;
  private readonly events: EngineEvents;

  constructor(buffer: TerminalBuffer, events: EngineEvents) {
    this.buffer = buffer;
    this.events = events;
  }

  get fs(): EmscriptenFS | null {
    return this.module?.FS ?? null;
  }

  /** Copies the current level state out of the engine, or null before it runs. */
  snapshot(): LevelSnapshot | null {
    const mod = this.module;
    if (!mod || this.state !== 'running') return null;
    return readSnapshot(mod, mod._web_snapshot());
  }

  gameState(maxMessages = 40): GameState | null {
    const mod = this.module;
    if (!mod || this.state !== 'running') return null;
    return JSON.parse(mod.UTF8ToString(mod._web_state_json(maxMessages))) as GameState;
  }

  /** Where the player is (dungeon, town, quest, terrain), or null before a level exists. */
  place(): Place | null {
    const json = this.callJson<Place>((mod) => mod._web_place_json());
    return json && json.ready ? json : null;
  }

  inventory(): InventoryState | null {
    const json = this.callJson<InventoryState>((mod) => mod._web_inventory_json());
    return json && json.ready ? json : null;
  }

  character(): CharacterState | null {
    const json = this.callJson<CharacterState>((mod) => mod._web_character_json());
    return json && json.ready ? json : null;
  }

  /** The Hall of Fame, best first (empty before the engine runs or when there are no scores). */
  scores(): ScoreEntry[] {
    const json = this.callJson<ScoreEntry[]>((mod) => mod._web_scores_json());
    return Array.isArray(json) ? json : [];
  }

  /** Races, race modifiers and classes with their details, for character creation. */
  birthData(): BirthData | null {
    const json = this.callJson<BirthData>((mod) => mod._web_birth_json());
    return json && Array.isArray(json.races) ? json : null;
  }

  /** The run's birth options and random quests, while a character is being created. */
  runOptions(): RunOptions | null {
    const json = this.callJson<RunOptions>((mod) => mod._web_run_options_json());
    return json && Array.isArray(json.options) ? json : null;
  }

  /** Turns a birth option (by its place in `runOptions`) on or off; false once the game has begun. */
  setRunOption(index: number, on: boolean): boolean {
    const mod = this.module;
    if (!mod || this.state !== 'running') return false;
    return mod._web_set_run_option(index, on ? 1 : 0) !== 0;
  }

  /** Draws the random quests again, this many; false once the game has begun. */
  setRandomQuests(count: number): boolean {
    const mod = this.module;
    if (!mod || this.state !== 'running') return false;
    return mod._web_set_random_quests(count) !== 0;
  }

  /** Spells in the books carried, and the skills that can be used. */
  spells(): SpellState | null {
    const json = this.callJson<SpellState>((mod) => mod._web_spells_json());
    return json && json.ready ? json : null;
  }

  /** The skills screen's whole list, in its order, with the values it shows. */
  skillTable(): SkillTable | null {
    const json = this.callJson<SkillTable>((mod) => mod._web_skills_json());
    return json && json.ready && Array.isArray(json.skills) ? json : null;
  }

  /** The abilities screen's whole list, by name. */
  abilityTable(): AbilityTable | null {
    const json = this.callJson<AbilityTable>((mod) => mod._web_abilities_json());
    return json && json.ready && Array.isArray(json.abilities) ? json : null;
  }

  /** While a tome2 screen covers the map, the screen it was drawn over (null when none is saved). */
  savedScreen(): ScreenCopy | null {
    const mod = this.module;
    if (!mod || this.state !== 'running') return null;
    try {
      const ptr = mod._web_saved_screen();
      if (!ptr) return null;
      const at = ptr >> 2;
      const cols = mod.HEAP32[at];
      const rows = mod.HEAP32[at + 1];
      if (cols !== this.buffer.cols || rows !== this.buffer.rows) return null;
      const cells = mod.HEAP32.subarray(at + 2, at + 2 + cols * rows);
      const chars = new Uint8Array(cells.length);
      const attrs = new Uint8Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        chars[i] = cells[i] & 0xff;
        attrs[i] = (cells[i] >> 8) & 0xff;
      }
      return { chars, attrs };
    } catch (err) {
      console.error('Reading the saved screen failed', err);
      return null;
    }
  }

  /** What the player knows about an item: inventory index, or minus the floor object index. */
  objectDescription(item: number): string {
    const mod = this.module;
    if (!mod || this.state !== 'running') return '';
    return mod.UTF8ToString(mod._web_object_desc(item));
  }

  /** Description of an item on the shelf of the shop the player is in, by stock position. */
  storeObjectDescription(index: number): string {
    const mod = this.module;
    if (!mod || this.state !== 'running') return '';
    return mod.UTF8ToString(mod._web_store_object_desc(index));
  }

  monsterRecall(index: number): MonsterRecall | null {
    const json = this.callJson<Partial<MonsterRecall>>((mod) => mod._web_monster_desc(index));
    return json && json.name ? (json as MonsterRecall) : null;
  }

  private callJson<T>(call: (mod: EmscriptenModule) => number): T | null {
    const mod = this.module;
    if (!mod || this.state !== 'running') return null;
    try {
      return JSON.parse(mod.UTF8ToString(call(mod))) as T;
    } catch (err) {
      console.error('Engine returned invalid JSON', err);
      return null;
    }
  }

  /** Lets messages flow past without -more- pauses (tome2's auto_more option). */
  setAutoMore(on: boolean): void {
    const mod = this.module;
    if (!mod || this.state !== 'running') return;
    mod._web_set_auto_more(on ? 1 : 0);
  }

  /** How long each step of a bolt or blast is shown (tome2's delay_factor, 0..9: the cube in ms); 0 draws none. */
  setEffectDelay(factor: number): void {
    const mod = this.module;
    if (!mod || this.state !== 'running') return;
    mod._web_set_effect_delay(factor);
  }

  /** Keeps dungeon levels as the hero left them, or makes them anew on each visit (and forgets kept ones). */
  setPersistentLevels(on: boolean): void {
    const mod = this.module;
    if (!mod || this.state !== 'running') return;
    mod._web_set_persistent_levels(on ? 1 : 0);
  }

  /** Marks grids of the current level (y * width + x) as remembered; returns how many were new. */
  markKnown(cells: readonly number[]): number {
    const mod = this.module;
    if (!mod || this.state !== 'running' || cells.length === 0) return 0;
    try {
      const ptr = mod._web_mark_buffer(cells.length);
      mod.HEAP32.set(cells, ptr >> 2);
      return mod._web_mark_known();
    } catch (err) {
      console.error('Restoring map memory failed', err);
      return 0;
    }
  }

  /** Adds a message of our own to tome2's message log (see `NOTICE_COLOUR`), in tome2's one byte a character. */
  addNotice(text: string): void {
    const mod = this.module;
    if (!mod || this.state !== 'running' || !text) return;
    try {
      const bytes = Uint8Array.from(keyCodes(text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-')));
      const ptr = mod._web_notice_buffer(bytes.length);
      mod.HEAPU8.set(bytes, ptr);
      mod._web_add_notice();
    } catch (err) {
      console.error('Adding a notice to the message log failed', err);
    }
  }

  features(): FeatureInfo[] {
    const mod = this.module;
    if (!mod || this.state !== 'running') return [];
    return JSON.parse(mod.UTF8ToString(mod._web_features_json())) as FeatureInfo[];
  }

  get savePath(): string | null {
    return this.bridge.storagePath ?? null;
  }

  /** Number of keys sent but not yet read by the engine. */
  get pendingKeys(): number {
    return this.queue.length;
  }

  /** True while the engine is blocked waiting for a key with nothing queued. */
  get awaitingInput(): boolean {
    return this.waiter !== null && this.queue.length === 0;
  }

  /** Queues key codes for the engine; codes outside 0..255 are dropped rather than wrapped into control keys. */
  sendKeys(codes: number[]): void {
    if (this.state !== 'running' && this.state !== 'loading') return;
    for (const code of codes) {
      if (!Number.isInteger(code) || code < 0 || code > 0xff) continue;
      const key = code;
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(key);
      } else {
        this.queue.push(key);
      }
    }
  }

  /** Error message when saves could not be loaded, which disables syncing. */
  get storageError(): string | null {
    return this.bridge.storageError ?? null;
  }

  /** Writes the in-memory save tree to IndexedDB; calls are serialised. */
  syncNow(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    const fs = this.fs;
    if (!fs || !this.savePath || this.storageError) return Promise.resolve();
    const run = this.syncChain.catch(() => undefined).then(() => syncToStorage(fs));
    this.syncChain = run;
    return run;
  }

  private scheduleSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncNow().catch((err) => console.error('Saving to browser storage failed', err));
    }, SAVE_SYNC_DELAY_MS);
  }

  private readonly bridge: TomeBridge = {
    waitKey: () => {
      this.scheduleSync();
      this.events.onIdle?.();
      const next = this.queue.shift();
      if (next !== undefined) {
        this.events.onKey?.(next);
        return Promise.resolve(next);
      }
      return new Promise<number>((resolve) => {
        this.waiter = (key) => {
          this.events.onKey?.(key);
          resolve(key);
        };
      });
    },
    pollKey: () => {
      const next = this.queue.shift();
      if (next === undefined) return -1;
      this.events.onKey?.(next);
      return next;
    },
    drawText: (x, y, attr, text) => this.buffer.drawText(x, y, attr, text),
    drawCursor: (x, y) => {
      this.cursorDrawn = true;
      this.buffer.setCursor(x, y);
    },
    clear: () => this.buffer.clear(),
    flush: () => {
      if (!this.cursorDrawn && this.buffer.cursorY >= 0) this.buffer.setCursor(-1, -1);
      this.cursorDrawn = false;
      this.events.onFlush?.();
    },
    effectFrame: () => this.events.onEffectFrame?.(),
    bell: () => {
      if ('vibrate' in navigator) navigator.vibrate(20);
    },
    setTitle: (title) => {
      document.title = title ? `ToME 2 — ${title}` : 'ToME 2';
    },
    setColour: (index, r, g, b) => this.buffer.setColour(index, r, g, b),
    quit: (message) => {
      this.quitMessage = message;
    },
  };

  /** Forgets an engine that has exited, so start() can run a fresh one without reloading the page. */
  reset(): void {
    if (this.state === 'running' || this.state === 'loading') throw new Error(`Engine still ${this.state}`);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.state = 'idle';
    this.module = null;
    this.queue.length = 0;
    this.waiter = null;
    this.quitMessage = null;
    this.cursorDrawn = false;
    this.bridge.storagePath = undefined;
    this.bridge.storageError = undefined;
  }

  async start(engineUrl: string, args: string[] = []): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Engine already ${this.state}`);
    this.state = 'loading';

    let createModule: CreateModule;
    try {
      const imported = (await import(/* @vite-ignore */ engineUrl)) as { default: CreateModule };
      createModule = imported.default;
    } catch (err) {
      this.fail(`Could not load the game engine: ${String(err)}`);
      return;
    }

    try {
      this.module = await createModule({
        tome: this.bridge,
        arguments: [...args],
        locateFile: (path) => {
          const url = new URL(path, engineUrl);
          url.search = new URL(engineUrl).search;
          return url.href;
        },
        print: (text) => console.log(text),
        printErr: (text) => console.warn(text),
        setStatus: (text) => {
          if (text) this.events.onStatus(text, parseDownloadStatus(text));
        },
        onExit: (status) => this.handleExit(status),
        onAbort: (what) => this.fail(`The game engine crashed: ${String(what)}`),
      });
    } catch (err) {
      if (this.state === 'loading') this.fail(`The game engine failed to start: ${String(err)}`);
      return;
    }

    if (this.state === 'loading') {
      this.state = 'running';
      this.events.onRunning();
    }
  }

  private handleExit(status: number): void {
    if (this.state === 'exited' || this.state === 'failed') return;
    this.state = 'exited';
    this.waiter = null;
    const message = this.quitMessage ?? (status === 0 ? null : `Exited with status ${status}`);
    this.syncNow().then(
      () => this.events.onExit(message),
      (err) => {
        console.error('Final save sync failed', err);
        this.state = 'failed';
        this.events.onError(`The game ended, but saving to browser storage failed (${String(err)}). Recent progress may be lost.`);
      },
    );
  }

  private fail(message: string): void {
    if (this.state === 'failed') return;
    this.state = 'failed';
    this.waiter = null;
    this.events.onError(message);
  }
}
