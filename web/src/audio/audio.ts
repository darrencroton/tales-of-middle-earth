import type { GameState, LevelSnapshot } from '../render/snapshot.ts';
import { AmbiencePlayer } from './ambience.ts';
import { AudioCore } from './core.ts';
import {
  danger,
  doorCues,
  elementFromColour,
  freshMessages,
  intentCue,
  messageCues,
  newThreats,
  playerCues,
  type Cue,
  type CueId,
  type DoorKinds,
} from './cues.ts';
import { MusicPlayer } from './music.ts';
import { sceneFor, sceneKey, themeFor, type Place, type View } from './places.ts';
import { SoundEffects } from './sfx.ts';

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
}

/**
 * The game's sound: music chosen by place and story, ambience beneath it,
 * and effects for what happens. Audio starts on the first touch or key
 * (browsers require a gesture) and pauses while the page is hidden.
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

  constructor(music: VolumeLevel, sound: VolumeLevel) {
    this.musicVolume = music;
    this.soundVolume = sound;
    document.addEventListener('visibilitychange', () => this.visibility());
  }

  /** Audio state, the theme playing and the latest sounds, for the debug hook and tests. */
  get status(): { state: string; theme: string | null; scene: string; intensity: number; recent: CueId[] } {
    return {
      state: this.ctx?.state ?? 'off',
      theme: this.music?.theme?.id ?? null,
      scene: this.key,
      intensity: Math.round(this.intensity * 100) / 100,
      recent: [...this.recent],
    };
  }

  /** Starts audio from inside a user gesture; safe to call often. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && this.audible() && document.visibilityState === 'visible') void this.ctx.resume().catch(() => undefined);
      return;
    }
    if (!this.audible()) return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
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
      const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const source = this.ctx.createBufferSource();
      source.buffer = silent;
      source.connect(this.ctx.destination);
      source.start();
      void this.ctx.resume().catch(() => undefined);
    } catch (err) {
      console.warn('Audio is unavailable', err);
      this.ctx = null;
      this.core = null;
      return;
    }
    this.applyVolumes(true);
    this.applyScene(true);
    this.startTimer();
  }

  setVolumes(music: VolumeLevel, sound: VolumeLevel): void {
    this.musicVolume = music;
    this.soundVolume = sound;
    if (!this.ctx) return;
    this.applyVolumes(false);
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

  /** The engine took a key; `atCommand` says whether it was waiting for a command. */
  keyConsumed(code: number, atCommand: boolean): void {
    if (!this.prevState) return;
    if (this.commandNext) {
      this.commandNext = false;
      this.intent = { key: String.fromCharCode(code), turn: this.turn };
      return;
    }
    if (!atCommand) return;
    if (code === BACKSLASH) {
      this.commandNext = true;
      return;
    }
    this.intent = { key: String.fromCharCode(code), turn: this.turn };
  }

  /** Compares with the last state seen and plays what happened. */
  update(snap: LevelSnapshot, state: GameState, inStore: boolean): void {
    const player = state.player;
    if (!player) return;
    const prev = this.prevState;
    const level = `${player.dungeon}:${player.depth}:${player.wild}:${snap.width}x${snap.height}`;
    const sameLevel = level === this.prevLevel;
    const cues: Cue[] = [];

    if (prev && prev.player?.name === player.name) {
      const heard = new Set<CueId>();
      let intentPlayed = false;
      if (this.intent && snap.turn !== this.intent.turn) {
        const cue = intentCue(this.intent.key);
        if (cue) {
          cues.push(cue);
          intentPlayed = true;
        }
        this.intent = null;
      }
      for (const text of freshMessages(prev, state)) {
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

  /** A bolt or explosion is being drawn over the map. */
  effects(cells: readonly { attr: number }[]): void {
    if (!cells.length) return;
    const now = performance.now();
    const kind: CueId = cells.length > 6 ? 'explosion' : 'bolt';
    const continuing = now - this.effectAt < EFFECT_GAP_MS;
    this.effectAt = now;
    /* One sound per animation, except the blast at the end of a ball spell. */
    if (continuing && !(kind === 'explosion' && this.effectKind === 'bolt')) return;
    this.effectKind = kind;
    const counts = new Map<number, number>();
    for (const c of cells) counts.set(c.attr, (counts.get(c.attr) ?? 0) + 1);
    const attr = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    this.play([{ id: kind, element: elementFromColour(attr) }]);
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
    return this.musicVolume !== 'off' || this.soundVolume !== 'off';
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
    set(core.musicVolume.gain, VOLUME_GAIN[this.musicVolume] * 0.75);
    set(core.soundVolume.gain, VOLUME_GAIN[this.soundVolume]);
    if (this.musicVolume === 'off') this.music?.stop();
    else this.applyScene(true);
  }

  private applyScene(force: boolean): void {
    const scene = sceneFor(this.view, this.place);
    const key = sceneKey(scene);
    if (!force && key === this.key) return;
    this.key = key;
    if (!this.music || !this.ambience || !this.sfx) return;
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
    this.music?.setIntensity(this.intensity);
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
