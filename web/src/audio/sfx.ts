import type { AudioCore } from './core.ts';
import type { Cue, CueId, Element } from './cues.ts';
import { degreeToMidi, midiToFrequency, SCALES, type ScaleName } from './theory.ts';
import { playVoice } from './voices.ts';

export interface MusicalKey {
  root: number;
  scale: ScaleName;
}

interface ToneSpec {
  type?: OscillatorType;
  freq: number;
  to?: number;
  glide?: number;
  level: number;
  attack?: number;
  decay: number;
  detune?: number;
}

interface NoiseSpec {
  type: BiquadFilterType;
  freq: number;
  to?: number;
  glide?: number;
  q?: number;
  level: number;
  attack?: number;
  decay: number;
  brown?: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Level trims in dB so each sound sits where it should against the music. */
const TRIM_DB: Partial<Record<CueId, number>> = {
  hit: 5,
  miss: 10,
  hurt: 3,
  parry: 11,
  kill: 4,
  impact: 9,
  'door-open': 8,
  'door-close': 4,
  'door-locked': 6,
  unlock: 11,
  'distant-door': 10,
  'stairs-down': 2,
  'stairs-up': 2,
  travel: 8,
  pickup: 11,
  gold: 10,
  buy: 10,
  levelup: -3,
  learn: 5,
  quaff: 10,
  read: 11,
  eat: 14,
  cast: 7,
  fire: 11,
  throw: 10,
  zap: 13,
  activate: 4,
  wield: 7,
  takeoff: 10,
  drop: 8,
  fuel: 11,
  disarm: 11,
  tunnel: 11,
  heal: 8,
  teleport: 12,
  trap: 10,
  breath: 10,
  'spell-monster': 12,
  shriek: 14,
  shop: 8,
  deny: 8,
  poisoned: 10,
  confused: 9,
  hallucinate: 8,
  blind: 9,
  paralyzed: 10,
  afraid: 14,
  stun: 4,
  cut: 9,
  haste: 9,
  slow: 9,
  cured: 7,
  bolt: 18,
  explosion: 3,
  'ui-open': 10,
  'ui-close': 11,
};

/** Element sounds for bolts and explosions, from the colour tome2 draws them in. */
const ELEMENT_NOISE: Record<Element, { freq: number; q: number; brown: boolean }> = {
  fire: { freq: 900, q: 0.6, brown: true },
  cold: { freq: 4200, q: 1.2, brown: false },
  lightning: { freq: 2600, q: 0.8, brown: false },
  poison: { freq: 1400, q: 2.5, brown: false },
  magic: { freq: 1800, q: 4, brown: false },
  dark: { freq: 400, q: 1, brown: true },
  earth: { freq: 300, q: 0.7, brown: true },
};

/**
 * Synthesised sound effects. Every sound is built from a few layers (a
 * body, a transient, a tail) with small random variations, and musical
 * stingers are played in the key of the music that is playing.
 */
export class SoundEffects {
  private readonly core: AudioCore;
  key: MusicalKey = { root: 50, scale: 'dorian' };
  /** Gain applied to every layer of the sound being built. */
  private trim = 1;

  constructor(core: AudioCore) {
    this.core = core;
  }

  play(cue: Cue, delay = 0): void {
    const t = this.core.now + 0.01 + delay;
    const s = Math.max(0.15, Math.min(1, cue.strength ?? 0.6));
    const far = cue.distance ? Math.max(0.15, 1 - cue.distance / 22) : 1;
    this.trim = Math.pow(10, (TRIM_DB[cue.id] ?? 0) / 20);
    try {
      this.dispatch(cue, t, s, far);
    } catch (err) {
      console.warn('Sound effect failed', cue.id, err);
    } finally {
      this.trim = 1;
    }
  }

  private dispatch(cue: Cue, t: number, s: number, far: number): void {
    switch (cue.id) {
      case 'hit':
        return this.hit(t, s, false);
      case 'crit':
        return this.hit(t, 1, true);
      case 'miss':
        return this.whoosh(t, 0.16, 650, 2600, 0.17);
      case 'hurt':
        return this.hurt(t, s);
      case 'claw':
        return this.claw(t, s);
      case 'bite':
        return this.bite(t, s);
      case 'parry':
        return this.whoosh(t, 0.1, 450, 1500, 0.2);
      case 'kill':
        return this.kill(t);
      case 'kill-unique':
        return this.killUnique(t);
      case 'impact':
        return this.thump(t, 0.25 * s, 110, 55, 0.1);
      case 'door-open':
        return this.door(t, far, false);
      case 'door-close':
        return this.doorClose(t, far);
      case 'door-bash':
        return this.doorBash(t);
      case 'door-locked':
        return this.rattle(t);
      case 'unlock':
        return this.unlock(t);
      case 'distant-door':
        return this.door(t, 0.35, true);
      case 'stairs-down':
        return this.stairs(t, true);
      case 'stairs-up':
        return this.stairs(t, false);
      case 'travel':
        return this.windGust(t);
      case 'pickup':
        return this.pickup(t);
      case 'gold':
        return this.coins(t, s);
      case 'buy':
        return this.coins(t, 0.35);
      case 'levelup':
        return this.levelUp(t);
      case 'learn':
        return this.arpeggio(t, [4, 7], 0.18, 0.12, 'celesta', 2);
      case 'quaff':
        return this.quaff(t);
      case 'read':
        return this.read(t);
      case 'eat':
        return this.eat(t);
      case 'cast':
        return this.cast(t);
      case 'fire':
        return this.bow(t);
      case 'throw':
        return this.whoosh(t, 0.22, 400, 1600, 0.22);
      case 'zap':
        return this.zap(t);
      case 'activate':
        return this.activate(t);
      case 'wield':
        return this.wield(t);
      case 'takeoff':
        return this.rustle(t, 0.12);
      case 'drop':
        return this.drop(t);
      case 'fuel':
        return this.pour(t);
      case 'disarm':
        return this.unlock(t);
      case 'tunnel':
        return this.tunnel(t);
      case 'heal':
        return this.heal(t);
      case 'teleport':
        return this.teleport(t);
      case 'trap':
        return this.trap(t);
      case 'secret':
        return this.arpeggio(t, [4, 6, 9], 0.16, 0.14, 'celesta', 1);
      case 'rumble':
        return this.rumble(t);
      case 'breath':
        return this.breath(t, cue.element ?? 'fire');
      case 'spell-monster':
        return this.monsterSpell(t);
      case 'shriek':
        return this.shriek(t);
      case 'danger':
        return this.danger(t);
      case 'unique':
        return this.unique(t);
      case 'death':
        return this.death(t);
      case 'shop':
        return this.shopBell(t);
      case 'deny':
        return this.tone(this.out(0, 1), t, { type: 'sine', freq: 220, to: 170, glide: 0.12, level: 0.12, decay: 0.08 });
      case 'poisoned':
        return this.sickly(t);
      case 'confused':
        return this.warble(t, 6);
      case 'hallucinate':
        return this.warble(t, 2.5);
      case 'blind':
        return this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 2000, to: 150, glide: 0.6, level: 0.18, attack: 0.05, decay: 0.25, brown: true });
      case 'paralyzed':
        return this.freeze(t);
      case 'afraid':
        return this.shiver(t);
      case 'stun':
        return this.stun(t);
      case 'cut':
        return this.noise(this.out(0.2, 1), t, { type: 'highpass', freq: 2500, to: 6000, glide: 0.1, level: 0.12, attack: 0.005, decay: 0.05 });
      case 'haste':
        return this.whoosh(t, 0.4, 300, 3500, 0.2);
      case 'slow':
        return this.tone(this.out(0, 1), t, { type: 'triangle', freq: 600, to: 120, glide: 0.6, level: 0.1, attack: 0.02, decay: 0.3 });
      case 'cured':
        return this.arpeggio(t, [7, 9], 0.12, 0.09, 'celesta', 1);
      case 'hungry':
        return this.growl(t);
      case 'bolt':
        return this.bolt(t, cue.element ?? 'magic');
      case 'explosion':
        return this.explosion(t, cue.element ?? 'fire');
      case 'heartbeat':
        return this.heartbeat(t, s);
      case 'ui-open':
        return this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 1400, to: 2600, glide: 0.08, q: 0.6, level: 0.035, attack: 0.03, decay: 0.04 });
      case 'ui-close':
        return this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 2400, to: 1200, glide: 0.08, q: 0.6, level: 0.03, attack: 0.02, decay: 0.035 });
      case 'quest':
        return this.fanfare(t);
      case 'save':
        return this.arpeggio(t, [0, 4], 0.1, 0.12, 'celesta', 2);
    }
  }

  /* Building blocks */

  private out(pan: number, level: number): GainNode {
    const g = this.core.ctx.createGain();
    g.gain.value = level * this.trim;
    const p = this.core.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(this.core.soundIn);
    return g;
  }

  private tone(dest: AudioNode, t: number, spec: ToneSpec): void {
    const ctx = this.core.ctx;
    const attack = spec.attack ?? 0.003;
    const end = t + attack + spec.decay * 7;
    const o = ctx.createOscillator();
    o.type = spec.type ?? 'sine';
    o.frequency.setValueAtTime(spec.freq, t);
    if (spec.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t + (spec.glide ?? 0.1));
    if (spec.detune) o.detune.value = spec.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(spec.level, t + attack);
    g.gain.setTargetAtTime(0, t + attack, spec.decay);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(end);
  }

  private noise(dest: AudioNode, t: number, spec: NoiseSpec): void {
    const ctx = this.core.ctx;
    const attack = spec.attack ?? 0.002;
    const end = t + attack + spec.decay * 7;
    const source = this.core.noiseSource(spec.brown);
    const f = ctx.createBiquadFilter();
    f.type = spec.type;
    f.frequency.setValueAtTime(spec.freq, t);
    if (spec.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t + (spec.glide ?? 0.1));
    f.Q.value = spec.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(spec.level, t + attack);
    g.gain.setTargetAtTime(0, t + attack, spec.decay);
    source.connect(f);
    f.connect(g);
    g.connect(dest);
    source.start(t, Math.random() * 1.5);
    source.stop(end);
  }

  /** A ringing metallic tone (frequency modulation). */
  private ring(dest: AudioNode, t: number, freq: number, ratio: number, index: number, level: number, decay: number): void {
    const ctx = this.core.ctx;
    const end = t + decay * 7;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * ratio;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(freq * index, t);
    depth.gain.setTargetAtTime(0, t, decay * 0.5);
    mod.connect(depth);
    depth.connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, decay);
    carrier.connect(g);
    g.connect(dest);
    carrier.start(t);
    mod.start(t);
    carrier.stop(end);
    mod.stop(end);
  }

  private thump(t: number, level: number, from: number, to: number, decay: number, pan = 0): void {
    this.tone(this.out(pan, 1), t, { freq: from, to, glide: 0.06, level, decay });
  }

  private whoosh(t: number, length: number, from: number, to: number, level: number, pan = rand(-0.3, 0.3)): void {
    this.noise(this.out(pan, 1), t, { type: 'bandpass', freq: from, to, glide: length, q: 1.4, level, attack: length * 0.45, decay: length * 0.35 });
  }

  private midi(degree: number, octave = 1): number {
    return degreeToMidi(this.key.root + 12 * octave, SCALES[this.key.scale], degree);
  }

  private arpeggio(t: number, degrees: number[], step: number, level: number, inst: 'celesta' | 'harp' | 'bell', octave: number): void {
    const dest = this.out(0, 1);
    degrees.forEach((d, i) => playVoice(this.core, inst, dest, t + i * step, 0.6, this.midi(d, octave), level / 0.12, { bright: 0.8, sustained: false }));
  }

  private chord(t: number, degrees: number[], dur: number, level: number, inst: 'strings' | 'choir' | 'glass' | 'ooh' | 'horn' | 'brass', octave: number): void {
    const dest = this.out(0, level);
    for (const d of degrees) playVoice(this.core, inst, dest, t, dur, this.midi(d, octave), 0.9, { bright: 0.7, sustained: true });
  }

  /* Combat */

  private hit(t: number, s: number, crit: boolean): void {
    const pitch = rand(0.88, 1.12);
    const pan = rand(-0.2, 0.2);
    this.thump(t, 0.35 + 0.35 * s, 150 * pitch, 50 * pitch, 0.09 + 0.05 * s, pan);
    this.noise(this.out(pan, 1), t, { type: 'bandpass', freq: 2200 * pitch, to: 700, glide: 0.07, q: 0.9, level: 0.16 + 0.14 * s, decay: 0.035 });
    if (crit) {
      this.noise(this.out(pan, 1), t + 0.025, { type: 'lowpass', freq: 3500, level: 0.25, decay: 0.05 });
      this.thump(t + 0.03, 0.45, 95, 40, 0.16, pan);
      this.ring(this.out(pan, 1), t, 1600 * pitch, 2.71, 2.5, 0.06, 0.22);
    }
  }

  private hurt(t: number, s: number): void {
    const pan = rand(-0.15, 0.15);
    this.thump(t, 0.35 + 0.4 * s, 110, 42, 0.12 + 0.08 * s, pan);
    this.noise(this.out(pan, 1), t, { type: 'bandpass', freq: 420, q: 2.5, level: 0.12 + 0.18 * s, attack: 0.01, decay: 0.07 });
    this.noise(this.out(pan, 1), t, { type: 'lowpass', freq: 1200, level: 0.12 * s, decay: 0.05 });
    if (s > 0.35) this.tone(this.out(0, 1), t + 0.02, { freq: 3100, level: 0.012 + 0.02 * s, attack: 0.02, decay: 0.4 });
  }

  private claw(t: number, s: number): void {
    for (let i = 0; i < 3; i++) {
      this.noise(this.out(rand(-0.3, 0.3), 1), t + i * 0.045, { type: 'highpass', freq: 2600, to: 5200, glide: 0.04, level: 0.08 + 0.06 * s, decay: 0.02 });
    }
    this.hurt(t + 0.05, s * 0.8);
  }

  private bite(t: number, s: number): void {
    this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 1300, q: 1.5, level: 0.2, decay: 0.02 });
    this.tone(this.out(0, 1), t, { type: 'square', freq: 260, to: 120, glide: 0.04, level: 0.04, decay: 0.03 });
    this.hurt(t + 0.03, s);
  }

  private kill(t: number): void {
    this.hit(t, 0.9, false);
    this.noise(this.out(rand(-0.2, 0.2), 1), t + 0.09, { type: 'lowpass', freq: 700, to: 200, glide: 0.25, level: 0.18, attack: 0.01, decay: 0.12, brown: true });
    this.arpeggio(t + 0.12, [4, 7], 0.08, 0.05, 'celesta', 1);
  }

  private killUnique(t: number): void {
    this.hit(t, 1, true);
    playVoice(this.core, 'gong', this.out(0, 1), t + 0.05, 4, this.key.root - 12, 0.9, { bright: 0.7, sustained: false });
    [0, 0.18, 0.36].forEach((d, i) => playVoice(this.core, 'timpani', this.out(0, 1), t + d, 0.5, this.key.root - 12 + (i === 2 ? 7 : 0), 0.8, { bright: 0.7, sustained: false }));
    this.chord(t + 0.3, [0, 4, 7, 9], 2.2, 0.5, 'strings', 1);
    this.arpeggio(t + 0.5, [7, 9, 11, 14], 0.12, 0.1, 'celesta', 1);
  }

  /* Doors and places */

  private door(t: number, far: number, distant: boolean): void {
    const dest = this.out(rand(-0.3, 0.3), far * (distant ? 0.6 : 1));
    const muffle = this.core.ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = distant ? 700 : 5000;
    muffle.connect(dest);
    this.noise(muffle, t, { type: 'highpass', freq: 2500, level: 0.12, decay: 0.008 });
    const ctx = this.core.ctx;
    const base = rand(70, 110);
    const length = rand(0.35, 0.6);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t + 0.03);
    o.frequency.linearRampToValueAtTime(base * rand(1.3, 1.7), t + 0.03 + length);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = rand(18, 30);
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = base * 0.35;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(650, 950);
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.03);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03 + length * 0.3);
    g.gain.setTargetAtTime(0, t + 0.03 + length * 0.75, 0.06);
    o.connect(bp);
    bp.connect(g);
    g.connect(muffle);
    const end = t + 0.1 + length * 1.6;
    o.start(t + 0.03);
    wobble.start(t + 0.03);
    o.stop(end);
    wobble.stop(end);
    this.tone(muffle, t + 0.02 + length, { freq: 85, to: 60, glide: 0.05, level: 0.12, decay: 0.07 });
  }

  private doorClose(t: number, far: number): void {
    const dest = this.out(rand(-0.2, 0.2), far);
    this.tone(dest, t, { freq: 95, to: 48, glide: 0.06, level: 0.4, decay: 0.12 });
    this.noise(dest, t, { type: 'lowpass', freq: 900, level: 0.18, decay: 0.05, brown: true });
    this.noise(dest, t + 0.06, { type: 'bandpass', freq: 3200, q: 3, level: 0.08, decay: 0.01 });
  }

  private doorBash(t: number): void {
    this.thump(t, 0.6, 120, 40, 0.18);
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 3000, level: 0.35, decay: 0.12 });
    for (let i = 0; i < 5; i++) this.noise(this.out(rand(-0.6, 0.6), 1), t + 0.05 + i * rand(0.03, 0.07), { type: 'bandpass', freq: rand(1500, 4000), q: 2, level: 0.08, decay: 0.012 });
  }

  private rattle(t: number): void {
    for (let i = 0; i < 4; i++) this.noise(this.out(0.1, 1), t + i * 0.055, { type: 'bandpass', freq: rand(3000, 4200), q: 4, level: 0.12, decay: 0.008 });
    this.thump(t + 0.24, 0.15, 160, 110, 0.04);
  }

  private unlock(t: number): void {
    this.noise(this.out(0.1, 1), t, { type: 'bandpass', freq: 3500, q: 4, level: 0.12, decay: 0.008 });
    this.noise(this.out(0.1, 1), t + 0.09, { type: 'bandpass', freq: 2800, q: 4, level: 0.14, decay: 0.01 });
    this.ring(this.out(0.1, 1), t + 0.12, 2200, 3.1, 1.5, 0.05, 0.12);
  }

  private stairs(t: number, down: boolean): void {
    for (let i = 0; i < 4; i++) {
      const at = t + i * 0.26;
      const fade = 1 - i * (down ? 0.18 : 0.1);
      const pitch = down ? 1 - i * 0.08 : 1 + i * 0.07;
      this.thump(at, 0.28 * fade, 90 * pitch, 55 * pitch, 0.06, i % 2 ? 0.15 : -0.15);
      this.noise(this.out(i % 2 ? 0.15 : -0.15, 1), at, { type: 'bandpass', freq: 1100 * pitch, q: 0.8, level: 0.07 * fade, decay: 0.03 });
    }
    if (down) this.noise(this.out(0, 1), t + 0.4, { type: 'lowpass', freq: 900, to: 140, glide: 1.4, level: 0.22, attack: 0.5, decay: 0.5, brown: true });
    else this.noise(this.out(0, 1), t + 0.4, { type: 'bandpass', freq: 400, to: 2400, glide: 1.2, q: 0.7, level: 0.07, attack: 0.5, decay: 0.4 });
  }

  private windGust(t: number): void {
    this.noise(this.out(-0.4, 1), t, { type: 'bandpass', freq: 300, to: 1300, glide: 0.8, q: 0.9, level: 0.12, attack: 0.6, decay: 0.45 });
    this.noise(this.out(0.4, 1), t + 0.2, { type: 'bandpass', freq: 500, to: 1000, glide: 0.8, q: 0.9, level: 0.08, attack: 0.5, decay: 0.4 });
  }

  /* Items */

  private rustle(t: number, level: number): void {
    for (let i = 0; i < 3; i++) this.noise(this.out(rand(-0.2, 0.2), 1), t + i * rand(0.03, 0.06), { type: 'bandpass', freq: rand(2000, 3500), q: 0.7, level: level * rand(0.6, 1), attack: 0.01, decay: 0.025 });
  }

  private pickup(t: number): void {
    this.rustle(t, 0.1);
    this.ring(this.out(0.1, 1), t + 0.07, rand(2300, 2900), 3.5, 1.2, 0.035, 0.06);
  }

  private coins(t: number, s: number): void {
    const count = Math.round(2 + s * 8);
    let at = t;
    for (let i = 0; i < count; i++) {
      const f = rand(3000, 5200);
      const dest = this.out(rand(-0.4, 0.4), 1);
      this.ring(dest, at, f, 1.47, 0.7, rand(0.025, 0.045), rand(0.04, 0.09));
      this.tone(dest, at, { freq: f * 1.33, level: 0.012, decay: 0.05 });
      at += rand(0.025, 0.07);
    }
  }

  private drop(t: number): void {
    this.thump(t, 0.25, 140, 70, 0.06);
    this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 1800, q: 1, level: 0.06, decay: 0.03 });
  }

  private quaff(t: number): void {
    for (let i = 0; i < 4; i++) {
      const at = t + i * rand(0.11, 0.16);
      const f = rand(260, 420);
      this.tone(this.out(0, 1), at, { freq: f, to: f * 2.2, glide: 0.06, level: 0.07, attack: 0.01, decay: 0.04 });
      this.noise(this.out(0, 1), at, { type: 'lowpass', freq: 700, level: 0.06, attack: 0.01, decay: 0.05, brown: true });
    }
  }

  private read(t: number): void {
    this.rustle(t, 0.09);
    this.noise(this.out(0, 1), t + 0.12, { type: 'highpass', freq: 3000, level: 0.04, attack: 0.03, decay: 0.05 });
    this.chord(t + 0.2, [4, 7], 0.6, 0.35, 'glass', 2);
  }

  private eat(t: number): void {
    for (let i = 0; i < 3; i++) {
      const at = t + i * rand(0.17, 0.22);
      for (let k = 0; k < 4; k++) this.noise(this.out(0, 1), at + k * 0.012, { type: 'bandpass', freq: rand(1200, 2600), q: 1.2, level: 0.06, decay: 0.012 });
    }
  }

  private pour(t: number): void {
    for (let i = 0; i < 6; i++) {
      const f = rand(500, 900);
      this.tone(this.out(0, 1), t + i * 0.07, { freq: f, to: f * 1.4, glide: 0.04, level: 0.035, decay: 0.03 });
    }
  }

  private wield(t: number): void {
    this.noise(this.out(0.15, 1), t, { type: 'highpass', freq: 2500, to: 7000, glide: 0.22, level: 0.08, attack: 0.12, decay: 0.05 });
    this.ring(this.out(0.15, 1), t + 0.2, rand(1500, 1900), 2.71, 2, 0.05, 0.3);
  }

  private tunnel(t: number): void {
    this.ring(this.out(0.1, 1), t, rand(800, 1000), 2.3, 3, 0.09, 0.08);
    this.noise(this.out(0.1, 1), t + 0.01, { type: 'lowpass', freq: 2500, level: 0.15, decay: 0.08 });
    for (let i = 0; i < 4; i++) this.noise(this.out(rand(-0.4, 0.4), 1), t + 0.08 + i * rand(0.04, 0.08), { type: 'bandpass', freq: rand(1500, 3000), q: 2, level: 0.04, decay: 0.01 });
  }

  /* Magic */

  private cast(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 400, to: 3000, glide: 0.35, q: 2, level: 0.08, attack: 0.3, decay: 0.08 });
    this.tone(this.out(0, 1), t, { type: 'triangle', freq: 300, to: 900, glide: 0.35, level: 0.05, attack: 0.3, decay: 0.08 });
    this.arpeggio(t + 0.33, [7, 11], 0.06, 0.08, 'celesta', 1);
  }

  private bow(t: number): void {
    this.tone(this.out(0.1, 1), t, { type: 'triangle', freq: 190, to: 170, glide: 0.1, level: 0.12, decay: 0.07 });
    this.noise(this.out(0.1, 1), t, { type: 'highpass', freq: 2000, level: 0.1, decay: 0.006 });
    this.whoosh(t + 0.04, 0.18, 2200, 800, 0.12, 0.3);
  }

  private zap(t: number): void {
    const dest = this.out(0, 1);
    const bp = this.core.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    bp.connect(dest);
    this.tone(bp, t, { type: 'square', freq: 1400, to: 160, glide: 0.18, level: 0.07, decay: 0.08 });
    for (let i = 0; i < 4; i++) this.noise(dest, t + i * 0.03, { type: 'highpass', freq: 3000, level: 0.05, decay: 0.006 });
  }

  private activate(t: number): void {
    this.tone(this.out(-0.2, 1), t, { freq: 220, level: 0.05, attack: 0.25, decay: 0.25 });
    this.tone(this.out(0.2, 1), t, { freq: 331, level: 0.04, attack: 0.25, decay: 0.25 });
    this.arpeggio(t + 0.25, [0, 4, 7], 0.07, 0.07, 'celesta', 2);
  }

  private heal(t: number): void {
    this.chord(t, [0, 2, 4], 0.9, 0.4, 'glass', 1);
    this.noise(this.out(0, 1), t + 0.1, { type: 'highpass', freq: 5000, to: 9000, glide: 0.6, level: 0.025, attack: 0.3, decay: 0.3 });
  }

  private teleport(t: number): void {
    this.noise(this.out(-0.3, 1), t, { type: 'bandpass', freq: 200, to: 4500, glide: 0.35, q: 3, level: 0.12, attack: 0.25, decay: 0.12 });
    this.tone(this.out(0.3, 1), t, { type: 'sine', freq: 200, to: 1800, glide: 0.35, level: 0.05, attack: 0.25, decay: 0.12 });
    this.noise(this.out(0.3, 1), t + 0.4, { type: 'bandpass', freq: 3500, to: 300, glide: 0.4, q: 3, level: 0.06, attack: 0.05, decay: 0.2 });
  }

  private trap(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'highpass', freq: 1500, level: 0.3, decay: 0.01 });
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = 320;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(90, t);
    depth.gain.setTargetAtTime(0, t, 0.15);
    lfo.connect(depth);
    depth.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.005, 0.12);
    o.connect(g);
    g.connect(this.out(0, 1));
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.9);
    lfo.stop(t + 0.9);
    this.chord(t, [0, 1], 0.25, 0.4, 'brass', 0);
  }

  private rumble(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 120, q: 0.8, level: 0.6, attack: 0.4, decay: 0.8, brown: true });
    for (let i = 0; i < 6; i++) this.noise(this.out(rand(-0.7, 0.7), 1), t + rand(0.1, 1.2), { type: 'bandpass', freq: rand(600, 1800), q: 1.5, level: 0.05, decay: 0.03 });
  }

  private breath(t: number, element: Element): void {
    const n = ELEMENT_NOISE[element];
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 300, to: 1400, glide: 0.4, level: 0.25, attack: 0.25, decay: 0.35, brown: true });
    this.noise(this.out(0, 1), t + 0.1, { type: 'bandpass', freq: n.freq, q: n.q, level: 0.15, attack: 0.2, decay: 0.3, brown: n.brown });
  }

  private monsterSpell(t: number): void {
    this.noise(this.out(rand(-0.4, 0.4), 1), t, { type: 'bandpass', freq: 300, to: 1600, glide: 0.4, q: 3, level: 0.09, attack: 0.35, decay: 0.06 });
    this.tone(this.out(0, 1), t, { type: 'sawtooth', freq: midiToFrequency(this.key.root - 12), level: 0.03, attack: 0.3, decay: 0.15 });
  }

  private shriek(t: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.linearRampToValueAtTime(2500, t + 0.3);
    const vib = ctx.createOscillator();
    vib.frequency.value = 13;
    const depth = ctx.createGain();
    depth.gain.value = 120;
    vib.connect(depth);
    depth.connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    g.gain.setTargetAtTime(0, t + 0.3, 0.08);
    o.connect(bp);
    bp.connect(g);
    g.connect(this.out(rand(-0.5, 0.5), 1));
    o.start(t);
    vib.start(t);
    o.stop(t + 0.8);
    vib.stop(t + 0.8);
  }

  private bolt(t: number, element: Element): void {
    const n = ELEMENT_NOISE[element];
    const pan = rand(-0.4, 0.4);
    this.noise(this.out(pan, 1), t, { type: 'bandpass', freq: n.freq * 0.5, to: n.freq * 1.3, glide: 0.2, q: n.q, level: 0.14, attack: 0.08, decay: 0.12, brown: n.brown });
    if (element === 'cold') this.ring(this.out(pan, 1), t + 0.05, 3400, 1.5, 0.6, 0.03, 0.2);
    if (element === 'lightning') for (let i = 0; i < 5; i++) this.noise(this.out(pan, 1), t + i * 0.025, { type: 'highpass', freq: 2500, level: 0.07, decay: 0.006 });
    if (element === 'fire') for (let i = 0; i < 4; i++) this.noise(this.out(pan, 1), t + rand(0, 0.25), { type: 'bandpass', freq: rand(1500, 4000), q: 1.5, level: 0.05, decay: 0.008 });
  }

  private explosion(t: number, element: Element): void {
    const n = ELEMENT_NOISE[element];
    this.thump(t, 0.6, 80, 32, 0.25);
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 1600, to: 200, glide: 0.6, level: 0.4, attack: 0.01, decay: 0.3, brown: true });
    this.noise(this.out(0, 1), t + 0.02, { type: 'bandpass', freq: n.freq, q: n.q, level: 0.12, attack: 0.02, decay: 0.25, brown: n.brown });
  }

  /* Warnings and feelings */

  private danger(t: number): void {
    this.chord(t, [0, 1], 0.9, 0.55, 'brass', 0);
    playVoice(this.core, 'timpani', this.out(0, 1), t, 0.5, this.key.root - 12, 0.7, { bright: 0.6, sustained: false });
  }

  private unique(t: number): void {
    playVoice(this.core, 'gong', this.out(0, 1), t, 4, this.key.root - 12, 0.8, { bright: 0.6, sustained: false });
    this.chord(t + 0.05, [0, 1, 4], 2.4, 0.6, 'ooh', 0);
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 200, q: 0.8, level: 0.25, attack: 0.6, decay: 0.6, brown: true });
  }

  private death(t: number): void {
    playVoice(this.core, 'gong', this.out(0, 1), t, 6, this.key.root - 12, 1, { bright: 0.5, sustained: false });
    const dest = this.out(0, 0.9);
    [4, 3, 2, 0].forEach((d, i) => playVoice(this.core, 'strings', dest, t + 0.4 + i * 0.75, 0.9, this.midi(d, 1), 0.85, { bright: 0.5, sustained: false }));
    this.chord(t + 0.3, [0, 4], 3.5, 0.5, 'choir', 0);
  }

  private heartbeat(t: number, s: number): void {
    const level = 0.25 + 0.3 * s;
    this.thump(t, level, 62, 38, 0.07);
    this.thump(t + 0.16, level * 0.7, 58, 36, 0.07);
  }

  private sickly(t: number): void {
    for (let i = 0; i < 3; i++) {
      const f = rand(180, 300);
      this.tone(this.out(rand(-0.3, 0.3), 1), t + i * 0.12, { type: 'triangle', freq: f, to: f * 0.6, glide: 0.15, level: 0.05, attack: 0.02, decay: 0.08 });
    }
  }

  private warble(t: number, rate: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = midiToFrequency(this.midi(4, 1));
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.value = 60;
    lfo.connect(depth);
    depth.connect(o.detune);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(220, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.2);
    g.gain.setTargetAtTime(0, t + 0.6, 0.15);
    o.connect(g);
    g.connect(this.out(0, 1));
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.6);
    lfo.stop(t + 1.6);
  }

  private freeze(t: number): void {
    this.ring(this.out(0, 1), t, 3600, 1.41, 1.5, 0.05, 0.25);
    this.noise(this.out(0, 1), t, { type: 'highpass', freq: 4000, level: 0.12, decay: 0.04 });
  }

  private shiver(t: number): void {
    const dest = this.out(0, 1);
    for (let i = 0; i < 10; i++) {
      const f = midiToFrequency(this.midi(i % 2 ? 1 : 0, 2));
      this.tone(dest, t + i * 0.07, { type: 'triangle', freq: f, level: 0.025, attack: 0.01, decay: 0.04 });
    }
  }

  private stun(t: number): void {
    this.thump(t, 0.4, 100, 40, 0.12);
    this.tone(this.out(0, 1), t + 0.05, { freq: 3500, level: 0.03, attack: 0.05, decay: 0.6 });
  }

  private growl(t: number): void {
    const ctx = this.core.ctx;
    const source = this.core.noiseSource(true);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.3);
    g.gain.setTargetAtTime(0, t + 0.7, 0.2);
    const am = ctx.createOscillator();
    am.frequency.value = 9;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.2;
    am.connect(amDepth);
    amDepth.connect(g.gain);
    source.connect(f);
    f.connect(g);
    g.connect(this.out(0, 1));
    source.start(t);
    am.start(t);
    source.stop(t + 2);
    am.stop(t + 2);
  }

  private shopBell(t: number): void {
    const dest = this.out(0.2, 1);
    playVoice(this.core, 'bell', dest, t, 1, this.midi(4, 2), 0.6, { bright: 0.8, sustained: false });
    playVoice(this.core, 'bell', dest, t + 0.16, 1, this.midi(2, 2), 0.5, { bright: 0.8, sustained: false });
  }

  private levelUp(t: number): void {
    this.chord(t, [0, 4, 7], 1.6, 0.45, 'strings', 1);
    this.arpeggio(t, [0, 2, 4, 7, 9, 11, 14], 0.08, 0.13, 'harp', 1);
    this.arpeggio(t + 0.56, [14], 0.1, 0.12, 'celesta', 1);
    this.noise(this.out(0, 1), t + 0.2, { type: 'highpass', freq: 4000, to: 10000, glide: 1, level: 0.03, attack: 0.5, decay: 0.4 });
  }

  private fanfare(t: number): void {
    const dest = this.out(0, 1);
    [0, 4, 7].forEach((d, i) => playVoice(this.core, 'horn', dest, t + i * 0.18, i === 2 ? 1.2 : 0.2, this.midi(d, 1), 0.9, { bright: 0.8, sustained: false }));
    playVoice(this.core, 'timpani', dest, t + 0.36, 0.5, this.key.root - 12, 0.8, { bright: 0.7, sustained: false });
  }
}
