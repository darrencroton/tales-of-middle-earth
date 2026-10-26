import type { FeatureInfo } from './render/materials.ts';
import {
  readSnapshot,
  type CharacterState,
  type GameState,
  type InventoryState,
  type LevelSnapshot,
  type MonsterRecall,
} from './render/snapshot.ts';
import type { TerminalBuffer } from './terminal.ts';
import { syncToStorage, type EmscriptenFS } from './saves.ts';

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

  inventory(): InventoryState | null {
    const json = this.callJson<InventoryState>((mod) => mod._web_inventory_json());
    return json && json.ready ? json : null;
  }

  character(): CharacterState | null {
    const json = this.callJson<CharacterState>((mod) => mod._web_character_json());
    return json && json.ready ? json : null;
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
      if (next !== undefined) return Promise.resolve(next);
      return new Promise<number>((resolve) => {
        this.waiter = resolve;
      });
    },
    pollKey: () => this.queue.shift() ?? -1,
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
        arguments: args,
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
