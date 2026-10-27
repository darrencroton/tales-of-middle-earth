import type { AudioCore } from './core.ts';
import type { Ambience } from './themes.ts';

interface Bed {
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
  level: number;
  silentSince: number;
}

/** Loudness of each bed at level 1. */
const BED_LEVEL: Record<Ambience, number> = {
  wind: 0.16,
  cave: 0.22,
  drips: 0,
  fire: 0.08,
  birds: 0,
  crickets: 0.006,
  water: 0.07,
  sea: 0.2,
  whispers: 0,
  rumble: 0.35,
  leaves: 0.05,
  void: 0.05,
  sand: 0.035,
};

/** Seconds between events at level 1; scaled up as the level falls. */
const EVENT_GAP: Partial<Record<Ambience, [number, number]>> = {
  drips: [0.7, 3.5],
  birds: [2.5, 9],
  crickets: [1.2, 4],
  whispers: [6, 16],
  fire: [0.12, 0.7],
  leaves: [5, 14],
};

function lfo(core: AudioCore, rate: number, depth: number, target: AudioParam, nodes: AudioScheduledSourceNode[]): void {
  const o = core.ctx.createOscillator();
  o.frequency.value = rate;
  const g = core.ctx.createGain();
  g.gain.value = depth;
  o.connect(g);
  g.connect(target);
  o.start();
  nodes.push(o);
}

function bandNoise(core: AudioCore, out: AudioNode, nodes: AudioScheduledSourceNode[], brown: boolean, type: BiquadFilterType, frequency: number, q: number, level: number): BiquadFilterNode {
  const source = core.noiseSource(brown);
  const f = core.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  const g = core.ctx.createGain();
  g.gain.value = level;
  source.connect(f);
  f.connect(g);
  g.connect(out);
  source.start(core.now, Math.random() * 1.5);
  nodes.push(source);
  return f;
}

function panned(core: AudioCore, out: AudioNode, pan: number): AudioNode {
  const p = core.ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(out);
  return p;
}

function buildBed(core: AudioCore, kind: Ambience, out: GainNode): AudioScheduledSourceNode[] {
  const nodes: AudioScheduledSourceNode[] = [];
  switch (kind) {
    case 'wind':
      for (const side of [-0.6, 0.6]) {
        const g = core.ctx.createGain();
        g.gain.value = 0.6;
        g.connect(panned(core, out, side));
        const f = bandNoise(core, g, nodes, false, 'bandpass', 520, 0.9, 1);
        lfo(core, side < 0 ? 0.061 : 0.083, 260, f.frequency, nodes);
        lfo(core, side < 0 ? 0.047 : 0.071, 0.4, g.gain, nodes);
      }
      break;
    case 'cave': {
      bandNoise(core, out, nodes, true, 'bandpass', 140, 0.7, 1);
      bandNoise(core, out, nodes, false, 'bandpass', 420, 1.2, 0.06);
      break;
    }
    case 'rumble': {
      const g = core.ctx.createGain();
      g.gain.value = 0.6;
      g.connect(out);
      bandNoise(core, g, nodes, true, 'lowpass', 75, 0.8, 1);
      lfo(core, 0.031, 0.45, g.gain, nodes);
      break;
    }
    case 'water':
      for (const [freq, rate] of [
        [900, 0.37],
        [2400, 0.53],
      ] as const) {
        const g = core.ctx.createGain();
        g.gain.value = 0.6;
        g.connect(out);
        bandNoise(core, g, nodes, false, 'bandpass', freq, 0.9, 1);
        lfo(core, rate, 0.35, g.gain, nodes);
      }
      break;
    case 'sea': {
      const g = core.ctx.createGain();
      g.gain.value = 0.5;
      g.connect(out);
      const f = bandNoise(core, g, nodes, true, 'lowpass', 700, 0.5, 1);
      lfo(core, 0.085, 500, f.frequency, nodes);
      lfo(core, 0.085, 0.42, g.gain, nodes);
      break;
    }
    case 'leaves': {
      const g = core.ctx.createGain();
      g.gain.value = 0.5;
      g.connect(out);
      bandNoise(core, g, nodes, false, 'highpass', 3200, 0.5, 1);
      lfo(core, 0.13, 0.45, g.gain, nodes);
      break;
    }
    case 'void': {
      for (const [freq, pan] of [
        [55, -0.3],
        [82.4, 0.3],
        [110.3, 0],
      ] as const) {
        const o = core.ctx.createOscillator();
        o.frequency.value = freq;
        const g = core.ctx.createGain();
        g.gain.value = freq > 100 ? 0.25 : 0.6;
        o.connect(g);
        g.connect(panned(core, out, pan));
        lfo(core, 0.05 + freq / 4000, 0.3, g.gain, nodes);
        o.start();
        nodes.push(o);
      }
      break;
    }
    case 'sand': {
      const g = core.ctx.createGain();
      g.gain.value = 0.5;
      g.connect(out);
      bandNoise(core, g, nodes, false, 'highpass', 4200, 0.6, 1);
      lfo(core, 0.21, 0.4, g.gain, nodes);
      break;
    }
    case 'fire':
      bandNoise(core, out, nodes, true, 'bandpass', 520, 0.6, 1);
      break;
    case 'crickets': {
      const o = core.ctx.createOscillator();
      o.frequency.value = 4300;
      const g = core.ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g);
      g.connect(out);
      lfo(core, 27, 0.5, g.gain, nodes);
      o.start();
      nodes.push(o);
      break;
    }
    default:
      break;
  }
  return nodes;
}

/**
 * Ambient soundscapes beneath the music: steady beds (wind, cave air, the
 * sea) and scattered events (drips, birdsong, crickets, whispers, crackling
 * fire), each faded in and out as places change.
 */
export class AmbiencePlayer {
  private readonly core: AudioCore;
  private readonly beds = new Map<Ambience, Bed>();
  private readonly nextEvent = new Map<Ambience, number>();
  private targets = new Map<Ambience, number>();
  private readonly out: GainNode;

  constructor(core: AudioCore) {
    this.core = core;
    this.out = core.ctx.createGain();
    this.out.connect(core.ambienceIn);
  }

  set(levels: readonly [Ambience, number][]): void {
    this.targets = new Map(levels.filter(([, level]) => level > 0));
    const now = this.core.now;
    for (const [kind, level] of this.targets) {
      if (BED_LEVEL[kind] > 0 && !this.beds.has(kind)) {
        const out = this.core.ctx.createGain();
        out.gain.value = 0;
        out.connect(this.out);
        this.beds.set(kind, { out, nodes: buildBed(this.core, kind, out), level: 0, silentSince: 0 });
      }
      const bed = this.beds.get(kind);
      if (bed) {
        bed.level = level;
        bed.out.gain.cancelScheduledValues(now);
        bed.out.gain.setTargetAtTime(level * BED_LEVEL[kind], now, 1.6);
      }
    }
    for (const [kind, bed] of this.beds) {
      if (this.targets.has(kind)) continue;
      if (bed.level > 0) {
        bed.level = 0;
        bed.silentSince = now;
        bed.out.gain.cancelScheduledValues(now);
        bed.out.gain.setTargetAtTime(0, now, 1.6);
      }
    }
  }

  /** Schedules events due soon and releases beds that have been silent a while. */
  tick(): void {
    const now = this.core.now;
    for (const [kind, level] of this.targets) {
      const gap = EVENT_GAP[kind];
      if (!gap) continue;
      const due = this.nextEvent.get(kind) ?? now + Math.random() * gap[1];
      if (due <= now + 0.15) {
        this.event(kind, Math.max(now, due), level);
        const spacing = (gap[0] + Math.random() * (gap[1] - gap[0])) / Math.max(0.2, Math.min(1, level * 1.6));
        this.nextEvent.set(kind, Math.max(now, due) + spacing);
      } else if (!this.nextEvent.has(kind)) {
        this.nextEvent.set(kind, due);
      }
    }
    for (const [kind, bed] of this.beds) {
      if (bed.level === 0 && now - bed.silentSince > 10) {
        for (const node of bed.nodes) {
          try {
            node.stop();
          } catch {
            /* Already stopped. */
          }
        }
        bed.out.disconnect();
        this.beds.delete(kind);
      }
    }
    for (const kind of [...this.nextEvent.keys()]) if (!this.targets.has(kind)) this.nextEvent.delete(kind);
  }

  private event(kind: Ambience, t: number, level: number): void {
    switch (kind) {
      case 'drips':
        this.drip(t, level);
        break;
      case 'birds':
        this.bird(t, level);
        break;
      case 'crickets':
        this.cricket(t, level);
        break;
      case 'whispers':
        this.whisper(t, level);
        break;
      case 'fire':
        this.crackle(t, level);
        break;
      case 'leaves':
        this.creak(t, level);
        break;
      default:
        break;
    }
  }

  private voice(pan: number): GainNode {
    const g = this.core.ctx.createGain();
    g.gain.value = 0;
    g.connect(panned(this.core, this.out, pan));
    return g;
  }

  private tone(t: number, type: OscillatorType, from: number, to: number, glide: number, level: number, attack: number, decay: number, pan: number): void {
    const end = t + attack + decay * 6;
    const o = this.core.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + glide);
    const g = this.voice(pan);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay);
    o.connect(g);
    o.start(t);
    o.stop(end);
  }

  private drip(t: number, level: number): void {
    const f = 900 + Math.random() * 1700;
    this.tone(t, 'sine', f, f * (1.5 + Math.random() * 0.4), 0.03, 0.05 * level, 0.002, 0.045, Math.random() * 1.6 - 0.8);
    if (Math.random() < 0.3) this.tone(t + 0.18 + Math.random() * 0.2, 'sine', f * 1.3, f * 2, 0.02, 0.025 * level, 0.002, 0.03, Math.random() * 1.6 - 0.8);
  }

  private bird(t: number, level: number): void {
    const base = 2400 + Math.random() * 2400;
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = Math.random() * 1.6 - 0.8;
    const rising = Math.random() < 0.5;
    let at = t;
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + (Math.random() - 0.5) * 0.25);
      this.tone(at, 'sine', rising ? f * 0.8 : f * 1.25, rising ? f * 1.25 : f * 0.85, 0.06, 0.018 * level, 0.008, 0.035, pan);
      at += 0.09 + Math.random() * 0.08;
    }
  }

  private cricket(t: number, level: number): void {
    const pan = Math.random() * 1.6 - 0.8;
    const f = 4200 + Math.random() * 500;
    const chirps = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < chirps; c++) {
      for (let p = 0; p < 3; p++) this.tone(t + c * 0.35 + p * 0.03, 'sine', f, f, 0.01, 0.012 * level, 0.003, 0.008, pan);
    }
  }

  private whisper(t: number, level: number): void {
    const ctx = this.core.ctx;
    const pan = Math.random() * 1.8 - 0.9;
    const syllables = 2 + Math.floor(Math.random() * 4);
    let at = t;
    for (let i = 0; i < syllables; i++) {
      const dur = 0.12 + Math.random() * 0.22;
      const source = this.core.noiseSource();
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 500 + Math.random() * 500;
      f1.Q.value = 5;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 1500 + Math.random() * 1200;
      f2.Q.value = 7;
      const g = this.voice(pan);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.06 * level, at + dur * 0.4);
      g.gain.setTargetAtTime(0, at + dur * 0.5, dur * 0.3);
      source.connect(f1);
      source.connect(f2);
      f1.connect(g);
      f2.connect(g);
      source.start(at, Math.random());
      source.stop(at + dur * 3);
      at += dur + 0.04 + Math.random() * 0.1;
    }
  }

  private crackle(t: number, level: number): void {
    const ctx = this.core.ctx;
    const source = this.core.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500 + Math.random() * 3000;
    f.Q.value = 1.5;
    const g = this.voice(Math.random() * 1.2 - 0.6);
    const peak = (0.02 + Math.random() * 0.06) * level;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.001, 0.004 + Math.random() * 0.01);
    source.connect(f);
    f.connect(g);
    source.start(t, Math.random() * 1.5);
    source.stop(t + 0.08);
  }

  private creak(t: number, level: number): void {
    const f = 140 + Math.random() * 120;
    this.tone(t, 'sawtooth', f, f * (0.8 + Math.random() * 0.4), 0.6, 0.006 * level, 0.15, 0.25, Math.random() * 1.6 - 0.8);
  }
}
