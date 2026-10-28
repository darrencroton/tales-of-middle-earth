import { barStretch, Composer, pivotChord, secondsPerBar, sombreness, type PieceSection } from './composer.ts';
import type { AudioCore } from './core.ts';
import { themeGain, type Instrument, type Role, type Theme } from './themes.ts';
import { hashString } from './theory.ts';
import { playVoice } from './voices.ts';

/** How far ahead bars are written to the audio clock. */
const LOOKAHEAD_S = 0.35;
const FIRST_FADE_S = 0.5;
const FADE_OUT_S = 1.8;
/** Longest wait for the bar to end before changing theme. */
const MAX_WAIT_S = 2.4;
/** Longest pivot between two themes. */
const MAX_PIVOT_S = 3.2;
/** How much faster than written a theme plays at full intensity above its floor. */
const DRIVE = 0.08;
/** Largest change of drive from one bar to the next. */
const DRIVE_STEP = 0.02;

const SUSTAINED: ReadonlySet<Role> = new Set(['pad', 'drone']);

interface Playback {
  theme: Theme;
  composer: Composer;
  bus: GainNode;
  /** The bus gain once faded in. */
  level: number;
  pans: Map<number, StereoPannerNode>;
  piece: PieceSection[];
  section: number;
  bar: number;
  globalBar: number;
  /** Audio-clock time of the next bar. */
  nextAt: number;
  /** Length of the last bar written, in seconds. */
  barSeconds: number;
  /** Tempo multiplier that follows intensity. */
  drive: number;
  /** Pieces finished so far. */
  pieces: number;
}

/**
 * Plays themes: each piece is composed bar by bar just ahead of the audio
 * clock and the next follows without a pause. Changing theme finishes the
 * beat, plays a pivot chord into the new key and starts the new theme on
 * the next bar; intensity brings in a theme's danger layers at the next bar.
 */
export class MusicPlayer {
  private readonly core: AudioCore;
  private current: Playback | null = null;
  private readonly fading: Playback[] = [];
  private intensity = 0;
  private seed = (Date.now() >>> 0) ^ 0x5bd1e995;

  constructor(core: AudioCore) {
    this.core = core;
  }

  get theme(): Theme | null {
    return this.current?.theme ?? null;
  }

  /** Current intensity after the theme's floor. */
  get level(): number {
    return Math.max(this.intensity, this.current?.theme.floor ?? 0);
  }

  /** Pieces of the current theme played to the end. */
  get piecesDone(): number {
    return this.current?.pieces ?? 0;
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  /** Moves to a theme through a pivot chord, or fades to silence for null. */
  play(theme: Theme | null): void {
    if (this.current && theme && this.current.theme.id === theme.id && sameShape(this.current.theme, theme)) return;
    const now = this.core.now;
    const previous = this.current;
    this.current = null;
    if (!theme) {
      if (previous) this.release(previous, now);
      return;
    }
    const bus = this.core.ctx.createGain();
    const level = themeGain(theme.id);
    bus.connect(this.core.musicIn);
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    const composer = new Composer(theme, (hashString(theme.id) ^ this.seed) >>> 0);
    const playback: Playback = {
      theme,
      composer,
      bus,
      level,
      pans: new Map(),
      piece: composer.plan(!previous),
      section: 0,
      bar: 0,
      globalBar: 0,
      nextAt: now + 0.1,
      barSeconds: secondsPerBar(theme),
      drive: 1,
      pieces: 0,
    };
    bus.gain.setValueAtTime(0.0001, now);
    if (previous) {
      const cut = this.nextBeat(previous, now);
      const gloom = Math.max(sombreness(previous.theme), sombreness(theme));
      this.release(previous, cut, FADE_OUT_S * (1 + gloom * 0.8));
      bus.gain.linearRampToValueAtTime(level, cut);
      playback.nextAt = cut + this.writePivot(playback, previous.theme, cut);
    } else {
      bus.gain.linearRampToValueAtTime(level, now + FIRST_FADE_S);
    }
    this.current = playback;
    this.core.musicReverb.gain.setTargetAtTime(0.25 + theme.space * 0.75, now, 1.2);
    this.core.musicEcho.gain.setTargetAtTime((theme.echo ?? 0) * 0.5, now, 1.2);
  }

  stop(): void {
    if (this.current) this.release(this.current, this.core.now);
    this.current = null;
  }

  /** Writes bars that fall within the look-ahead window. */
  tick(): void {
    const now = this.core.now;
    const playback = this.current;
    if (playback) {
      let guard = 0;
      while (playback.nextAt < now + LOOKAHEAD_S && guard++ < 8) this.advance(playback, now);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const fading = this.fading[i];
      if (now > fading.nextAt) {
        fading.bus.disconnect();
        this.fading.splice(i, 1);
      }
    }
  }

  private advance(p: Playback, now: number): void {
    const section = p.piece[p.section];
    const target = 1 + DRIVE * Math.max(0, this.level - (p.theme.floor ?? 0));
    p.drive += Math.max(-DRIVE_STEP, Math.min(DRIVE_STEP, target - p.drive));
    const stretch = barStretch(p.theme, section, p.bar, p.section === p.piece.length - 1);
    const barSeconds = (secondsPerBar(p.theme) * stretch) / p.drive;
    p.barSeconds = barSeconds;
    const start = Math.max(p.nextAt, now + 0.02);
    this.writeBar(p, section, start, barSeconds);
    p.globalBar++;
    p.bar++;
    p.nextAt = start + barSeconds;
    if (p.bar >= section.bars) {
      p.bar = 0;
      p.section++;
      if (p.section >= p.piece.length) {
        p.section = 0;
        p.pieces++;
        p.piece = p.composer.plan();
      }
    }
  }

  /** Where the playing theme can stop: the end of the written bar, or the next beat when that is far off. */
  private nextBeat(p: Playback, now: number): number {
    const bar = p.barSeconds;
    const beat = bar / p.theme.meter;
    const barStart = p.nextAt - bar;
    const soon = now + 0.15;
    if (p.nextAt <= soon) return soon;
    if (p.nextAt - now <= MAX_WAIT_S) return p.nextAt;
    return barStart + Math.max(0, Math.ceil((soon - barStart) / beat)) * beat;
  }

  /** Plays the chord that leads into the new theme's key; returns its length in seconds. */
  private writePivot(p: Playback, from: Theme, at: number): number {
    const theme = p.theme;
    const pivot = pivotChord(from, theme);
    const bar = secondsPerBar(theme);
    const beat = bar / theme.meter;
    const length = bar <= MAX_PIVOT_S ? bar : beat * Math.max(2, Math.floor(MAX_PIVOT_S / beat));
    const bright = theme.bright ?? 0.7;
    const weight = pivot.weight;
    const pad: Instrument = theme.layers.find((l) => l.role === 'pad')?.inst ?? 'strings';
    const low: Instrument = theme.layers.some((l) => l.inst === 'cello') ? 'cello' : 'strings';
    const voice = (inst: Instrument, t: number, dur: number, midi: number, vel: number, sustained: boolean) => {
      try {
        playVoice(this.core, inst, this.pan(p, 0), t, dur, midi, vel * weight, { bright: bright * (0.7 + 0.3 * weight), sustained });
      } catch (err) {
        console.warn('Music note failed', err);
      }
    };
    /* Quieter pivots enter up to half a beat after the cut. */
    const enter = at + (1 - weight) * beat * 0.5;
    for (const midi of pivot.chord) voice(pad, enter, length + 0.3 - (enter - at), midi, 0.42, true);
    voice(low, enter, length - (enter - at), pivot.bass, weight >= 0.6 ? 0.45 : 0.3, weight < 0.6);
    if (pivot.kind === 'common') {
      pivot.chord.forEach((midi, i) => voice('harp', at + i * beat * 0.5, beat * 2, midi + 12, 0.38, false));
    } else if (pivot.kind === 'dominant' && weight > 0.7 && theme.layers.some((l) => l.inst === 'timpani' || l.inst === 'drum')) {
      voice('timpani', at, beat, pivot.bass, 0.4, false);
    }
    return length;
  }

  private writeBar(p: Playback, section: PieceSection, start: number, barSeconds: number): void {
    const beat = barSeconds / p.theme.meter;
    const bright = p.theme.bright ?? 0.7;
    for (const note of p.composer.bar(section, p.bar, p.globalBar, this.level)) {
      const jitter = note.role === 'perc' ? 0 : Math.random() * 0.012;
      const t = start + note.at * beat + jitter;
      const dur = Math.max(0.05, note.beats * beat * (SUSTAINED.has(note.role) ? 1 : 0.92));
      try {
        playVoice(this.core, note.inst, this.pan(p, note.pan), t, dur, note.midi, note.vel, { bright, sustained: SUSTAINED.has(note.role) });
      } catch (err) {
        console.warn('Music note failed', err);
      }
    }
  }

  private pan(p: Playback, value: number): AudioNode {
    const key = Math.round(value * 20);
    let node = p.pans.get(key);
    if (!node) {
      node = this.core.ctx.createStereoPanner();
      node.pan.value = key / 20;
      node.connect(p.bus);
      p.pans.set(key, node);
    }
    return node;
  }

  /** Fades a theme out from `at`. */
  private release(p: Playback, at: number, fade = FADE_OUT_S): void {
    const now = this.core.now;
    const gain = p.bus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0.0001, gain.value), now);
    if (at > now) gain.setValueAtTime(Math.max(0.0001, gain.value), at);
    gain.linearRampToValueAtTime(0.0001, at + fade);
    p.nextAt = at + fade + 6;
    this.fading.push(p);
  }
}

/** Themes adapted from the same base (night, ruin) share an id but differ in shape. */
function sameShape(a: Theme, b: Theme): boolean {
  return a.scale === b.scale && a.bpm === b.bpm && a.bright === b.bright && a.layers.length === b.layers.length && a.floor === b.floor;
}
