import type { GameState, LevelSnapshot } from '../render/snapshot.ts';
import { AmbiencePlayer } from './ambience.ts';
import { AudioCore } from './core.ts';
import {
  attemptOutcome,
  danger,
  doorCues,
  elementFromColour,
  freshMessages,
  intentCue,
  messageCues,
  newThreats,
  outcomeCue,
  playerCues,
  type Cue,
  type CueId,
  type DoorKinds,
  type LauncherKind,
  type SpellTone,
  type WeaponKind,
} from './cues.ts';
import { MusicPlayer } from './music.ts';
import { sceneFor, sceneKey, themeFor, type Place, type View } from './places.ts';
import { SoundEffects } from './sfx.ts';
import { THEME_LIST, themeById, type Theme } from './themes.ts';

export type VolumeLevel = 'off' | 'low' | 'medium' | 'high';

export const VOLUME_GAIN: Record<VolumeLevel, number> = { off: 0, low: 0.3, medium: 0.6, high: 1 };

const TICK_MS = 90;
const RECENT_CUES = 30;
const EFFECT_GAP_MS = 350;
/** Most sounds played for one refresh, and the gap between them. */
const MAX_CUES = 6;
const CUE_STAGGER_S = 0.075;
/** Shortest time between two plays of the same sound. */
const REPEAT_S: Partial<Record<CueId, number>> = {
  gold: 0.3,
  pickup: 0.2,
  danger: 15,
  unique: 6,
  hungry: 60,
  heal: 1,
  'spell-monster': 0.8,
  bolt: 0.25,
  explosion: 0.3,
};
const LOW_HEALTH = 0.3;
const MUFFLED_HZ = 1300;
const OPEN_HZ = 18000;
const BACKSLASH = 0x5c;

interface Intent {
  key: string;
  turn: number;
  /** The school of the spell a cast is for. */
  tone: SpellTone | null;
  /** Its sound has played already, as it was let go (see `effects`). */
  sounded?: boolean;
}

/* Commands whose sound belongs to the moment they are let go: played with the first bolt drawn, or at the end of the turn. */
const RELEASED = new Set<CueId>(['cast', 'fire', 'throw', 'zap', 'activate']);
/* Shots and throws carry their own flight; the bolt drawn for the missile adds no sound of its own. */
const MISSILES = new Set<CueId>(['fire', 'throw']);

/**
 * The game's sound: music chosen by place and story, ambience beneath it,
 * and effects for what happens. Audio starts at once where the browser
 * allows it, otherwise on the first touch or key, and pauses while the page
 * is hidden. The soundtrack can also be listened to on its own.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private core: AudioCore | null = null;
  private music: MusicPlayer | null = null;
  private ambience: AmbiencePlayer | null = null;
  private sfx: SoundEffects | null = null;
  private timer = 0;
  private musicVolume: VolumeLevel;
  private soundVolume: VolumeLevel;
  private view: View = 'title';
  private place: Place | null = null;
  private key = '';
  private doors: DoorKinds | null = null;

  private prevState: GameState | null = null;
  private prevFeat: Uint8Array | null = null;
  private prevLevel = '';
  private turn = 0;
  private intent: Intent | null = null;
  private weapon: WeaponKind = 'unarmed';
  private launcher: LauncherKind | null = null;
  private castTone: SpellTone | null = null;
  private commandNext = false;
  private readonly announced = new Set<number>();
  private readonly lastPlayed = new Map<CueId, number>();
  private effectAt = 0;
  private effectKind: CueId = 'bolt';
  private readonly recent: CueId[] = [];

  private intensityTarget = 0;
  private intensity = 0;
  private health = 1;
  private threatened = false;
  private hurtAt = -Infinity;
  private nextBeat = 0;

  /** Soundtrack listening: one theme, or every theme in turn. */
  private listening: { theme: Theme; all: boolean } | null = null;
  /** Called when the theme being listened to changes (null when listening stops). */
  onListen: ((id: string | null) => void) | null = null;

  constructor(music: VolumeLevel, sound: VolumeLevel) {
    this.musicVolume = music;
    this.soundVolume = sound;
    document.addEventListener('visibilitychange', () => this.visibility());
  }

  /** Audio state, the theme playing and the latest sounds, for the debug hook and tests. */
  get status(): { state: string; ticking: boolean; theme: string | null; scene: string; intensity: number; recent: CueId[] } {
    return {
      state: this.ctx?.state ?? 'off',
      ticking: this.timer !== 0,
      theme: this.music?.theme?.id ?? null,
      scene: this.key,
      intensity: Math.round(this.intensity * 100) / 100,
      recent: [...this.recent],
    };
  }

  /**
   * Starts audio without waiting for a gesture. Browsers that allow it
   * (installed apps, sites played before) begin at once; the rest keep the
   * audio suspended until `unlock` runs inside a gesture.
   */
  start(): void {
    if (document.visibilityState !== 'visible') return;
    this.create();
  }

  /** Starts or resumes audio from inside a user gesture; safe to call often. */
  unlock(): void {
    const created = !this.ctx;
    if (!this.create() || !this.ctx) return;
    if (this.ctx.state === 'running' && !created) return;
    if (document.visibilityState !== 'visible') return;
    try {
      const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const source = this.ctx.createBufferSource();
      source.buffer = silent;
      source.connect(this.ctx.destination);
      source.start();
    } catch {
      /* The silent buffer only helps older iOS start audio. */
    }
    void this.ctx.resume().catch(() => undefined);
  }

  /** Creates the audio graph once; false when audio is off or unavailable. */
  private create(): boolean {
    if (this.ctx) return true;
    if (!this.audible()) return false;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return false;
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'ambient';
    } catch {
      /* Audio sessions are not supported. */
    }
    try {
      this.ctx = new Context({ latencyHint: 'interactive' });
      this.core = new AudioCore(this.ctx);
      this.music = new MusicPlayer(this.core);
      this.ambience = new AmbiencePlayer(this.core);
      this.sfx = new SoundEffects(this.core);
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    } catch (err) {
      console.warn('Audio is unavailable', err);
      this.ctx = null;
      this.core = null;
      return false;
    }
    this.applyVolumes(true);
    this.applyScene(true);
    this.startTimer();
    return true;
  }

  /** The theme being listened to, if any. */
  get listeningTo(): string | null {
    return this.listening?.theme.id ?? null;
  }

  /**
   * Plays a theme from the soundtrack (or every theme in turn for 'all')
   * instead of the music for the current place; null returns to it.
   */
  listen(id: string | 'all' | null): void {
    if (id === null) {
      if (!this.listening) return;
      this.listening = null;
      this.applyVolumes(false);
      this.applyScene(true);
      this.syncRunning();
      this.onListen?.(null);
      return;
    }
    const theme = id === 'all' ? THEME_LIST[0] : themeById(id);
    this.listening = { theme, all: id === 'all' };
    this.unlock();
    this.applyVolumes(false);
    this.syncRunning();
    this.playListened();
  }

  private playListened(): void {
    const listening = this.listening;
    if (!listening) return;
    if (this.music) {
      this.music.play(listening.theme);
      this.ambience?.set([]);
      if (this.sfx) this.sfx.key = { root: listening.theme.root, scale: listening.theme.scale };
    }
    this.onListen?.(listening.theme.id);
  }

  setVolumes(music: VolumeLevel, sound: VolumeLevel): void {
    this.musicVolume = music;
    this.soundVolume = sound;
    if (!this.ctx) return;
    this.applyVolumes(false);
    this.syncRunning();
  }

  /** Runs the audio while anything is audible and the page is visible; suspends it otherwise. */
  private syncRunning(): void {
    if (!this.ctx) return;
    if (!this.audible()) {
      void this.ctx.suspend().catch(() => undefined);
      this.stopTimer();
    } else if (document.visibilityState === 'visible') {
      void this.ctx.resume().catch(() => undefined);
      this.startTimer();
    }
  }

  setView(view: View): void {
    if (view === this.view) return;
    this.view = view;
    if (view !== 'game') this.resetTracking();
    this.applyScene(false);
  }

  setPlace(place: Place | null): void {
    this.place = place;
    this.applyScene(false);
  }

  setDoors(doors: DoorKinds): void {
    this.doors = doors;
  }

  /** What the hero fights and shoots with, for the sounds of their blows and shots. */
  setGear(weapon: WeaponKind, launcher: LauncherKind | null): void {
    this.weapon = weapon;
    this.launcher = launcher;
  }

  /** The school of the spell being cast (one under way, or the next `m` taken), for its casting sound. */
  castingTone(tone: SpellTone | null): void {
    this.castTone = tone;
    if (this.intent?.key === 'm') this.intent.tone = tone;
  }

  /** The engine took a key; `atCommand` says whether it was waiting for a command. */
  keyConsumed(code: number, atCommand: boolean): void {
    if (!this.prevState) return;
    if (this.commandNext) {
      this.commandNext = false;
      this.intent = this.newIntent(code);
      return;
    }
    if (!atCommand) return;
    if (code === BACKSLASH) {
      this.commandNext = true;
      return;
    }
    this.intent = this.newIntent(code);
  }

  /** A command key taken; a cast takes the school armed by `castingTone`. */
  private newIntent(code: number): Intent {
    const key = String.fromCharCode(code);
    const tone = key === 'm' ? this.castTone : null;
    this.castTone = null;
    return { key, turn: this.turn, tone };
  }

  /** Compares with the last state seen and plays what happened. */
  update(snap: LevelSnapshot, state: GameState, inStore: boolean): void {
    const player = state.player;
    if (!player) return;
    const prev = this.prevState;
    const level = `${player.dungeon}:${player.depth}:${player.wild}:${snap.width}x${snap.height}`;
    const sameLevel = level === this.prevLevel;
    const cues: Cue[] = [];
    let ranged = false;

    if (prev && prev.player?.name === player.name) {
      const heard = new Set<CueId>();
      let intentPlayed = false;
      const fresh = freshMessages(prev, state);
      const intent = this.intent;
      if (intent) {
        const tookTime = snap.turn !== intent.turn;
        ranged = RELEASED.has(intentCue(intent.key)?.id ?? 'hit');
        /* A failure sounds as soon as tome2 reports it. */
        const failed = !!intentCue(intent.key) && attemptOutcome(true, fresh)?.kind === 'failed';
        const cue = failed ? ({ id: 'fizzle' } as Cue) : tookTime || snap.atCommand ? outcomeCue(intent.key, tookTime, fresh) : null;
        if (cue && !(intent.sounded && RELEASED.has(cue.id))) cues.push(this.voiced(cue, intent));
        if (cue) intentPlayed = cue.id !== 'deny';
        if (cue || tookTime || !intentCue(intent.key)) this.intent = null;
      }
      for (const text of fresh) {
        for (const cue of messageCues(text)) {
          if (cue.id === 'pickup' && intentPlayed) continue;
          heard.add(cue.id);
          cues.push(cue);
        }
      }
      if (prev.player) cues.push(...playerCues(prev.player, player, heard, inStore));
      if (sameLevel && this.prevFeat && this.doors) cues.push(...doorCues(this.prevFeat, snap.feat, snap.width, snap.px, snap.py, this.doors));
      if (!heard.has('hit') && !heard.has('kill') && !heard.has('crit')) {
        const before = new Map((prev.monsters ?? []).map((m) => [m.id, m.hp]));
        if ((state.monsters ?? []).some((m) => (before.get(m.id) ?? m.hp) > m.hp)) cues.push({ id: 'impact', strength: 0.6 });
      }
      if (!sameLevel) this.announced.clear();
      const threats = newThreats(prev.monsters ?? [], state.monsters ?? [], player.lev, this.announced);
      for (const m of [...threats.unique, ...threats.strong]) this.announced.add(m.id);
      if (threats.unique.length) cues.push({ id: 'unique' });
      else if (threats.strong.length) cues.push({ id: 'danger' });
      if (cues.some((c) => c.id === 'hurt' || c.id === 'bite' || c.id === 'claw')) this.hurtAt = performance.now();
      if (cues.some((c) => c.id === 'kill') && prev.monsters?.some((m) => m.unique && !(state.monsters ?? []).some((n) => n.id === m.id))) {
        const index = cues.findIndex((c) => c.id === 'kill');
        cues[index] = { id: 'kill-unique' };
      }
    }

    /* Blows take the weapon wielded; a spell's or shot's great hit is a heavy impact. */
    const melee = !ranged && cues.some((c) => c.id === 'hit' || c.id === 'crit');
    for (let i = 0; i < cues.length; i++) {
      const id = cues[i].id;
      if (ranged && id === 'crit') cues[i] = { id: 'impact', strength: 1 };
      else if (!ranged && (id === 'hit' || id === 'crit' || (melee && (id === 'kill' || id === 'kill-unique')))) cues[i] = { ...cues[i], variant: this.weapon };
    }

    this.prevState = state;
    this.prevFeat = snap.feat;
    this.prevLevel = level;
    this.turn = snap.turn;
    this.health = player.mhp > 0 ? Math.max(0, player.chp) / player.mhp : 1;
    const monsters = state.monsters ?? [];
    this.intensityTarget = player.status.hallucinating ? 0.3 : danger(player, monsters, snap.py, snap.px);
    this.threatened = monsters.some((m) => m.status < 0 && !m.asleep);
    this.play(cues);
  }

  /** A command's own sound, coloured by what is behind it: the spell's school, the launcher. */
  private voiced(cue: Cue, intent: Intent): Cue {
    if (cue.id === 'cast' && intent.tone) return { ...cue, variant: intent.tone };
    if (cue.id === 'fire' && this.launcher) return { ...cue, variant: this.launcher };
    return cue;
  }

  /** The sound of the command under way, once, when what it lets go is first drawn (a spell's bolt, an arrow). */
  private release(): Cue | null {
    const intent = this.intent;
    const cue = intent && !intent.sounded ? intentCue(intent.key) : null;
    if (!intent || !cue || !RELEASED.has(cue.id)) return null;
    intent.sounded = true;
    return this.voiced(cue, intent);
  }

  /** A bolt or explosion is being drawn over the map; one drawn during the hero's own spell, shot or throw sounds it first, just before the bolt. */
  effects(cells: readonly { attr: number }[], heroActing: boolean): void {
    if (!cells.length) return;
    const now = performance.now();
    const kind: CueId = cells.length > 6 ? 'explosion' : 'bolt';
    const continuing = now - this.effectAt < EFFECT_GAP_MS;
    this.effectAt = now;
    const release = heroActing ? this.release() : null;
    /* One sound per animation, except the blast at the end of a ball spell. */
    if (continuing && !release && !(kind === 'explosion' && this.effectKind === 'bolt')) return;
    this.effectKind = kind;
    const counts = new Map<number, number>();
    for (const c of cells) counts.set(c.attr, (counts.get(c.attr) ?? 0) + 1);
    const attr = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const drawn: Cue = { id: kind, element: elementFromColour(attr) };
    this.play(release ? (MISSILES.has(release.id) && kind === 'bolt' ? [release] : [release, drawn]) : [drawn]);
  }

  /** Plays a sound that is not tied to game state (shop bell, menus). */
  cue(id: CueId, strength?: number): void {
    this.play([{ id, strength }]);
  }

  private play(cues: Cue[]): void {
    if (!this.sfx || !this.ctx || this.ctx.state !== 'running' || this.soundVolume === 'off') return;
    const now = this.ctx.currentTime;
    const counts = new Map<CueId, number>();
    let played = 0;
    for (const cue of cues) {
      if (played >= MAX_CUES) break;
      const count = counts.get(cue.id) ?? 0;
      if (count >= 2) continue;
      const last = this.lastPlayed.get(cue.id) ?? -Infinity;
      if (now - last < (REPEAT_S[cue.id] ?? 0.05)) continue;
      counts.set(cue.id, count + 1);
      this.lastPlayed.set(cue.id, now);
      this.sfx.play(cue, played * CUE_STAGGER_S);
      this.recent.push(cue.id);
      if (this.recent.length > RECENT_CUES) this.recent.shift();
      played++;
    }
  }

  private audible(): boolean {
    return this.musicVolume !== 'off' || this.soundVolume !== 'off' || this.listening !== null;
  }

  /** Music volume, raised from off while the soundtrack is being listened to. */
  private effectiveMusic(): VolumeLevel {
    return this.listening && this.musicVolume === 'off' ? 'medium' : this.musicVolume;
  }

  private applyVolumes(immediate: boolean): void {
    const core = this.core;
    if (!core) return;
    const now = core.now;
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, 0.15);
    };
    set(core.musicVolume.gain, VOLUME_GAIN[this.effectiveMusic()] * 0.75);
    set(core.soundVolume.gain, VOLUME_GAIN[this.soundVolume]);
    if (this.effectiveMusic() === 'off') this.music?.stop();
    else this.applyScene(true);
  }

  private applyScene(force: boolean): void {
    const scene = sceneFor(this.view, this.place);
    const key = sceneKey(scene);
    if (!force && key === this.key) return;
    this.key = key;
    if (!this.music || !this.ambience || !this.sfx) return;
    if (this.listening) {
      this.playListened();
      return;
    }
    const theme = themeFor(scene);
    this.sfx.key = { root: theme.root, scale: theme.scale };
    this.ambience.set(theme.ambience);
    if (this.musicVolume !== 'off') this.music.play(theme);
  }

  private resetTracking(): void {
    this.prevState = null;
    this.prevFeat = null;
    this.prevLevel = '';
    this.intent = null;
    this.castTone = null;
    this.commandNext = false;
    this.announced.clear();
    this.intensityTarget = 0;
    this.health = 1;
    this.threatened = false;
  }

  private tick(): void {
    const core = this.core;
    if (!core || !this.ctx || this.ctx.state !== 'running') return;
    const dt = TICK_MS / 1000;
    const tau = this.intensityTarget > this.intensity ? 2.5 : 12;
    this.intensity += (this.intensityTarget - this.intensity) * (1 - Math.exp(-dt / tau));
    this.music?.setIntensity(this.listening ? 0 : this.intensity);
    const listening = this.listening;
    if (listening?.all && this.music && this.music.piecesDone >= 1) {
      const next = THEME_LIST[(THEME_LIST.indexOf(listening.theme) + 1) % THEME_LIST.length];
      this.listening = { theme: next, all: true };
      this.playListened();
    }
    try {
      this.music?.tick();
      this.ambience?.tick();
    } catch (err) {
      console.warn('Audio tick failed', err);
    }

    const low = this.view === 'game' && this.health < LOW_HEALTH && this.health > 0;
    const target = low ? MUFFLED_HZ + this.health * 3000 : OPEN_HZ;
    if (Math.abs(core.musicTone.frequency.value - target) > 50) core.musicTone.frequency.setTargetAtTime(target, core.now, 0.6);
    const recentlyHurt = performance.now() - this.hurtAt < 8000;
    if (low && (this.threatened || recentlyHurt) && core.now >= this.nextBeat) {
      const urgency = 1 - this.health / LOW_HEALTH;
      this.sfx?.play({ id: 'heartbeat', strength: 0.4 + urgency * 0.6 });
      this.nextBeat = core.now + 1.15 - urgency * 0.4;
    }
  }

  private startTimer(): void {
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private visibility(): void {
    if (!this.ctx) return;
    if (document.visibilityState === 'hidden') {
      void this.ctx.suspend().catch(() => undefined);
      this.stopTimer();
    } else if (this.audible()) {
      void this.ctx.resume().catch(() => undefined);
      this.startTimer();
    }
  }
}
