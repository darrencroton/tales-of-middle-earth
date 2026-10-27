import { Composer, secondsPerBar, type PieceSection } from './composer.ts';
import type { AudioCore } from './core.ts';
import { themeGain, type Role, type Theme } from './themes.ts';
import { hashString } from './theory.ts';
import { playVoice } from './voices.ts';

/** How far ahead bars are written to the audio clock. */
const LOOKAHEAD_S = 0.35;
const FADE_IN_S = 2.2;
const FADE_OUT_S = 2.8;
/** Intensity at which a quiet gap gives way to music. */
const WAKE_INTENSITY = 0.45;

const SUSTAINED: ReadonlySet<Role> = new Set(['pad', 'drone']);

interface Playback {
  theme: Theme;
  composer: Composer;
  bus: GainNode;
  pans: Map<number, StereoPannerNode>;
  piece: PieceSection[];
  section: number;
  bar: number;
  globalBar: number;
  /** Audio-clock time of the next bar, or of the next piece while resting. */
  nextAt: number;
  resting: boolean;
}

/**
 * Plays themes: each piece is composed bar by bar just ahead of the audio
 * clock, followed by a quiet gap (for themes that have one). Changing theme
 * crossfades; intensity brings in a theme's danger layers at the next bar.
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

  /** True while a piece is playing (not resting between pieces). */
  get playing(): boolean {
    return !!this.current && !this.current.resting;
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  /** Crossfades to a theme, or to silence for null. */
  play(theme: Theme | null): void {
    if (this.current && theme && this.current.theme.id === theme.id && sameShape(this.current.theme, theme)) return;
    const now = this.core.now;
    if (this.current) this.release(this.current, now);
    this.current = null;
    if (!theme) return;
    const bus = this.core.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(themeGain(theme.id), now + FADE_IN_S);
    bus.connect(this.core.musicIn);
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    const composer = new Composer(theme, (hashString(theme.id) ^ this.seed) >>> 0);
    this.current = {
      theme,
      composer,
      bus,
      pans: new Map(),
      piece: composer.plan(),
      section: 0,
      bar: 0,
      globalBar: 0,
      nextAt: now + 0.12,
      resting: false,
    };
    const space = theme.space;
    this.core.musicReverb.gain.setTargetAtTime(0.25 + space * 0.75, now, 1.2);
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
      if (playback.resting && this.level >= WAKE_INTENSITY && playback.nextAt > now + 1) {
        playback.nextAt = now + 0.1;
      }
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
    if (p.resting) {
      p.resting = false;
      p.piece = p.composer.plan();
      p.section = 0;
      p.bar = 0;
    }
    const section = p.piece[p.section];
    const barSeconds = secondsPerBar(p.theme);
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
        if (p.theme.gap) {
          const [min, max] = p.theme.gap;
          p.resting = true;
          p.nextAt += min + Math.random() * (max - min);
        } else {
          p.piece = p.composer.plan();
        }
      }
    }
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

  private release(p: Playback, now: number): void {
    p.bus.gain.cancelScheduledValues(now);
    p.bus.gain.setValueAtTime(Math.max(0.0001, p.bus.gain.value), now);
    p.bus.gain.linearRampToValueAtTime(0.0001, now + FADE_OUT_S);
    p.nextAt = now + FADE_OUT_S + 6;
    this.fading.push(p);
  }
}

/** Themes adapted from the same base (night, ruin) share an id but differ in shape. */
function sameShape(a: Theme, b: Theme): boolean {
  return a.scale === b.scale && a.bpm === b.bpm && a.bright === b.bright && a.layers.length === b.layers.length && a.floor === b.floor;
}
