import type { AudioCore } from './core.ts';
import type { Instrument } from './themes.ts';
import { midiToFrequency } from './theory.ts';

export interface VoiceOptions {
  /** Tone colour 0 (muffled) .. 1 (bright). */
  bright: number;
  /** Slow swells for pads and drones; a quicker start for lines. */
  sustained: boolean;
}

type Voice = (core: AudioCore, dest: AudioNode, t: number, dur: number, midi: number, vel: number, opts: VoiceOptions) => void;

/* Harmonic recipes. */
const warm = () => Array.from({ length: 24 }, (_, i) => 1 / Math.pow(i + 1, 1.35));
const pluck = () => Array.from({ length: 16 }, (_, i) => 1 / Math.pow(i + 1, 1.9));
const bright = () => Array.from({ length: 20 }, (_, i) => 1 / Math.pow(i + 1, 1.25));
const reedy = () => Array.from({ length: 15 }, (_, i) => ((i + 1) % 2 === 1 ? 1 / (i + 1) : 0.04 / (i + 1)));
const brassy = () => [1, 0.75, 0.6, 0.48, 0.36, 0.27, 0.2, 0.14, 0.1, 0.07, 0.05, 0.035];
const fluty = () => [1, 0.12, 0.05, 0.02];
const organ = () => [1, 0.75, 0.55, 0.45, 0, 0.3, 0, 0.22, 0, 0.1, 0, 0.08];

/** Gain envelope: rise, settle to a sustain level, fall after `dur`; returns when it is silent. */
function envelope(param: AudioParam, t: number, attack: number, peak: number, sustain: number, dur: number, release: number): number {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (sustain !== peak) param.setTargetAtTime(sustain, t + attack, Math.max(0.05, dur * 0.3));
  const end = t + Math.max(dur, attack);
  param.setTargetAtTime(0, end, release / 3);
  return end + release * 1.6;
}

function osc(core: AudioCore, type: OscillatorType | PeriodicWave, frequency: number, t: number, stop: number, detune = 0): OscillatorNode {
  const o = core.ctx.createOscillator();
  if (typeof type === 'string') o.type = type as OscillatorType;
  else o.setPeriodicWave(type);
  o.frequency.value = frequency;
  o.detune.value = detune;
  o.start(t);
  o.stop(stop);
  return o;
}

function gain(core: AudioCore, value = 0): GainNode {
  const g = core.ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(core: AudioCore, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = core.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(20000, Math.max(20, frequency));
  f.Q.value = q;
  return f;
}

/** Vibrato on the given oscillators, fading in after `delay` and out at `stop`. */
function vibrato(core: AudioCore, targets: OscillatorNode[], t: number, stop: number, rate: number, cents: number, delay: number): void {
  const depth = gain(core, 0);
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(cents, t + delay + 0.4);
  depth.gain.setValueAtTime(0, stop);
  core.lfo(rate).connect(depth);
  for (const target of targets) depth.connect(target.detune);
  targets[0].addEventListener('ended', () => depth.disconnect(), { once: true });
}

/** Slow pitch drift across a held note, so stacked pad voices beat gently against each other. */
function drift(o: OscillatorNode, t: number, end: number, cents: number): void {
  const from = (Math.random() * 2 - 1) * cents;
  o.detune.setValueAtTime(from, t);
  o.detune.linearRampToValueAtTime(-from * 0.6, end);
}

function noiseBurst(core: AudioCore, dest: AudioNode, t: number, type: BiquadFilterType, frequency: number, q: number, level: number, attack: number, decay: number): void {
  const source = core.noiseSource();
  const f = filter(core, type, frequency, q);
  const g = gain(core);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay);
  source.connect(f);
  f.connect(g);
  g.connect(dest);
  source.start(t, Math.random() * 1.5);
  source.stop(t + attack + decay * 6);
}

function bowed(core: AudioCore, dest: AudioNode, t: number, dur: number, f: number, vel: number, opts: VoiceOptions, level: number, cutoff: number, detuneCents: number): void {
  const attack = opts.sustained ? Math.min(1.2, 0.25 + dur * 0.12) : 0.09;
  const g = gain(core);
  const end = envelope(g.gain, t, attack, level * vel, level * vel * 0.85, dur, opts.sustained ? 1.1 : 0.35);
  const wave = core.wave('warm', warm);
  const lp = filter(core, 'lowpass', Math.min(cutoff, f * 3 + 500 + 1600 * opts.bright), 0.6);
  if (opts.sustained) {
    const a = osc(core, wave, f, t, end);
    drift(a, t, end, detuneCents + 3);
    a.connect(lp);
  } else {
    const a = osc(core, wave, f, t, end, -detuneCents);
    const b = osc(core, wave, f, t, end, detuneCents);
    vibrato(core, [a, b], t, end, 5.3, 9, 0.25);
    a.connect(lp);
    b.connect(lp);
  }
  lp.connect(g);
  g.connect(dest);
}

const FORMANTS: Record<'ah' | 'oo', [number, number, number, number]> = {
  ah: [740, 6, 1150, 8],
  oo: [330, 5, 880, 7],
};

function sung(core: AudioCore, dest: AudioNode, t: number, dur: number, f: number, vel: number, opts: VoiceOptions, vowel: 'ah' | 'oo', level: number, solo: boolean): void {
  const attack = solo ? 0.18 : opts.sustained ? Math.min(1.4, 0.4 + dur * 0.12) : 0.25;
  const g = gain(core);
  const end = envelope(g.gain, t, attack, level * vel, level * vel * 0.9, dur, solo ? 0.5 : 1.2);
  const wave = core.wave('bright', bright);
  const voices = [osc(core, wave, f, t, end)];
  if (solo || !opts.sustained) vibrato(core, voices, t, end, solo ? 5.4 : 4.6, solo ? 14 : 6, solo ? 0.3 : 0);
  else drift(voices[0], t, end, 12);
  const [f1, q1, f2, q2] = FORMANTS[vowel];
  const shift = solo && f > 500 ? 1.15 : 1;
  const formant1 = filter(core, 'bandpass', f1 * shift, q1);
  const formant2 = filter(core, 'bandpass', f2 * shift, q2);
  const body = filter(core, 'lowpass', 700 + 500 * opts.bright, 0.5);
  const g1 = gain(core, 1);
  const g2 = gain(core, 0.55);
  const gb = gain(core, 0.35);
  for (const v of voices) {
    v.connect(formant1);
    v.connect(formant2);
    v.connect(body);
  }
  formant1.connect(g1);
  formant2.connect(g2);
  body.connect(gb);
  g1.connect(g);
  g2.connect(g);
  gb.connect(g);
  g.connect(dest);
}

function plucked(core: AudioCore, dest: AudioNode, t: number, f: number, vel: number, opts: VoiceOptions, level: number, sustain: number, brightness: number, double: boolean): void {
  const tau = sustain * Math.pow(220 / f, 0.25);
  const end = t + tau * 5;
  const g = gain(core);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level * vel, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, tau);
  const lp = filter(core, 'lowpass', Math.min(12000, f * brightness * (0.6 + opts.bright)), 0.8);
  lp.frequency.setTargetAtTime(Math.max(300, f * 2), t + 0.01, 0.25);
  const wave = core.wave(brightness > 8 ? 'bright' : 'pluck', brightness > 8 ? bright : pluck);
  osc(core, wave, f, t, end, double ? (Math.random() * 2 - 1) * 5 : 0).connect(lp);
  lp.connect(g);
  g.connect(dest);
}

function blown(core: AudioCore, dest: AudioNode, t: number, dur: number, f: number, vel: number, opts: VoiceOptions, level: number, breath: number, rate: number, cents: number): void {
  const g = gain(core);
  const end = envelope(g.gain, t, 0.06, level * vel, level * vel * 0.82, dur, 0.22);
  const a = osc(core, core.wave('flute', fluty), f, t, end);
  vibrato(core, [a], t, end, rate, cents, 0.28);
  const lp = filter(core, 'lowpass', f * (3 + 3 * opts.bright), 0.5);
  a.connect(lp);
  lp.connect(g);
  g.connect(dest);
  if (dur > 0.3) noiseBurst(core, dest, t, 'bandpass', Math.min(9000, f * 2.2), 1.2, level * vel * breath, 0.02, 0.08);
}

function horn(core: AudioCore, dest: AudioNode, t: number, dur: number, f: number, vel: number, opts: VoiceOptions, level: number, maxCutoff: number, attack: number): void {
  const g = gain(core);
  const end = envelope(g.gain, t, attack, level * vel, level * vel * 0.85, dur, 0.35);
  const o = osc(core, core.wave('brass', brassy), f, t, end, -18);
  o.detune.linearRampToValueAtTime(0, t + 0.08);
  const lp = filter(core, 'lowpass', f * 1.1, 0.9);
  lp.frequency.linearRampToValueAtTime(Math.min(maxCutoff, f * (2.2 + 2.5 * vel * opts.bright)), t + attack + 0.05);
  lp.frequency.setTargetAtTime(Math.min(maxCutoff, f * 2.4), t + attack + 0.05, 0.4);
  if (!opts.sustained) vibrato(core, [o], t, end, 4.8, 5, 0.35);
  o.connect(lp);
  lp.connect(g);
  g.connect(dest);
}

/** Frequency-modulated tone for bells, gongs and anvils. */
function struck(core: AudioCore, dest: AudioNode, t: number, f: number, vel: number, level: number, ratio: number, index: number, indexDecay: number, decay: number, attack = 0.002): void {
  const end = t + decay * 5;
  const carrier = osc(core, 'sine', f, t, end);
  const modulator = osc(core, 'sine', f * ratio, t, end);
  const depth = gain(core);
  depth.gain.setValueAtTime(f * index * vel, t);
  depth.gain.setTargetAtTime(f * index * 0.08, t, indexDecay);
  modulator.connect(depth);
  depth.connect(carrier.frequency);
  const g = gain(core);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level * vel, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay);
  carrier.connect(g);
  g.connect(dest);
}

function membrane(core: AudioCore, dest: AudioNode, t: number, f: number, vel: number, level: number, bend: number, decay: number, slap: number, slapFreq: number): void {
  const end = t + decay * 5;
  const o = osc(core, 'sine', f * bend, t, end);
  o.frequency.setTargetAtTime(f, t, 0.03);
  const g = gain(core);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level * vel, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.003, decay);
  o.connect(g);
  g.connect(dest);
  if (slap > 0) noiseBurst(core, dest, t, 'bandpass', slapFreq, 0.9, level * vel * slap, 0.001, 0.03);
}

const VOICES: Record<Instrument, Voice> = {
  strings: (c, d, t, dur, m, v, o) => bowed(c, d, t, dur, midiToFrequency(m), v, o, 0.16, 5200, 7),
  cello: (c, d, t, dur, m, v, o) => bowed(c, d, t, dur, midiToFrequency(m), v, o, 0.2, 1900, 3),
  choir: (c, d, t, dur, m, v, o) => sung(c, d, t, dur, midiToFrequency(m), v, o, 'ah', 0.2, false),
  ooh: (c, d, t, dur, m, v, o) => sung(c, d, t, dur, midiToFrequency(m), v, o, 'oo', 0.26, false),
  voice: (c, d, t, dur, m, v, o) => sung(c, d, t, dur, midiToFrequency(m), v, o, 'ah', 0.16, true),
  organ: (c, d, t, dur, m, v, o) => {
    const f = midiToFrequency(m);
    const g = gain(c);
    const end = envelope(g.gain, t, 0.05, 0.07 * v, 0.065 * v, dur, 0.3);
    const lp = filter(c, 'lowpass', 1800 + 2500 * o.bright, 0.5);
    osc(c, c.wave('organ', organ), f, t, end).connect(lp);
    osc(c, c.wave('organ', organ), f, t, end, 4).connect(lp);
    lp.connect(g);
    g.connect(d);
  },
  harp: (c, d, t, _dur, m, v, o) => plucked(c, d, t, midiToFrequency(m), v, o, 0.22, 0.75, 7, false),
  lute: (c, d, t, _dur, m, v, o) => plucked(c, d, t, midiToFrequency(m), v, o, 0.17, 0.42, 11, true),
  flute: (c, d, t, dur, m, v, o) => blown(c, d, t, dur, midiToFrequency(m), v, o, 0.15, 0.35, 5, 12),
  whistle: (c, d, t, dur, m, v, o) => blown(c, d, t, dur, midiToFrequency(m), v, o, 0.1, 0.25, 6, 10),
  reed: (c, d, t, dur, m, v, o) => {
    const f = midiToFrequency(m);
    const g = gain(c);
    const end = envelope(g.gain, t, 0.07, 0.11 * v, 0.095 * v, dur, 0.25);
    const r = osc(c, c.wave('reed', reedy), f, t, end);
    vibrato(c, [r], t, end, 4.9, 7, 0.35);
    const lp = filter(c, 'lowpass', Math.min(4500, f * (3 + 2 * o.bright)), 0.7);
    r.connect(lp);
    lp.connect(g);
    g.connect(d);
  },
  horn: (c, d, t, dur, m, v, o) => horn(c, d, t, dur, midiToFrequency(m), v, o, 0.13, 2200, 0.11),
  brass: (c, d, t, dur, m, v, o) => horn(c, d, t, dur, midiToFrequency(m), v, o, 0.1, 3200, 0.07),
  bell: (c, d, t, _dur, m, v) => struck(c, d, t, midiToFrequency(m), v, 0.11, 3.5, 2.2, 0.6, 1.5),
  celesta: (c, d, t, _dur, m, v) => struck(c, d, t, midiToFrequency(m), v, 0.1, 4, 1.1, 0.12, 0.6),
  glass: (c, d, t, dur, m, v, o) => {
    const f = midiToFrequency(m);
    const g = gain(c);
    const end = envelope(g.gain, t, o.sustained ? 0.8 : 0.25, 0.07 * v, 0.06 * v, dur, 1.8);
    osc(c, 'sine', f, t, end).connect(g);
    osc(c, 'sine', f * 1.0025, t, end).connect(g);
    const h = gain(c, 0.25);
    osc(c, 'sine', f * 2.001, t, end).connect(h);
    h.connect(g);
    g.connect(d);
  },
  drone: (c, d, t, dur, m, v, o) => {
    const f = midiToFrequency(m);
    const g = gain(c);
    const end = envelope(g.gain, t, 3, 0.12 * v, 0.11 * v, dur, 4);
    const cutoff = 260 + 380 * o.bright;
    const lp = filter(c, 'lowpass', cutoff * 0.7, 0.8);
    lp.frequency.linearRampToValueAtTime(cutoff * 1.25, t + Math.max(4, dur * 0.5));
    lp.frequency.linearRampToValueAtTime(cutoff * 0.8, end);
    const body = osc(c, c.wave('warm', warm), f, t, end);
    drift(body, t, end, 6);
    body.connect(lp);
    const fundamental = gain(c, 0.45);
    osc(c, 'sine', f, t, end).connect(fundamental);
    fundamental.connect(g);
    lp.connect(g);
    g.connect(d);
  },
  drum: (c, d, t, _dur, m, v) => membrane(c, d, t, midiToFrequency(m), v, 0.75, 2.2, 0.32, 0.35, 700),
  timpani: (c, d, t, _dur, m, v) => {
    const f = midiToFrequency(m);
    membrane(c, d, t, f, v, 0.45, 1.05, 0.9, 0.25, 420);
    membrane(c, d, t, f * 1.5, v, 0.16, 1.03, 0.6, 0, 0);
    membrane(c, d, t, f * 1.98, v, 0.08, 1.02, 0.4, 0, 0);
  },
  frame: (c, d, t, _dur, _m, v) => {
    membrane(c, d, t, 92, v, 0.32, 1.6, 0.14, 0, 0);
    noiseBurst(c, d, t, 'bandpass', 1300, 0.8, 0.12 * v, 0.002, 0.05);
  },
  gong: (c, d, t, _dur, m, v) => struck(c, d, t, midiToFrequency(m), v, 0.22, 1.41, 3.2, 1.6, 3.2, 0.03),
  anvil: (c, d, t, _dur, m, v) => struck(c, d, t, midiToFrequency(m), v, 0.06, 2.76, 3.5, 0.15, 0.3),
  shaker: (c, d, t, _dur, _m, v) => noiseBurst(c, d, t, 'highpass', 6000, 0.7, 0.06 * v, 0.008, 0.035),
  wood: (c, d, t, _dur, _m, v) => {
    membrane(c, d, t, 1150, v, 0.1, 1.2, 0.03, 0, 0);
    noiseBurst(c, d, t, 'bandpass', 2600, 2, 0.05 * v, 0.001, 0.012);
  },
};

export function playVoice(core: AudioCore, inst: Instrument, dest: AudioNode, t: number, dur: number, midi: number, vel: number, opts: VoiceOptions): void {
  VOICES[inst](core, dest, t, dur, midi, vel, opts);
}
