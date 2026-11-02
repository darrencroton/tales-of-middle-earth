import type { AudioCore } from './core.ts';
import type { Cue, CueId, Element, LauncherKind, SpellTone, WeaponKind } from './cues.ts';
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
  miss: 20,
  hurt: 3,
  parry: 15,
  kill: 7,
  impact: 12,
  'door-open': 16,
  'door-close': 1,
  'door-locked': 11,
  unlock: 16,
  'distant-door': 10,
  'stairs-down': 6,
  'stairs-up': 5,
  travel: 8,
  pickup: 20,
  gold: 16,
  buy: 17,
  levelup: -3,
  learn: 9,
  quaff: 15,
  read: 16,
  eat: 26,
  cast: 7,
  fizzle: 20,
  fire: 13,
  throw: 18,
  zap: 18,
  activate: 12,
  wield: 12,
  takeoff: 20,
  drop: 8,
  fuel: 22,
  disarm: 16,
  tunnel: 12,
  heal: 16,
  teleport: 20,
  trap: 12,
  breath: 12,
  'spell-monster': 20,
  shriek: 20,
  shop: 11,
  deny: 12,
  poisoned: 23,
  confused: 15,
  hallucinate: 14,
  blind: 20,
  paralyzed: 16,
  afraid: 24,
  stun: 6,
  cut: 15,
  haste: 20,
  slow: 15,
  cured: 10,
  bolt: 24,
  explosion: 3,
  'ui-open': 10,
  'ui-close': 11,
  secret: 5,
  rumble: 8,
  unique: 6,
  death: 3,
  hungry: 11,
  quest: 1,
  save: 9,
  danger: 2,
};

/** A thump's sawtooth level, for the loudness of a sine of the given level. */
const THUMP_GAIN = 1.6;

/** Level trims in dB for a cast by its school, beside `cast`'s own, as some schools ring on longer than others. */
const CAST_DB: Partial<Record<SpellTone, number>> = { arcane: -2, frost: 2, earth: -5, nature: -11, holy: -6, mind: -1, song: -10 };

/** Sounds the music dips under (dB, and for how long), so the hero's own deeds and big moments stand out. */
const DUCK: Partial<Record<CueId, [number, number]>> = {
  cast: [5, 0.35],
  fire: [4, 0.25],
  throw: [3, 0.25],
  zap: [4, 0.3],
  activate: [4, 0.4],
  crit: [3, 0.25],
  'kill-unique': [7, 1.2],
  levelup: [7, 1.5],
  quest: [7, 1.5],
  explosion: [3, 0.4],
};

/** Element sounds for bolts and explosions, from the colour tome2 draws them in. */
const ELEMENT_NOISE: Record<Element, { freq: number; q: number; brown: boolean; gain?: number }> = {
  fire: { freq: 900, q: 0.6, brown: true, gain: 1.6 },
  cold: { freq: 4200, q: 1.2, brown: false, gain: 0.6 },
  lightning: { freq: 2600, q: 0.8, brown: false, gain: 0.6 },
  poison: { freq: 1400, q: 2.5, brown: false, gain: 1.6 },
  magic: { freq: 700, q: 0.9, brown: true, gain: 2 },
  dark: { freq: 400, q: 1, brown: true, gain: 1.6 },
  earth: { freq: 300, q: 0.7, brown: true, gain: 1.6 },
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
      const duck = DUCK[cue.id];
      if (duck) this.core.duck(t, duck[0], duck[1]);
    } catch (err) {
      console.warn('Sound effect failed', cue.id, err);
    } finally {
      this.trim = 1;
    }
  }

  private dispatch(cue: Cue, t: number, s: number, far: number): void {
    switch (cue.id) {
      case 'hit':
        return this.hit(t, s, false, cue.variant as WeaponKind | undefined);
      case 'crit':
        return this.hit(t, 1, true, cue.variant as WeaponKind | undefined);
      case 'miss':
        return this.whoosh(t, 0.16, 650, 2600, 0.17);
      case 'hurt':
        return this.hurt(t, s);
      case 'claw':
        return this.claw(t, s);
      case 'bite':
        return this.bite(t, s);
      case 'parry':
        this.whoosh(t, 0.08, 450, 1500, 0.12);
        return this.ring(this.out(rand(-0.2, 0.2), 1), t + 0.06, rand(1800, 2300), 1.41, 1.5, 0.05, 0.18);
      case 'kill':
        return this.kill(t, cue.variant as WeaponKind | undefined);
      case 'kill-unique':
        return this.killUnique(t, cue.variant as WeaponKind | undefined);
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
        return this.learn(t);
      case 'quaff':
        return this.quaff(t);
      case 'read':
        return this.read(t);
      case 'eat':
        return this.eat(t);
      case 'cast':
        return this.cast(t, cue.variant as SpellTone | undefined);
      case 'fizzle':
        return this.fizzle(t);
      case 'fire':
        return this.shoot(t, cue.variant as LauncherKind | undefined);
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
        return this.secret(t);
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
        return this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 3000, to: 400, glide: 0.6, level: 0.18, attack: 0.05, decay: 0.25, brown: true });
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
        return this.slow(t);
      case 'cured':
        return this.chord(t, [0, 4], 0.7, 0.85, 'glass', 1);
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
        return this.closeBook(t);
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

  /** A low blow, its body rounded off above its first few harmonics, which carry it on a phone speaker that cannot play the body itself. */
  private thump(t: number, level: number, from: number, to: number, decay: number, pan = 0): void {
    const round = this.core.ctx.createBiquadFilter();
    round.type = 'lowpass';
    round.frequency.value = from * 5;
    round.Q.value = 0.5;
    round.connect(this.out(pan, 1));
    this.tone(round, t, { type: 'sawtooth', freq: from, to, glide: 0.06, level: level * THUMP_GAIN, decay });
  }

  private whoosh(t: number, length: number, from: number, to: number, level: number, pan = rand(-0.3, 0.3)): void {
    this.noise(this.out(pan, 1), t, { type: 'bandpass', freq: from, to, glide: length, q: 1.4, level, attack: length * 0.45, decay: length * 0.35 });
  }

  private midi(degree: number, octave = 1): number {
    return degreeToMidi(this.key.root + 12 * octave, SCALES[this.key.scale], degree);
  }

  /** A note moved by octaves into the octave starting at `floor`, so a sound keeps its register whatever the key. */
  private low(midi: number, floor: number): number {
    return floor + ((((midi - floor) % 12) + 12) % 12);
  }

  private arpeggio(t: number, degrees: number[], step: number, level: number, inst: 'harp' | 'bell', octave: number): void {
    const dest = this.out(0, 1);
    degrees.forEach((d, i) => playVoice(this.core, inst, dest, t + i * step, 0.6, this.midi(d, octave), level / 0.12, { bright: 0.8, sustained: false }));
  }

  private chord(t: number, degrees: number[], dur: number, level: number, inst: 'strings' | 'choir' | 'glass' | 'ooh' | 'horn' | 'brass', octave: number): void {
    const dest = this.out(0, level);
    for (const d of degrees) playVoice(this.core, inst, dest, t, dur, this.midi(d, octave), 0.9, { bright: 0.7, sustained: true });
  }

  /* Combat */

  /** A blow, shaped by the weapon: a blade slices and rings, an axe chops, a mace thuds, a spear thrusts, a fist punches. */
  private hit(t: number, s: number, crit: boolean, weapon: WeaponKind = 'blade'): void {
    const pitch = rand(0.88, 1.12);
    const pan = rand(-0.2, 0.2);
    const out = () => this.out(pan, 1);
    switch (weapon) {
      case 'blade':
        this.thump(t, 0.25 + 0.25 * s, 170 * pitch, 60 * pitch, 0.07 + 0.04 * s, pan);
        this.noise(out(), t, { type: 'bandpass', freq: 3200 * pitch, to: 900, glide: 0.08, q: 1.2, level: 0.18 + 0.14 * s, decay: 0.035 });
        this.ring(out(), t + 0.01, 2400 * pitch, 1.41, 1.2, 0.025, 0.12);
        break;
      case 'axe':
        this.thump(t, 0.3 + 0.24 * s, 130 * pitch, 45 * pitch, 0.11 + 0.05 * s, pan);
        this.noise(out(), t, { type: 'bandpass', freq: 1300 * pitch, to: 380, glide: 0.06, q: 1.1, level: 0.14 + 0.1 * s, decay: 0.04 });
        this.noise(out(), t + 0.015, { type: 'highpass', freq: 2500, level: 0.08, decay: 0.01 });
        break;
      case 'blunt':
        this.thump(t, 0.44 + 0.28 * s, 105 * pitch, 34 * pitch, 0.13 + 0.06 * s, pan);
        this.noise(out(), t, { type: 'lowpass', freq: 900 * pitch, to: 300, glide: 0.08, level: 0.13 + 0.1 * s, decay: 0.05, brown: true });
        break;
      case 'polearm':
        this.whoosh(t, 0.08, 700, 2400, 0.12, pan);
        this.thump(t + 0.07, 0.31 + 0.27 * s, 150 * pitch, 55 * pitch, 0.08 + 0.05 * s, pan);
        this.noise(out(), t + 0.07, { type: 'bandpass', freq: 1800 * pitch, to: 600, glide: 0.05, q: 1, level: 0.11 + 0.09 * s, decay: 0.03 });
        break;
      case 'unarmed':
        this.thump(t, 0.3 + 0.25 * s, 140 * pitch, 70 * pitch, 0.06 + 0.03 * s, pan);
        this.noise(out(), t, { type: 'lowpass', freq: 1400 * pitch, level: 0.1 + 0.08 * s, decay: 0.025 });
        break;
    }
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
    this.noise(this.out(0, 1), t + 0.015, { type: 'lowpass', freq: 600, level: 0.16, decay: 0.03, brown: true });
    this.hurt(t + 0.03, s);
  }

  /** A creature falls: after a blow, the blow of the weapon that felled it; after a spell or a shot, whose own sound struck it, only the fall. */
  private kill(t: number, weapon?: WeaponKind): void {
    if (weapon) this.hit(t, 0.9, false, weapon);
    else this.thump(t + 0.05, 0.25, 120, 42, 0.12);
    this.noise(this.out(rand(-0.2, 0.2), 1), t + 0.09, { type: 'lowpass', freq: 700, to: 200, glide: 0.25, level: weapon ? 0.18 : 0.3, attack: 0.01, decay: 0.12, brown: true });
    this.noise(this.out(rand(-0.2, 0.2), 1), t + 0.12, { type: 'bandpass', freq: 1200, to: 300, glide: 0.4, q: 1.2, level: 0.35, attack: 0.03, decay: 0.14 });
    this.thump(t + 0.22, 0.22, 75, 38, 0.1);
  }

  private killUnique(t: number, weapon?: WeaponKind): void {
    if (weapon) this.hit(t, 1, true, weapon);
    playVoice(this.core, 'gong', this.out(0, 1), t + 0.05, 4, this.key.root - 12, 0.9, { bright: 0.7, sustained: false });
    [0, 0.18, 0.36].forEach((d, i) => playVoice(this.core, 'timpani', this.out(0, 1), t + d, 0.5, this.key.root - 12 + (i === 2 ? 7 : 0), 0.8, { bright: 0.7, sustained: false }));
    this.chord(t + 0.3, [0, 4, 7, 9], 2.2, 0.5, 'strings', 1);
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
    g.gain.linearRampToValueAtTime(0.2, t + 0.03 + length * 0.3);
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
    const pan = rand(-0.2, 0.2);
    const dest = this.out(pan, far);
    this.thump(t, 0.4 * far, 95, 48, 0.12, pan);
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
    this.ring(this.out(0.1, 1), t + 0.07, rand(1100, 1500), 2.76, 1.2, 0.03, 0.05);
  }

  private coins(t: number, s: number): void {
    const count = Math.round(2 + s * 6);
    let at = t;
    for (let i = 0; i < count; i++) {
      const f = rand(1900, 3400);
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
      const f = rand(300, 500);
      this.tone(this.out(0, 1), at, { freq: f, to: f * 1.5, glide: 0.05, level: 0.1, attack: 0.01, decay: 0.035 });
      this.noise(this.out(0, 1), at, { type: 'lowpass', freq: 700, level: 0.06, attack: 0.01, decay: 0.05, brown: true });
      this.noise(this.out(0, 1), at + 0.02, { type: 'bandpass', freq: rand(800, 1500), q: 4, level: 0.16, decay: 0.02 });
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
    for (let i = 0; i < 10; i++) {
      this.noise(this.out(0, 1), t + i * rand(0.03, 0.05), { type: 'bandpass', freq: rand(700, 1400), q: 4, level: 0.5, attack: 0.005, decay: 0.025, brown: true });
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

  private learn(t: number): void {
    this.rustle(t, 0.08);
    this.arpeggio(t + 0.1, [0, 4, 7], 0.08, 0.045, 'harp', 1);
  }

  /** Stone grinding aside, then a bell. */
  private secret(t: number): void {
    this.noise(this.out(0.1, 1), t, { type: 'bandpass', freq: 380, to: 220, glide: 0.5, q: 2, level: 0.18, attack: 0.12, decay: 0.15, brown: true });
    this.thump(t + 0.45, 0.18, 90, 50, 0.08, 0.1);
    this.arpeggio(t + 0.3, [4], 0, 0.18, 'bell', 1);
  }

  /** A book shut: pages, the cover, then its clasp. */
  private closeBook(t: number): void {
    this.rustle(t, 0.07);
    this.thump(t + 0.12, 0.22, 160, 80, 0.05);
    this.noise(this.out(0, 1), t + 0.12, { type: 'lowpass', freq: 1200, level: 0.08, decay: 0.03, brown: true });
    this.ring(this.out(0.1, 1), t + 0.24, rand(1500, 1800), 2.76, 1.5, 0.04, 0.05);
  }

  /* Magic */

  /** A dark swell under a spell: two sawtooths a little apart, kept low. */
  private drone(t: number, freq: number, length: number, level: number): void {
    const ctx = this.core.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.03, length * 0.3);
    lp.connect(g);
    g.connect(this.out(0, 1));
    for (const cents of [-12, 12]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + length * 2.5);
    }
  }

  /** Ice cracking: `count` brittle ticks over `length` seconds. */
  private crackle(t: number, count: number, length: number, level: number, pan = 0): void {
    for (let i = 0; i < count; i++) this.noise(this.out(pan + rand(-0.2, 0.2), 1), t + rand(0, length), { type: 'bandpass', freq: rand(3500, 7000), q: 3, level: level * rand(0.6, 1), decay: 0.006 });
  }

  /** A spell let go, coloured by its school (the god's, for a prayer): an onset at once and a short tail. */
  private cast(t: number, tone: SpellTone = 'arcane'): void {
    this.trim *= Math.pow(10, (CAST_DB[tone] ?? 0) / 20);
    const out = () => this.out(0, 1);
    const flare = (freq: number, to: number, level: number, brown = false) =>
      this.noise(out(), t, { type: brown ? 'lowpass' : 'bandpass', freq, to, glide: 0.12, q: 1.6, level, attack: 0.012, decay: 0.09, brown });
    switch (tone) {
      case 'arcane':
        flare(300, 1800, 0.4);
        this.thump(t, 0.18, 90, 34, 0.18);
        this.noise(out(), t + 0.02, { type: 'lowpass', freq: 2400, to: 240, glide: 0.4, level: 0.12, attack: 0.01, decay: 0.16, brown: true });
        this.noise(out(), t + 0.02, { type: 'bandpass', freq: 650, to: 260, glide: 0.35, q: 1.5, level: 1.2, attack: 0.01, decay: 0.14, brown: true });
        this.noise(out(), t + 0.02, { type: 'bandpass', freq: 1300, to: 450, glide: 0.3, q: 1.5, level: 0.35, attack: 0.01, decay: 0.12, brown: true });
        this.drone(t, midiToFrequency(this.low(this.key.root, 43)), 0.5, 0.12);
        this.ring(out(), t + 0.02, midiToFrequency(this.low(this.key.root, 50)), 1.41, 2.4, 0.12, 0.4);
        break;
      case 'fire':
        flare(250, 3200, 0.55, true);
        this.whoosh(t, 0.2, 400, 2200, 0.35, 0);
        this.thump(t, 0.25, 70, 40, 0.15);
        for (let i = 0; i < 6; i++) this.noise(this.out(rand(-0.3, 0.3), 1), t + rand(0.02, 0.3), { type: 'bandpass', freq: rand(1500, 4500), q: 1.5, level: 0.14, decay: 0.008 });
        break;
      case 'frost':
        flare(3500, 8000, 0.12);
        this.whoosh(t, 0.35, 1500, 5000, 0.18, 0);
        this.thump(t, 0.18, 80, 40, 0.12);
        this.crackle(t + 0.03, 8, 0.3, 0.08);
        break;
      case 'storm':
        this.noise(out(), t, { type: 'highpass', freq: 1800, level: 0.45, decay: 0.014 });
        this.zap(t + 0.01);
        this.noise(out(), t + 0.03, { type: 'lowpass', freq: 600, to: 120, glide: 0.4, level: 0.4, decay: 0.22, brown: true });
        break;
      case 'earth':
        this.thump(t, 0.6, 95, 32, 0.2);
        flare(200, 700, 0.25, true);
        break;
      case 'shadow':
        flare(300, 1100, 0.2, true);
        this.tone(out(), t, { type: 'sawtooth', freq: 110, to: 73, glide: 0.4, level: 0.08, attack: 0.02, decay: 0.18, detune: 25 });
        this.arpeggio(t + 0.02, [0, 1], 0.09, 0.12, 'bell', 0);
        break;
      case 'nature':
        flare(1200, 2600, 0.1);
        this.arpeggio(t, [0, 4, 7, 11], 0.05, 0.16, 'harp', 1);
        break;
      case 'holy':
        flare(900, 3000, 0.18);
        this.arpeggio(t, [0], 0, 0.3, 'bell', 1);
        this.chord(t, [0, 4, 7], 0.6, 0.5, 'choir', 1);
        break;
      case 'mind':
        flare(500, 2000, 0.3);
        this.noise(this.out(-0.3, 1), t, { type: 'bandpass', freq: 900, to: 2200, glide: 0.3, q: 7, level: 0.8, attack: 0.04, decay: 0.15 });
        this.noise(this.out(0.3, 1), t + 0.05, { type: 'bandpass', freq: 1400, to: 700, glide: 0.3, q: 7, level: 0.65, attack: 0.04, decay: 0.15 });
        this.chord(t, [0, 4], 0.8, 1, 'ooh', 0);
        break;
      case 'song':
        this.arpeggio(t, [0, 2, 4, 7, 9], 0.05, 0.16, 'harp', 1);
        break;
    }
  }

  /** A cast that gathers and collapses: the swell of `cast` cut short by a falling puff. */
  private fizzle(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 400, to: 1300, glide: 0.2, q: 2, level: 0.15, attack: 0.18, decay: 0.04 });
    this.thump(t + 0.2, 0.05, 110, 50, 0.08);
    this.noise(this.out(0, 1), t + 0.2, { type: 'bandpass', freq: 1400, to: 400, glide: 0.25, q: 0.8, level: 0.3, decay: 0.08, brown: true });
  }

  /** A shot: a bow's twang, a sling's whirl and release, a crossbow's click and thunk. */
  private shoot(t: number, launcher: LauncherKind = 'bow'): void {
    switch (launcher) {
      case 'bow':
        this.tone(this.out(0.1, 1), t, { type: 'triangle', freq: 190, to: 170, glide: 0.1, level: 0.13, decay: 0.09 });
        this.noise(this.out(0.1, 1), t, { type: 'highpass', freq: 2000, level: 0.05, decay: 0.006 });
        this.whoosh(t + 0.04, 0.18, 2200, 800, 0.12, 0.3);
        break;
      case 'sling':
        this.whoosh(t, 0.12, 500, 1100, 0.25, -0.2);
        this.whoosh(t + 0.13, 0.12, 550, 1300, 0.3, 0.2);
        this.whoosh(t + 0.26, 0.16, 1600, 700, 0.4, 0.3);
        break;
      case 'crossbow':
        this.noise(this.out(0.1, 1), t, { type: 'highpass', freq: 3500, level: 0.12, decay: 0.008 });
        this.tone(this.out(0.1, 1), t + 0.02, { type: 'triangle', freq: 140, to: 95, glide: 0.06, level: 0.16, decay: 0.06 });
        this.whoosh(t + 0.05, 0.14, 2600, 900, 0.12, 0.3);
        break;
    }
  }

  private zap(t: number): void {
    const dest = this.out(0, 1);
    const bp = this.core.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    bp.connect(dest);
    this.noise(bp, t, { type: 'bandpass', freq: 3000, to: 700, glide: 0.2, q: 1.5, level: 0.25, attack: 0.02, decay: 0.1 });
    this.thump(t, 0.02, 90, 45, 0.06);
    for (let i = 0; i < 4; i++) this.noise(dest, t + i * 0.03, { type: 'highpass', freq: 3000, level: 0.012, decay: 0.006 });
    for (let i = 0; i < 9; i++) this.noise(dest, t + 0.02 + i * rand(0.018, 0.026), { type: 'bandpass', freq: rand(1000, 2000), q: 2, level: 0.12, attack: 0.004, decay: 0.012 });
  }

  private activate(t: number): void {
    this.tone(this.out(-0.2, 1), t, { freq: 220, level: 0.05, attack: 0.08, decay: 0.25 });
    this.tone(this.out(0.2, 1), t, { freq: 331, level: 0.04, attack: 0.08, decay: 0.25 });
    this.ring(this.out(0, 1), t + 0.08, midiToFrequency(this.low(this.key.root, 50)), 1.41, 2, 0.06, 0.5);
    this.chord(t + 0.08, [0, 7], 0.9, 0.35, 'ooh', 0);
  }

  private heal(t: number): void {
    this.chord(t, [0, 2, 4], 0.9, 0.4, 'glass', 1);
    this.noise(this.out(0, 1), t + 0.1, { type: 'highpass', freq: 5000, to: 9000, glide: 0.6, level: 0.025, attack: 0.3, decay: 0.3 });
  }

  private teleport(t: number): void {
    this.noise(this.out(-0.3, 1), t, { type: 'bandpass', freq: 200, to: 4500, glide: 0.35, q: 3, level: 0.12, attack: 0.25, decay: 0.12 });
    this.thump(t + 0.4, 0.06, 90, 45, 0.12);
    this.noise(this.out(0.3, 1), t + 0.4, { type: 'bandpass', freq: 3500, to: 300, glide: 0.4, q: 3, level: 0.06, attack: 0.05, decay: 0.2 });
  }

  private trap(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'highpass', freq: 1500, level: 0.3, decay: 0.01 });
    this.ring(this.out(0, 1), t + 0.01, rand(550, 750), 2.76, 2.5, 0.02, 0.12);
    this.thump(t + 0.03, 0.1, 110, 40, 0.12);
    this.ring(this.out(0, 1), t + 0.09, rand(900, 1200), 2.76, 2, 0.03, 0.08);
  }

  private rumble(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 120, q: 0.8, level: 0.6, attack: 0.4, decay: 0.8, brown: true });
    for (let i = 0; i < 10; i++) this.noise(this.out(rand(-0.7, 0.7), 1), t + rand(0.1, 1.2), { type: 'bandpass', freq: rand(400, 1800), q: 1.5, level: 0.12, decay: 0.03, brown: true });
  }

  private breath(t: number, element: Element): void {
    const n = ELEMENT_NOISE[element];
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 300, to: 1400, glide: 0.4, level: 0.25, attack: 0.25, decay: 0.35, brown: true });
    this.noise(this.out(0, 1), t + 0.1, { type: 'bandpass', freq: n.freq, q: n.q, level: 0.15 * (n.gain ?? 1), attack: 0.2, decay: 0.3, brown: n.brown });
  }

  private monsterSpell(t: number): void {
    this.noise(this.out(rand(-0.4, 0.4), 1), t, { type: 'bandpass', freq: 300, to: 1600, glide: 0.4, q: 3, level: 0.2, attack: 0.35, decay: 0.06 });
    this.tone(this.out(0, 1), t, { type: 'sawtooth', freq: midiToFrequency(this.low(this.key.root, 48)), level: 0.04, attack: 0.3, decay: 0.15 });
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
    this.noise(this.out(pan, 1), t, { type: 'bandpass', freq: n.freq * 0.5, to: n.freq * 1.3, glide: 0.2, q: n.q, level: 0.14 * (n.gain ?? 1), attack: 0.08, decay: 0.12, brown: n.brown });
    if (element === 'cold') this.crackle(t + 0.03, 5, 0.2, 0.05, pan);
    if (element === 'lightning') for (let i = 0; i < 5; i++) this.noise(this.out(pan, 1), t + i * 0.025, { type: 'highpass', freq: 2500, level: 0.07, decay: 0.006 });
    if (element === 'fire') for (let i = 0; i < 4; i++) this.noise(this.out(pan, 1), t + rand(0, 0.25), { type: 'bandpass', freq: rand(1500, 4000), q: 1.5, level: 0.05, decay: 0.008 });
  }

  private explosion(t: number, element: Element): void {
    const n = ELEMENT_NOISE[element];
    this.thump(t, 0.6, 80, 32, 0.25);
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 1600, to: 200, glide: 0.6, level: 0.4, attack: 0.01, decay: 0.3, brown: true });
    this.noise(this.out(0, 1), t + 0.02, { type: 'bandpass', freq: n.freq, q: n.q, level: 0.12 * (n.gain ?? 1), attack: 0.02, decay: 0.25, brown: n.brown });
    this.noise(this.out(0, 1), t, { type: 'highpass', freq: 1800, level: 0.2, decay: 0.015 });
    for (let i = 0; i < 6; i++) this.noise(this.out(rand(-0.5, 0.5), 1), t + rand(0.05, 0.4), { type: 'bandpass', freq: rand(1200, 3500), q: 1.5, level: 0.06, decay: 0.01 });
  }

  /* Warnings and feelings */

  private danger(t: number): void {
    this.chord(t, [0, 1], 0.9, 1.1, 'brass', 1);
    this.chord(t, [0, 1], 0.9, 0.5, 'brass', 2);
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
    for (let i = 0; i < 4; i++) {
      const f = rand(500, 900);
      this.noise(this.out(rand(-0.3, 0.3), 1), t + i * rand(0.08, 0.13), { type: 'bandpass', freq: f, to: f * 0.6, glide: 0.12, q: 6, level: 0.63, attack: 0.02, decay: 0.06, brown: true });
    }
  }

  /** A reeling head: breathy noise whose pitch sways ever wider at `rate` times a second. */
  private warble(t: number, rate: number): void {
    const ctx = this.core.ctx;
    const source = this.core.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = midiToFrequency(this.midi(4, 1));
    f.Q.value = 9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(900, t + 0.6);
    lfo.connect(depth);
    depth.connect(f.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.2);
    g.gain.setTargetAtTime(0, t + 0.6, 0.15);
    source.connect(f);
    f.connect(g);
    g.connect(this.out(0, 1));
    source.start(t, Math.random() * 1.5);
    lfo.start(t);
    source.stop(t + 1.6);
    lfo.stop(t + 1.6);
  }

  /** Held fast: chains drawn tight, cut off dead, and a caught breath. */
  private freeze(t: number): void {
    for (let i = 0; i < 4; i++) this.ring(this.out(rand(-0.3, 0.3), 1), t + i * rand(0.04, 0.06), rand(900, 1400), 2.76, 2, 0.05, 0.05);
    this.thump(t + 0.24, 0.12, 110, 60, 0.06);
    this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 1600, to: 900, glide: 0.2, q: 2, level: 0.25, attack: 0.03, decay: 0.08 });
  }

  /** Fear: low strings a step apart and a held breath. */
  private shiver(t: number): void {
    this.chord(t, [0, 1], 0.9, 0.09, 'strings', 1);
    this.noise(this.out(0, 1), t, { type: 'bandpass', freq: 1800, to: 900, glide: 0.5, q: 2, level: 0.015, attack: 0.15, decay: 0.15 });
  }

  /** Slowed: a low groan dragging down. */
  private slow(t: number): void {
    this.noise(this.out(0, 1), t, { type: 'lowpass', freq: 1800, to: 250, glide: 0.7, level: 0.25, attack: 0.05, decay: 0.3, brown: true });
    this.tone(this.out(0, 1), t, { freq: 95, to: 55, glide: 0.6, level: 0.04, attack: 0.05, decay: 0.3 });
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
    f.frequency.value = 380;
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
    this.arpeggio(t + 0.56, [14], 0.1, 0.12, 'bell', 1);
    this.noise(this.out(0, 1), t + 0.2, { type: 'highpass', freq: 4000, to: 10000, glide: 1, level: 0.03, attack: 0.5, decay: 0.4 });
  }

  private fanfare(t: number): void {
    const dest = this.out(0, 1);
    [0, 4, 7].forEach((d, i) => playVoice(this.core, 'horn', dest, t + i * 0.18, i === 2 ? 1.2 : 0.2, this.midi(d, 1), 0.9, { bright: 0.8, sustained: false }));
    playVoice(this.core, 'timpani', dest, t + 0.36, 0.5, this.key.root - 12, 0.8, { bright: 0.7, sustained: false });
  }
}
