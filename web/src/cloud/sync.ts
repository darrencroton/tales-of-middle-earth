/**
 * Cloud sync: keeps this device's heroes, Hall of Fame and deeds in step with
 * the cloud. On the title screen a full sync brings in what other devices
 * saved, merges what both changed and sends what changed here; during a game
 * only what changed here is sent, and the hero's lease says where they are
 * played. See AGENTS.md (Cloud sync).
 */
import { saveBase as heroSaveBase } from '../play/adventurers.ts';
import { collectFiles, storagePrint, syncToStorage, type EmscriptenFS } from '../saves.ts';
import { CloudClient, CloudError, passkeysSupported } from './client.ts';
import { clearBase, loadAccount, loadBase, saveAccount, saveBase, type Account, type Base } from './local.ts';
import { mergeAdventurers, mergeChronicle, mergeMapMemory, mergeSaveIndex, mergeScores, type Winner } from './merge.ts';
import {
  fullPlan,
  heroChanges,
  heroOf,
  heroWinner,
  keptLeases,
  playingElsewhere,
  pushFiles,
  sharedFile,
  takenElsewhere,
  type FileList,
  type HeroChange,
} from './plan.ts';
import { sha256Hex, type Lease, type Manifest, type SyncState } from './protocol.ts';

/** How long the start-up sync may hold up the title screen. */
const BOOT_WAIT_MS = 3000;
/** Pushes while playing wait this long after a save, so a burst of saves sends once. */
const PUSH_DELAY_MS = 4000;
/** While playing, the lease is renewed this often. */
const HEARTBEAT_MS = 4 * 60 * 1000;
/** The title screen syncs again on returning to it after this long. */
const TITLE_AGAIN_MS = 30 * 1000;
/** Syncs failing for this long are worth a word on the title screen. */
const FAILING_NOTICE_MS = 2 * 24 * 60 * 60 * 1000;
const COMMIT_TRIES = 4;

export type CloudState = 'unavailable' | 'off' | 'syncing' | 'synced' | 'offline' | 'signedOut' | 'error';

/** One copy of a hero in "Which journey continues?". */
export interface JourneySide {
  /** Where this copy is: "This iPhone", "iPad". */
  where: string;
  /** When the other device last synced (ms, this device's clock). */
  sent?: number;
  /** "Level 12 Human Warrior". */
  line?: string;
  level?: number;
  place?: string;
  /** When last saved (ISO). */
  saved?: string;
  fallen: boolean;
}

export interface JourneyChoice {
  hero: string;
  /** When the two copies were last the same (ms, this device's clock), when known. */
  inStep?: number;
  local: JourneySide;
  remote: JourneySide;
  /** The copy played furthest: a fallen one, else the higher level, else the one saved last. */
  suggested: 'local' | 'remote';
}

export interface CloudDeps {
  /** The service's root, or null when the app was built without one. */
  url: string | null;
  /** The engine's storage while it runs. */
  storage(): { fs: EmscriptenFS; root: string } | null;
  /** Writes the engine's storage to the browser. */
  persist(): Promise<void>;
  /** True while the title screen offers its choices (a hero can be continued). */
  atTitle(): boolean;
  /** True while the title screen offers its choices with nothing open over them: its sync may start the title again. */
  idle(): boolean;
  /** Files here are about to change on the title screen: nothing may be chosen there until it starts again. */
  writing(): void;
  /** Starts the engine again, so tome2 lists the heroes as they now are. */
  restartTitle(): void;
  chooseJourney(choice: JourneyChoice): Promise<'local' | 'remote' | null>;
  /** Asks whether to take a hero played on another device; true to take them. */
  confirmTakeover(hero: string, lease: Lease, ageMs: number): Promise<boolean>;
  /** The hero in play has been taken up on another device. */
  lost(hero: string, lease: Lease): void;
  notify(text: string): void;
  /** The status changed. */
  changed(): void;
}

interface Held {
  base: string;
  /** Server time of the lease this device last knew for the hero: another written later took them. */
  since: number;
  /** The device this one took the hero from, kept in its lease. */
  over?: string;
  lost: boolean;
}

interface LocalFiles {
  list: FileList;
  bytes: Map<string, Uint8Array>;
  print: string;
}

/** What the player calls this device. */
export function deviceName(ua = navigator.userAgent, touch = navigator.maxTouchPoints): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'other device';
}

async function readLocal(fs: EmscriptenFS, root: string): Promise<LocalFiles> {
  const print = storagePrint(fs, root);
  const list: FileList = {};
  const bytes = new Map<string, Uint8Array>();
  for (const file of collectFiles(fs, root)) {
    list[file.path] = { hash: await sha256Hex(file.data), size: file.data.length };
    bytes.set(file.path, file.data);
  }
  return { list, bytes, print };
}

function writeFile(fs: EmscriptenFS, root: string, path: string, data: Uint8Array): void {
  const absolute = `${root}/${path}`;
  fs.mkdirTree(absolute.slice(0, absolute.lastIndexOf('/')));
  fs.writeFile(absolute, data);
}

/** JSON with every object's keys in order, so two devices' lists compare alike. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

function sharedContents(files: LocalFiles): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [path, data] of files.bytes) if (sharedFile(path)) out[path] = data;
  return out;
}

const decoder = new TextDecoder();

/** A hero's title details and whether tome2's index has them fallen, from the two files. */
function heroFacts(base: string, adventurers: Uint8Array | null, index: Uint8Array | null): Omit<JourneySide, 'where'> & { name?: string } {
  const facts: Omit<JourneySide, 'where'> & { name?: string } = { fallen: false };
  try {
    const heroes = (JSON.parse(decoder.decode(adventurers ?? new Uint8Array())) as { heroes?: Record<string, { name: string; level: number; race: string; cls: string; place: string; saved: string }> }).heroes ?? {};
    const entry = Object.values(heroes).find((h) => heroSaveBase(h.name) === base);
    if (entry) Object.assign(facts, { name: entry.name, level: entry.level, line: `Level ${entry.level} ${[entry.race, entry.cls].filter(Boolean).join(' ')}`, place: entry.place, saved: entry.saved });
  } catch {
    /* No details: the card shows less. */
  }
  const line = index ? decoder.decode(index).split('\n').find((l) => new RegExp(`^(?:[^@]*@)?[01]${base}@`).test(l.trim())) : undefined;
  if (line && /^(?:[^@]*@)?0/.test(line.trim())) facts.fallen = true;
  return facts;
}

function suggestion(local: JourneySide, remote: JourneySide): 'local' | 'remote' {
  if (local.fallen !== remote.fallen) return local.fallen ? 'local' : 'remote';
  if ((local.level ?? 0) !== (remote.level ?? 0)) return (local.level ?? 0) > (remote.level ?? 0) ? 'local' : 'remote';
  return (remote.saved ?? '') > (local.saved ?? '') ? 'remote' : 'local';
}

export class CloudSync {
  private readonly deps: CloudDeps;
  private readonly client: CloudClient | null;
  private account: Account = loadAccount();
  private queue: Promise<unknown> = Promise.resolve();
  private held: Held | null = null;
  private visible = true;
  private state: CloudState;
  private message = '';
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastFull = 0;
  /** Writes of our own to the engine's storage, which must not start another sync. */
  private applying = false;
  /** The engine's storage as the last sync read it (`storagePrint`): a save that changes nothing sends nothing. */
  private print = '';
  private failingTold = false;
  /** Leases the last sync saw, for the title screen. */
  private leases: Manifest['heroes'] = {};
  /** Heroes whose files the cloud holds as they are here. */
  private inStep = new Set<string>();
  /** Files here were changed by the sync under way (the title must start again, even if it then fails). */
  private wrote = false;
  /** A backup is being restored: nothing syncs until the page reloads. */
  private paused = false;

  constructor(deps: CloudDeps) {
    this.deps = deps;
    this.client = deps.url ? new CloudClient(deps.url, () => this.account.session) : null;
    this.state = !this.available ? 'unavailable' : this.account.session ? 'synced' : 'off';
    if (this.account.session) {
      this.leases = {};
      loadBase()
        .then((base) => {
          this.leases = base.heroes;
          this.deps.changed();
        })
        .catch(() => undefined);
    }
    saveAccount(this.account);
  }

  /** The app was built with a sync service and this browser can use passkeys. */
  get available(): boolean {
    return !!this.client && passkeysSupported();
  }

  /** Sync is on for this device. */
  get enabled(): boolean {
    return this.available && !!this.account.session && !this.paused;
  }

  get device(): string {
    return this.account.device;
  }

  get status(): { state: CloudState; synced?: number; message: string } {
    return { state: this.state, synced: this.account.synced, message: this.message };
  }

  get suggested(): boolean {
    return !!this.account.suggested;
  }

  markSuggested(): void {
    this.account.suggested = true;
    saveAccount(this.account);
  }

  /** Where a saved hero was last played, as the last sync saw it, when that was another device. */
  elsewhere(save: string): Lease | null {
    const lease = this.leases[save];
    return lease && lease.device !== this.account.device ? lease : null;
  }

  /** True when the cloud holds the hero as this device does. */
  synced(save: string): boolean {
    return this.enabled && this.inStep.has(save);
  }

  /** When the hero was last the same here and in the cloud (ms, this device's clock). */
  syncedAt(save: string): number | undefined {
    return this.account.inStep?.[save];
  }

  private setState(state: CloudState, message = ''): void {
    this.state = state;
    this.message = message;
    this.deps.changed();
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Notes a failure; the session is dropped when the cloud refuses it. */
  private failed(err: unknown): void {
    const error = err instanceof CloudError ? err : new CloudError('server', err instanceof Error ? err.message : String(err));
    console.warn('Cloud sync failed', error);
    if (error.kind === 'auth') {
      this.account.session = undefined;
      saveAccount(this.account);
      this.setState('signedOut', 'Sign in again to keep syncing.');
      return;
    }
    this.account.failing ??= Date.now();
    saveAccount(this.account);
    this.setState(error.kind === 'offline' ? 'offline' : 'error', error.kind === 'offline' ? 'Your heroes are safe on this device.' : error.message);
  }

  private succeeded(state: SyncState, local?: LocalFiles): void {
    const files = local?.list;
    if (local) this.print = local.print;
    if (state.session) this.account.session = state.session;
    const now = Date.now();
    this.account.synced = now;
    this.account.failing = undefined;
    this.failingTold = false;
    this.leases = state.manifest.heroes;
    if (files) {
      const out = new Set<string>();
      const behind = new Set<string>();
      for (const path of new Set([...Object.keys(files), ...Object.keys(state.manifest.files)])) {
        const hero = heroOf(path);
        if (!hero) continue;
        if (files[path]?.hash === state.manifest.files[path]?.hash) out.add(hero);
        else behind.add(hero);
      }
      this.inStep = new Set([...out].filter((h) => !behind.has(h)));
      const times: Record<string, number> = {};
      for (const hero of [...out, ...behind]) {
        const time = this.inStep.has(hero) ? now : this.account.inStep?.[hero];
        if (time) times[hero] = time;
      }
      this.account.inStep = times;
    }
    saveAccount(this.account);
    this.setState('synced');
  }

  /**
   * The start-up sync, before tome2 reads the saves: brings in what other
   * devices saved while it can in a moment; anything left (no connection in
   * time, a choice to make) waits for the title screen.
   */
  boot(fs: EmscriptenFS, root: string): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    let late = false;
    const sync = this.run(() => this.full(fs, root, 'boot', () => !late)).catch((err) => this.failed(err));
    return Promise.race([sync.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, BOOT_WAIT_MS))]).then(() => {
      late = true;
    });
  }

  /** On the title screen: a full sync, asking about heroes changed on both sides; the title is started again when files here changed. */
  syncAtTitle(force = false): Promise<void> {
    if (!this.enabled || (!force && Date.now() - this.lastFull < TITLE_AGAIN_MS)) return Promise.resolve();
    return this.run(async () => {
      const storage = this.deps.storage();
      if (!storage || !this.deps.idle()) return;
      if (this.account.failing && Date.now() - this.account.failing > FAILING_NOTICE_MS && !this.failingTold) {
        this.failingTold = true;
        const days = Math.floor((Date.now() - this.account.failing) / 86_400_000);
        this.deps.notify(`Couldn't reach the cloud for ${days} days. Your heroes are safe on this device.`);
      }
      const outcome = await this.full(storage.fs, storage.root, 'title', () => this.deps.idle());
      if (outcome.changed) this.deps.restartTitle();
    }).catch((err) => {
      this.failed(err);
      if (this.wrote) this.deps.restartTitle();
    });
  }

  /**
   * Before a saved hero is played: a full sync, then, when another device is
   * playing them now, the player is asked; the lease is then this device's.
   * When another device writes first, the sync runs again, so the hero is
   * never played from an older copy. 'restarted' when the sync brought new
   * files (the title is starting again).
   */
  claim(save: string): Promise<'go' | 'cancel' | 'restarted'> {
    if (!this.enabled) {
      this.held = { base: save, since: 0, lost: false };
      return Promise.resolve('go');
    }
    return this.run(async () => {
      const storage = this.deps.storage();
      if (!storage) return 'go' as const;
      /* The device whose game the player chose to take over, so a retry does not ask again. */
      let confirmed: string | undefined;
      for (let attempt = 0; attempt < COMMIT_TRIES; attempt++) {
        const outcome = await this.full(storage.fs, storage.root, 'title', () => this.deps.atTitle());
        if (outcome.changed) {
          this.deps.restartTitle();
          return 'restarted' as const;
        }
        if (outcome.cancelled) return 'cancel' as const;
        const state = outcome.state;
        const lease = state.manifest.heroes[save];
        let over: string | undefined;
        if (playingElsewhere(lease, this.account.device, state.now)) {
          if (lease!.device !== confirmed && !(await this.deps.confirmTakeover(save, lease!, state.now - lease!.at))) return 'cancel' as const;
          confirmed = over = lease!.device;
        }
        const heroes = keptLeases({ ...state.manifest.heroes, [save]: this.lease(true, over) }, state.manifest.files);
        const result = await this.client!.commit(state.etag, { ...state.manifest, heroes });
        if (result === 'changed' || 'missing' in result) continue;
        this.held = { base: save, since: result.manifest.heroes[save]?.at ?? state.now, over, lost: false };
        this.succeeded(result);
        this.startHeartbeat();
        return 'go' as const;
      }
      this.deps.notify('The cloud kept changing. Try again in a moment.');
      return 'cancel' as const;
    }).catch((err) => {
      this.failed(err);
      if (!this.wrote) return this.offlineClaim(save);
      this.deps.restartTitle();
      return 'restarted' as const;
    });
  }

  /** Playing without the cloud's word: another device's lease written after the last sync takes the hero. */
  private async offlineClaim(save: string): Promise<'go'> {
    const base = await loadBase().catch(() => null);
    this.held = { base: save, since: base?.heroes[save]?.at ?? 0, lost: false };
    this.startHeartbeat();
    return 'go';
  }

  /** The hero in play (a new one too); idempotent. */
  playing(save: string): void {
    if (this.held?.base === save) return;
    this.held = { base: save, since: this.leases[save]?.at ?? 0, lost: false };
    this.startHeartbeat();
  }

  /** The game ended or was saved and left: sends what changed with the hero set down. */
  leave(): Promise<void> {
    this.stopHeartbeat();
    const held = this.held;
    if (!held) return Promise.resolve();
    return this.push(false, this.deps.storage()).finally(() => {
      if (this.held === held) this.held = null;
    });
  }

  /** The engine wrote its storage to the browser; a sync follows when any file changed. */
  saved(inGame: boolean): void {
    if (!this.enabled || this.applying) return;
    const storage = this.deps.storage();
    if (!storage || storagePrint(storage.fs, storage.root) === this.print) return;
    if (inGame) {
      this.schedulePush(this.visible ? PUSH_DELAY_MS : 0);
      return;
    }
    if (this.deps.idle()) void this.syncAtTitle(true);
  }

  /** The page was hidden or shown again. */
  setVisible(visible: boolean, inGame: boolean): void {
    this.visible = visible;
    if (!this.enabled) return;
    if (inGame) {
      this.schedulePush(0);
      return;
    }
    if (visible && this.deps.idle()) void this.syncAtTitle();
  }

  private schedulePush(delay: number): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push(this.visible, this.deps.storage());
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.enabled) return;
    this.heartbeat = setInterval(() => {
      if (this.visible && this.held) void this.push(true, this.deps.storage());
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }

  private lease(playing: boolean, over?: string): Lease {
    return { device: this.account.device, name: deviceName(), playing, at: 0, ...(over ? { over } : {}) };
  }

  /** Sends what changed here during a game, and the lease of the hero in play (`playing` false once set down); `storage` is the engine's as it was asked for (it is gone once the engine has stopped). */
  private push(playing: boolean, storage: { fs: EmscriptenFS; root: string } | null): Promise<void> {
    if (!this.enabled || !storage) return Promise.resolve();
    return this.run(async () => {
      for (let attempt = 0; attempt < COMMIT_TRIES; attempt++) {
        const state = await this.client!.state();
        const base = await loadBase();
        const local = await readLocal(storage.fs, storage.root);
        const held = this.held;
        const lease = held ? state.manifest.heroes[held.base] : undefined;
        if (held && !held.lost && takenElsewhere(lease, this.account.device, held.since)) {
          held.lost = true;
          this.account.yielded = [...new Set([...(this.account.yielded ?? []), held.base])];
          saveAccount(this.account);
          this.deps.lost(held.base, lease!);
        }
        const { files, pushed } = pushFiles(local.list, state.manifest.files, base.files, held?.lost ? held.base : null);
        const heroes = { ...state.manifest.heroes };
        if (held && !held.lost) heroes[held.base] = this.lease(playing, held.over);
        const kept = keptLeases(heroes, files);
        const mine = held && !held.lost ? kept[held.base] : undefined;
        const old = held ? state.manifest.heroes[held.base] : undefined;
        const leaseDue = !!mine && (!old || old.device !== mine.device || old.playing !== mine.playing || state.now - old.at > HEARTBEAT_MS / 2);
        if (!pushed.length && !leaseDue) {
          this.succeeded(state, local);
          return;
        }
        await this.upload(pushed.filter((p) => local.list[p]), local, state.manifest.files);
        const result = await this.client!.commit(state.etag, { rev: state.manifest.rev, files, heroes: kept });
        if (result === 'changed' || 'missing' in result) continue;
        const nextBase: Base = { files: { ...base.files }, heroes: result.manifest.heroes, contents: { ...base.contents } };
        for (const path of pushed) {
          if (local.list[path]) nextBase.files[path] = local.list[path];
          else delete nextBase.files[path];
          if (sharedFile(path)) {
            const data = local.bytes.get(path);
            if (data) nextBase.contents[path] = data;
            else delete nextBase.contents[path];
          }
        }
        await saveBase(nextBase);
        if (held && !held.lost && result.manifest.heroes[held.base]) held.since = result.manifest.heroes[held.base].at;
        this.succeeded(result, local);
        return;
      }
    }).catch((err) => this.failed(err));
  }

  /** Sends the files the cloud does not have yet. */
  private async upload(paths: readonly string[], local: LocalFiles, remote: FileList): Promise<void> {
    const stored = new Set(Object.values(remote).map((f) => f.hash));
    for (const path of paths) {
      const file = local.list[path];
      if (!file || stored.has(file.hash)) continue;
      await this.client!.putBlob(file.hash, local.bytes.get(path)!);
      stored.add(file.hash);
    }
  }

  /** The heroes changed on both sides, with the choice made or to make for each. */
  private async winners(changes: readonly HeroChange[], state: SyncState, base: Base, local: LocalFiles, chosen: Map<string, 'local' | 'remote'>, ask: boolean): Promise<boolean> {
    let facts: { adventurers: Uint8Array | null; index: Uint8Array | null } | null = null;
    for (const hero of changes) {
      if (heroWinner(hero, state.manifest.heroes[hero.base], this.account.device, chosen, base.heroes[hero.base])) continue;
      if (!ask) return false;
      if (!facts) {
        const find = (name: string) => Object.keys(state.manifest.files).find((p) => p.endsWith(`/${name}`) || p === name);
        const fetch = async (name: string) => {
          const path = find(name);
          return path ? this.client!.getBlob(state.manifest.files[path].hash).catch(() => null) : null;
        };
        facts = { adventurers: await fetch('adventurers.json'), index: await fetch('global.svg') };
      }
      const localPath = (name: string) => [...local.bytes.keys()].find((p) => p.endsWith(`/${name}`) || p === name);
      const mine = heroFacts(hero.base, local.bytes.get(localPath('adventurers.json') ?? '') ?? null, local.bytes.get(localPath('global.svg') ?? '') ?? null);
      const theirs = heroFacts(hero.base, facts.adventurers, facts.index);
      const lease = state.manifest.heroes[hero.base];
      const elsewhere = lease && lease.device !== this.account.device ? lease : null;
      const localSide: JourneySide = { ...mine, where: `This ${deviceName()}` };
      const remoteSide: JourneySide = {
        ...theirs,
        where: elsewhere ? (elsewhere.name === deviceName() ? `Other ${elsewhere.name}` : elsewhere.name) : 'The cloud',
        sent: elsewhere ? Date.now() - (state.now - elsewhere.at) : undefined,
      };
      const choice = await this.deps.chooseJourney({
        hero: mine.name ?? theirs.name ?? hero.base.replace(/_/g, ' '),
        inStep: this.account.inStep?.[hero.base],
        local: localSide,
        remote: remoteSide,
        suggested: suggestion(localSide, remoteSide),
      });
      if (!choice) return false;
      chosen.set(hero.base, choice);
    }
    return true;
  }

  /**
   * A full sync: brings in what changed in the cloud, merges the shared files
   * both changed, sends what changed here. `current` is asked before anything
   * here is written (false: the moment has passed).
   */
  private async full(fs: EmscriptenFS, root: string, mode: 'boot' | 'title', current: () => boolean): Promise<{ changed: boolean; cancelled: boolean; state: SyncState }> {
    this.setState('syncing');
    this.wrote = false;
    const yielded = this.account.yielded ?? [];
    const chosen = new Map<string, 'local' | 'remote'>(yielded.map((hero) => [hero, 'remote']));
    let changedHere = false;
    let state = await this.client!.state();
    for (let attempt = 0; attempt < COMMIT_TRIES; attempt++) {
      if (attempt > 0) state = await this.client!.state();
      let base = await loadBase();
      let local = await readLocal(fs, root);
      const remote = state.manifest.files;
      const changes = heroChanges(local.list, remote, base.files);
      if (!(await this.winners(changes, state, base, local, chosen, mode === 'title'))) {
        this.setState('synced');
        return { changed: changedHere, cancelled: true, state };
      }
      const winnerOf = (hero: string) => {
        const change = changes.find((c) => c.base === hero);
        return change ? heroWinner(change, state.manifest.heroes[hero], this.account.device, chosen, base.heroes[hero]) : null;
      };
      const plan = fullPlan(local.list, remote, base.files, changes, winnerOf);
      const fetched = new Map<string, Uint8Array>();
      for (const path of [...plan.fetch, ...plan.merge]) if (remote[path]) fetched.set(path, await this.client!.getBlob(remote[path].hash));
      const written = this.merged(plan.merge, base, local, fetched, winnerOf);
      for (const path of plan.fetch) written.set(path, fetched.get(path)!);
      for (const [path, data] of written) if (local.list[path]?.hash === (await sha256Hex(data))) written.delete(path);
      if (!changedHere && (this.paused || !current())) {
        this.setState('synced');
        return { changed: false, cancelled: true, state };
      }
      if (written.size || plan.remove.length) {
        if (mode === 'title') this.deps.writing();
        this.wrote = true;
        for (const [path, data] of written) writeFile(fs, root, path, data);
        for (const path of plan.remove) fs.unlink(`${root}/${path}`);
        await this.persist(fs, mode);
        changedHere = true;
        local = await readLocal(fs, root);
      }
      if (plan.fetch.length || plan.merge.length || plan.remove.length) {
        base = this.absorbed(base, [...plan.fetch, ...plan.merge, ...plan.remove], remote, fetched);
        await saveBase(base);
      }
      const files = local.list;
      const leases = { ...state.manifest.heroes };
      for (const hero of changes) if (hero.local && winnerOf(hero.base) === 'local') leases[hero.base] = this.lease(false);
      const heroes = keptLeases(leases, files);
      if (canonical(files) === canonical(remote) && canonical(heroes) === canonical(state.manifest.heroes)) {
        await saveBase({ files, heroes, contents: sharedContents(local) });
        this.settled(yielded);
        this.succeeded(state, local);
        return { changed: changedHere, cancelled: false, state };
      }
      await this.upload(Object.keys(files), local, remote);
      const result = await this.client!.commit(state.etag, { rev: state.manifest.rev, files, heroes });
      if (result === 'changed' || 'missing' in result) continue;
      await saveBase({ files, heroes: result.manifest.heroes, contents: sharedContents(local) });
      this.settled(yielded);
      this.succeeded(result, local);
      return { changed: changedHere, cancelled: false, state: result };
    }
    throw new CloudError('server', 'The cloud kept changing; try again in a moment');
  }

  /** A full sync is done: the heroes yielded to another device are now the cloud's copies. */
  private settled(yielded: readonly string[]): void {
    this.lastFull = Date.now();
    if (!yielded.length) return;
    this.account.yielded = (this.account.yielded ?? []).filter((hero) => !yielded.includes(hero));
    saveAccount(this.account);
  }

  /** The base once the cloud's copies of `paths` are taken in: a later sync sees only what changed since. */
  private absorbed(base: Base, paths: readonly string[], remote: FileList, fetched: Map<string, Uint8Array>): Base {
    const next: Base = { files: { ...base.files }, heroes: base.heroes, contents: { ...base.contents } };
    for (const path of paths) {
      if (remote[path]) next.files[path] = remote[path];
      else delete next.files[path];
      const data = fetched.get(path);
      if (sharedFile(path) && data) next.contents[path] = data;
      else delete next.contents[path];
    }
    return next;
  }

  /** The merged shared files, title details first (their times order the savefile index). */
  private merged(paths: readonly string[], base: Base, local: LocalFiles, fetched: Map<string, Uint8Array>, winner: Winner): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    const rank = ['adventurers.json', 'chronicle.json', 'mapmemory.json', 'scores.raw', 'global.svg'];
    const ordered = [...paths].sort((a, b) => rank.indexOf(sharedFile(a) ?? '') - rank.indexOf(sharedFile(b) ?? ''));
    let adventurers: Uint8Array | null = null;
    for (const path of ordered) {
      const mine = local.bytes.get(path) ?? new Uint8Array();
      const theirs = fetched.get(path) ?? new Uint8Array();
      const old = base.contents[path] ?? null;
      let data: Uint8Array;
      switch (sharedFile(path)) {
        case 'adventurers.json':
          data = adventurers = mergeAdventurers(old, mine, theirs, winner);
          break;
        case 'chronicle.json':
          data = mergeChronicle(old, mine, theirs, winner);
          break;
        case 'mapmemory.json':
          data = mergeMapMemory(old, mine, theirs, winner);
          break;
        case 'scores.raw':
          data = mergeScores(old, mine, theirs);
          break;
        default: {
          const path = [...new Set([...fetched.keys(), ...local.bytes.keys()])].find((p) => sharedFile(p) === 'adventurers.json') ?? '';
          const details = adventurers ?? fetched.get(path) ?? local.bytes.get(path) ?? null;
          data = mergeSaveIndex(old, mine, theirs, winner, recency(details));
        }
      }
      out.set(path, data);
    }
    return out;
  }

  private async persist(fs: EmscriptenFS, mode: 'boot' | 'title'): Promise<void> {
    this.applying = true;
    try {
      if (mode === 'boot') await syncToStorage(fs);
      else await this.deps.persist();
    } finally {
      this.applying = false;
    }
  }

  /** Turns sync on with a new passkey (`existing` false) or one made on another device. */
  async turnOn(existing: boolean): Promise<void> {
    if (!this.client) throw new CloudError('unsupported', 'Cloud sync is not available in this version');
    const { session, user } = existing ? await this.client.login() : await this.client.register();
    if (this.account.user !== user) await this.forgetSync();
    this.account.session = session;
    this.account.user = user;
    this.account.failing = undefined;
    saveAccount(this.account);
    this.lastFull = 0;
    this.setState('synced');
  }

  /** Stops syncing on this device; its heroes stay, and what was last synced is kept for signing in again. */
  turnOff(): void {
    this.stopHeartbeat();
    this.account.session = undefined;
    this.account.failing = undefined;
    saveAccount(this.account);
    this.inStep.clear();
    this.setState('off');
  }

  /** Deletes everything the cloud keeps, and stops syncing here. */
  async deleteCloud(): Promise<void> {
    if (!this.client || !this.account.session) return;
    await this.run(() => this.client!.deleteAccount());
    await this.forgetAccount();
    this.turnOff();
  }

  /** Forgets the account and what was last synced with it, as for a device new to it. */
  private async forgetAccount(): Promise<void> {
    await this.forgetSync();
    this.account.user = undefined;
    this.account.synced = undefined;
    saveAccount(this.account);
  }

  /** Forgets what was last synced: the next sync compares every hero afresh. */
  private async forgetSync(): Promise<void> {
    await clearBase();
    this.account.inStep = undefined;
    this.account.yielded = undefined;
    this.leases = {};
    saveAccount(this.account);
  }

  /**
   * A backup is about to replace everything here, sync on or off: nothing
   * syncs until the page reloads, and the next sync treats this device as new
   * to the account, so heroes that differ ask which journey continues, those
   * only in the cloud come back, and nothing here counts as deleted.
   */
  async restoring(): Promise<void> {
    this.paused = true;
    this.stopHeartbeat();
    await this.run(() => this.forgetSync());
  }
}

/** When each hero was last saved, by savefile name, from the title details (ms; 0 when unknown). */
function recency(adventurers: Uint8Array | null): (base: string) => number {
  const times = new Map<string, number>();
  try {
    const heroes = (JSON.parse(decoder.decode(adventurers ?? new Uint8Array())) as { heroes?: Record<string, { name?: string; saved?: string }> }).heroes ?? {};
    for (const entry of Object.values(heroes)) {
      const time = Date.parse(entry.saved ?? '');
      if (entry.name && Number.isFinite(time)) times.set(heroSaveBase(entry.name), time);
    }
  } catch {
    /* No times: the index keeps its order. */
  }
  return (base) => times.get(base) ?? 0;
}
