import { PERCUSSION, type Instrument, type Layer, type Role, type SectionKind, type Theme } from './themes.ts';
import { chordDegrees, degreeToMidi, parseMelody, Rng, SCALES, type ScaleName } from './theory.ts';

export interface NoteEvent {
  /** Beats from the start of the bar. */
  at: number;
  beats: number;
  midi: number;
  /** Loudness 0..1 before the layer volume. */
  vel: number;
  inst: Instrument;
  role: Role;
  pan: number;
}

export interface PieceSection {
  kind: SectionKind;
  bars: number;
  /** 0 plays the phrase as written; higher numbers vary it more. */
  variation: number;
}

interface PhraseNote {
  start: number;
  beats: number;
  degree: number;
  accidental: number;
}

const DEFAULT_SECTIONS: Record<Role, SectionKind[]> = {
  drone: ['intro', 'a', 'b', 'breath', 'outro'],
  pad: ['intro', 'a', 'b', 'breath', 'outro'],
  bass: ['a', 'b', 'breath'],
  arp: ['a', 'b', 'breath'],
  melody: ['a', 'b', 'breath'],
  counter: ['b'],
  bells: ['breath', 'b'],
  perc: ['a', 'b'],
};

const ALL_SECTIONS: SectionKind[] = ['intro', 'a', 'b', 'breath', 'outro'];

const DEFAULT_PAN: Record<Role, number> = {
  drone: 0,
  pad: 0,
  bass: -0.05,
  arp: 0.3,
  melody: 0.05,
  counter: -0.3,
  bells: -0.35,
  perc: 0.12,
};

/** Comfortable MIDI range of each instrument; notes outside move by octaves. */
export const RANGES: Record<Instrument, [number, number]> = {
  strings: [40, 88],
  choir: [45, 79],
  ooh: [40, 74],
  voice: [57, 84],
  organ: [36, 84],
  harp: [40, 96],
  lute: [43, 79],
  flute: [60, 93],
  whistle: [67, 96],
  reed: [50, 84],
  horn: [41, 77],
  brass: [36, 72],
  bell: [55, 96],
  celesta: [60, 100],
  glass: [60, 100],
  cello: [36, 69],
  drone: [26, 57],
  drum: [24, 60],
  timpani: [33, 57],
  frame: [40, 90],
  gong: [24, 60],
  anvil: [60, 96],
  shaker: [60, 96],
  wood: [60, 96],
};

export function fitRange(midi: number, inst: Instrument): number {
  const [low, high] = RANGES[inst];
  let m = midi;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return m < low ? midi : m;
}

const STEP_VELOCITY: Record<string, number> = { X: 1, x: 0.8, o: 0.45 };

export function secondsPerBar(theme: Pick<Theme, 'bpm' | 'meter'>): number {
  return (theme.meter * 60) / theme.bpm;
}

/**
 * Sections of one piece: the motif, its answer, a breath where the melody
 * only echoes, and variations. Only a theme's first piece has an intro, and
 * pieces follow each other without a pause.
 */
export function planPiece(theme: Theme, rng: Rng, first = true): PieceSection[] {
  const p = theme.chords.length;
  const half = Math.max(2, Math.round(p / 2));
  const s = (kind: SectionKind, bars: number, variation = 0): PieceSection => ({ kind, bars, variation });
  const templates: PieceSection[][] = [
    [s('a', p), s('b', p), s('a', p, 1), s('breath', half), s('b', p, 1), s('a', p, 2)],
    [s('a', p), s('a', p, 1), s('b', p), s('breath', half), s('a', p, 2)],
    [s('a', p), s('b', p), s('breath', half), s('a', p, 1), s('b', p, 1)],
  ];
  const piece = rng.pick(templates);
  const intro = theme.intro ?? 1;
  return first && intro > 0 ? [s('intro', intro), ...piece] : piece;
}

function phraseFromText(text: string): PhraseNote[] {
  const notes: PhraseNote[] = [];
  let start = 0;
  for (const note of parseMelody(text)) {
    if (note.degree !== null) notes.push({ start, beats: note.beats, degree: note.degree, accidental: note.accidental });
    start += note.beats;
  }
  return notes;
}

function patternFor(layer: Layer, meter: number): string {
  if (layer.pattern) return layer.pattern;
  if (layer.role === 'bass') return meter % 3 === 0 && meter > 3 ? 'x..o..' : meter === 3 ? 'x..' : 'x...o...';
  return meter % 3 === 0 ? 'x.o.o.' : 'x.o.x.o.';
}

/**
 * Generates the notes of a theme bar by bar. Each piece states the motif,
 * answers it and varies it, with a seeded random source so a piece is
 * reproducible but no two pieces are quite alike.
 */
export class Composer {
  readonly theme: Theme;
  private readonly rng: Rng;
  private readonly scale: readonly number[];
  private readonly motif: PhraseNote[];
  private readonly answer: PhraseNote[] | null;
  private readonly cache = new Map<string, PhraseNote[]>();
  private padVoicing: number[] = [];
  private counterPitch = 0;
  private arpIndex = 0;

  constructor(theme: Theme, seed: number) {
    this.theme = theme;
    this.rng = new Rng(seed);
    this.scale = SCALES[theme.scale];
    this.motif = phraseFromText(theme.motif);
    this.answer = theme.answer ? phraseFromText(theme.answer) : null;
  }

  /** The next piece; only the first has an intro. */
  plan(first = false): PieceSection[] {
    return planPiece(this.theme, this.rng, first);
  }

  /** Chord degree for a bar of a section. */
  chordAt(section: PieceSection, bar: number): number {
    if (section.kind === 'intro' || section.kind === 'outro') return this.theme.chords[0];
    return this.theme.chords[bar % this.theme.chords.length];
  }

  bar(section: PieceSection, bar: number, globalBar: number, intensity: number): NoteEvent[] {
    const events: NoteEvent[] = [];
    const chord = this.chordAt(section, bar);
    for (const layer of this.theme.layers) {
      if (!this.active(layer, section.kind, intensity, globalBar)) continue;
      const before = events.length;
      switch (layer.role) {
        case 'drone':
          if (bar === 0) this.drone(events, layer, section);
          break;
        case 'pad':
          this.pad(events, layer, section, bar, chord);
          break;
        case 'bass':
          this.bass(events, layer, chord);
          break;
        case 'arp':
          this.arp(events, layer, chord, intensity);
          break;
        case 'melody':
          this.melody(events, layer, section, bar, chord);
          break;
        case 'counter':
          this.counter(events, layer, chord);
          break;
        case 'bells':
          this.bells(events, layer, chord);
          break;
        case 'perc':
          this.perc(events, layer, intensity);
          break;
      }
      const vol = layer.vol ?? 1;
      const pan = layer.pan ?? DEFAULT_PAN[layer.role];
      for (let i = before; i < events.length; i++) {
        const e = events[i];
        e.vel = Math.max(0.05, Math.min(1, e.vel * vol * (0.94 + this.rng.next() * 0.12)));
        e.pan = pan;
        if (!PERCUSSION.has(e.inst)) e.midi = fitRange(e.midi, e.inst);
      }
    }
    return events.sort((a, b) => a.at - b.at);
  }

  private active(layer: Layer, section: SectionKind, intensity: number, globalBar: number): boolean {
    const sections = layer.in ?? (layer.from !== undefined ? ALL_SECTIONS : DEFAULT_SECTIONS[layer.role]);
    if (!sections.includes(section)) return false;
    if (layer.from !== undefined && intensity < layer.from) return false;
    if (layer.below !== undefined && intensity >= layer.below) return false;
    if (layer.every && globalBar % layer.every !== 0) return false;
    return true;
  }

  private midi(degree: number, octave = 0, accidental = 0): number {
    return degreeToMidi(this.theme.root + 12 * octave, this.scale, degree, accidental);
  }

  private chordPcs(chord: number): number[] {
    return chordDegrees(chord, this.theme.voicing).map((d) => ((this.midi(d) % 12) + 12) % 12);
  }

  /** The chord without added sevenths and ninths, which a melody may rub against. */
  corePcs(chord: number): number[] {
    const voicing = this.theme.voicing === 'add9' || this.theme.voicing === 'seventh' ? 'triad' : this.theme.voicing;
    return chordDegrees(chord, voicing).map((d) => ((this.midi(d) % 12) + 12) % 12);
  }

  private drone(events: NoteEvent[], layer: Layer, section: PieceSection): void {
    const beats = section.bars * this.theme.meter;
    const root = this.theme.root + 12 * (layer.octave ?? 0);
    events.push(this.note(0, beats, root, 0.6, layer.inst, 'drone'));
    if (this.scale.includes(7)) events.push(this.note(0, beats, root + 7, 0.45, layer.inst, 'drone'));
  }

  private pad(events: NoteEvent[], layer: Layer, section: PieceSection, bar: number, chord: number): void {
    if (bar > 0 && this.chordAt(section, bar - 1) === chord) return;
    let run = 1;
    while (bar + run < section.bars && this.chordAt(section, bar + run) === chord) run++;
    const centre = this.theme.root + 12 * (layer.octave ?? 0) + 7;
    const pcs = this.chordPcs(chord);
    const voicing = pickVoicing(pcs, this.padVoicing, centre);
    this.padVoicing = voicing;
    const beats = run * this.theme.meter + 0.25;
    for (const midi of voicing) events.push(this.note(0, beats, midi, 0.6, layer.inst, 'pad'));
  }

  private bass(events: NoteEvent[], layer: Layer, chord: number): void {
    const base = this.theme.root + 12 * (layer.octave ?? 0);
    let root = this.midi(chord, layer.octave ?? 0);
    while (root > base + 6) root -= 12;
    while (root < base - 5) root += 12;
    const fifth = this.midi(chord + 4, layer.octave ?? 0) - this.midi(chord, layer.octave ?? 0) + root;
    this.stepped(events, patternFor(layer, this.theme.meter), layer, (char) => (char === 'o' ? fifth : root), 'bass');
  }

  private arp(events: NoteEvent[], layer: Layer, chord: number, intensity: number): void {
    const degrees = chordDegrees(chord, this.theme.voicing === 'open' ? 'triad' : this.theme.voicing);
    const pitches = [...degrees, ...degrees.map((d) => d + this.scale.length)].map((d) => this.midi(d, layer.octave ?? 0));
    const order = layer.order ?? 'up';
    const density = Math.min(1, (layer.density ?? 1) * (intensity > 0.6 ? 1.2 : 1));
    const pattern = patternFor(layer, this.theme.meter);
    const steps = pattern.length;
    const stepBeats = this.theme.meter / steps;
    for (let i = 0; i < steps; i++) {
      const char = pattern[i];
      const vel = STEP_VELOCITY[char];
      if (!vel || (char !== 'X' && !this.rng.chance(density))) continue;
      let index: number;
      if (order === 'random') index = this.rng.int(0, pitches.length - 1);
      else {
        const cycle = order === 'updown' ? pitches.length * 2 - 2 : pitches.length;
        const k = this.arpIndex++ % Math.max(1, cycle);
        index = order === 'down' ? pitches.length - 1 - k : order === 'updown' && k >= pitches.length ? cycle - k : k;
      }
      events.push(this.note(this.swung(i, stepBeats), stepBeats * 2.5, pitches[index], vel * 0.8, layer.inst, 'arp'));
    }
  }

  private melody(events: NoteEvent[], layer: Layer, section: PieceSection, bar: number, chord: number): void {
    const phrase = this.phraseFor(section);
    const meter = this.theme.meter;
    const from = bar * meter;
    const delay = layer.delay ?? 0;
    const pcs = this.corePcs(chord);
    for (const n of phrase) {
      const start = n.start + delay;
      if (start < from || start >= from + meter) continue;
      const at = start - from;
      const strong = at === 0 || (meter >= 4 && at === meter / 2) || n.beats >= meter / 2;
      const degree = strong ? this.snap(n.degree, n.accidental, pcs) : n.degree;
      const accent = at === 0 ? 0.1 : 0;
      const echo = section.kind === 'breath' ? 0.7 : 1;
      events.push(this.note(at, n.beats, this.midi(degree, layer.octave ?? 0, n.accidental), (0.72 + accent) * echo, layer.inst, 'melody'));
    }
  }

  private counter(events: NoteEvent[], layer: Layer, chord: number): void {
    const meter = this.theme.meter;
    const parts = meter % 3 === 0 ? meter / 3 : 2;
    const length = meter / parts;
    const pcs = this.chordPcs(chord).slice(1);
    const centre = this.theme.root + 12 * (layer.octave ?? 0) + 4;
    for (let i = 0; i < parts; i++) {
      const target = this.counterPitch || centre;
      let best = target;
      let bestDistance = Infinity;
      for (let m = centre - 7; m <= centre + 9; m++) {
        if (!pcs.includes(((m % 12) + 12) % 12)) continue;
        const d = Math.abs(m - target) + (m === target ? 1.5 : 0);
        if (d < bestDistance) {
          bestDistance = d;
          best = m;
        }
      }
      this.counterPitch = best;
      events.push(this.note(i * length, length, best, 0.5, layer.inst, 'counter'));
    }
  }

  private bells(events: NoteEvent[], layer: Layer, chord: number): void {
    const degrees = chordDegrees(chord, this.theme.voicing);
    let placed = 0;
    for (let beat = 0; beat < this.theme.meter && placed < 2; beat++) {
      if (!this.rng.chance((layer.density ?? 0.3) * 0.5)) continue;
      const offset = this.rng.chance(0.3) ? 0.5 : 0;
      const degree = this.rng.pick(degrees) + (this.rng.chance(0.3) ? this.scale.length : 0);
      events.push(this.note(beat + offset, 2, this.midi(degree, layer.octave ?? 0), 0.5 + this.rng.next() * 0.25, layer.inst, 'bells'));
      placed++;
    }
  }

  private perc(events: NoteEvent[], layer: Layer, intensity: number): void {
    const root = this.theme.root + 12 * (layer.octave ?? 0);
    const fifth = root + 7;
    const lift = 0.9 + Math.min(0.25, intensity * 0.25);
    this.stepped(events, layer.pattern ?? 'x...', layer, (char) => (char === 'o' && layer.inst === 'timpani' ? fifth : root), 'perc', lift);
  }

  private stepped(events: NoteEvent[], pattern: string, layer: Layer, pitch: (char: string) => number, role: Role, lift = 1): void {
    const steps = pattern.length;
    const stepBeats = this.theme.meter / steps;
    const hits: number[] = [];
    for (let i = 0; i < steps; i++) if (STEP_VELOCITY[pattern[i]]) hits.push(i);
    for (let h = 0; h < hits.length; h++) {
      const i = hits[h];
      const char = pattern[i];
      if (char !== 'X' && layer.density !== undefined && !this.rng.chance(layer.density)) continue;
      const next = h + 1 < hits.length ? hits[h + 1] : steps;
      const beats = role === 'perc' ? stepBeats : (next - i) * stepBeats;
      events.push(this.note(this.swung(i, stepBeats), beats, pitch(char), STEP_VELOCITY[char] * lift, layer.inst, role));
    }
  }

  private swung(step: number, stepBeats: number): number {
    return step * stepBeats + (step % 2 === 1 ? (this.theme.swing ?? 0) * stepBeats : 0);
  }

  /** Moves a degree that clashes by a semitone with the chord onto the nearest chord tone. */
  private snap(degree: number, accidental: number, pcs: readonly number[]): number {
    const clashes = (d: number) => {
      const pc = ((this.midi(d, 0, accidental) % 12) + 12) % 12;
      return pcs.some((c) => {
        const interval = Math.abs(c - pc) % 12;
        return interval === 1 || interval === 11;
      });
    };
    if (!clashes(degree)) return degree;
    for (const step of [-1, 1, -2, 2]) {
      const d = degree + step;
      const pc = ((this.midi(d, 0, accidental) % 12) + 12) % 12;
      if (pcs.includes(pc)) return d;
    }
    return degree;
  }

  private phraseFor(section: PieceSection): PhraseNote[] {
    const key = `${section.kind}:${section.variation}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    let phrase: PhraseNote[] = [];
    if (section.kind === 'a') {
      phrase = section.variation === 0 ? this.motif : section.variation === 1 ? this.ornament(this.motif) : this.lift(this.motif);
    } else if (section.kind === 'b') {
      const base = this.answer ?? this.transpose(this.motif, 2);
      phrase = section.variation === 0 ? base : this.rng.chance(0.5) ? this.improvise(base) : this.ornament(base);
    } else if (section.kind === 'breath') {
      phrase = this.echo(section.bars);
    }
    this.cache.set(key, phrase);
    return phrase;
  }

  /** The motif's opening bar, heard on every other bar of a breath. */
  private echo(bars: number): PhraseNote[] {
    const meter = this.theme.meter;
    const opening = this.motif.filter((n) => n.start < meter);
    const result: PhraseNote[] = [];
    for (let bar = 0; bar < bars; bar += 2) {
      for (const n of opening) result.push({ ...n, start: n.start + bar * meter, beats: Math.min(n.beats, meter - n.start) });
    }
    return result;
  }

  private ornament(phrase: readonly PhraseNote[]): PhraseNote[] {
    const result: PhraseNote[] = [];
    for (let i = 0; i < phrase.length; i++) {
      const n = phrase[i];
      const next = phrase[i + 1];
      if (next && n.beats >= 1 && Math.abs(next.degree - n.degree) === 2 && next.start === n.start + n.beats && this.rng.chance(0.55)) {
        result.push({ ...n, beats: n.beats - 0.5 });
        result.push({ start: n.start + n.beats - 0.5, beats: 0.5, degree: (n.degree + next.degree) / 2, accidental: 0 });
      } else {
        result.push(n);
      }
    }
    return result;
  }

  private lift(phrase: readonly PhraseNote[]): PhraseNote[] {
    const top = Math.max(...phrase.map((n) => n.degree));
    return top + this.scale.length <= this.scale.length * 2 + 2 ? this.transpose(phrase, this.scale.length) : this.ornament(phrase);
  }

  private transpose(phrase: readonly PhraseNote[], degrees: number): PhraseNote[] {
    return phrase.map((n) => ({ ...n, degree: n.degree + degrees }));
  }

  /** A new line in the rhythm of the phrase: mostly steps, a few leaps, ending where the phrase ends. */
  private improvise(phrase: readonly PhraseNote[]): PhraseNote[] {
    if (!phrase.length) return [];
    const low = Math.min(...phrase.map((n) => n.degree));
    const high = Math.max(...phrase.map((n) => n.degree));
    let degree = phrase[0].degree;
    return phrase.map((n, i) => {
      if (i === 0 || i === phrase.length - 1) return { ...n, accidental: 0 };
      const leap = this.rng.chance(0.25);
      const step = (leap ? this.rng.int(2, 3) : 1) * (this.rng.chance(0.5) ? 1 : -1);
      degree = Math.max(low - 1, Math.min(high + 1, degree + step));
      return { ...n, degree, accidental: 0 };
    });
  }

  private note(at: number, beats: number, midi: number, vel: number, inst: Instrument, role: Role): NoteEvent {
    return { at, beats, midi, vel, inst, role, pan: 0 };
  }
}

/** Places chord tones near the previous voicing so pads move smoothly. */
export function pickVoicing(pcs: readonly number[], previous: readonly number[], centre: number): number[] {
  const anchors = previous.length ? previous : [centre];
  const chosen = new Set<number>();
  for (const pc of pcs) {
    let best = -1;
    let bestDistance = Infinity;
    for (let m = centre - 10; m <= centre + 10; m++) {
      if (((m % 12) + 12) % 12 !== pc || chosen.has(m)) continue;
      const distance = Math.min(...anchors.map((a) => Math.abs(m - a))) + Math.abs(m - centre) * 0.3;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = m;
      }
    }
    if (best >= 0) chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b);
}

export type TransitionKind = 'dominant' | 'plagal' | 'common' | 'minorPlagal' | 'veiled';

export interface Pivot {
  kind: TransitionKind;
  /** Chord tones (MIDI) around the middle of the new theme's range. */
  chord: number[];
  bass: number;
  /** How present the pivot is: 1 sounds in full, lower values are quieter and sparser. */
  weight: number;
}

type Shade = Pick<Theme, 'root' | 'scale' | 'bpm' | 'meter' | 'bright'>;

const PLAGAL_SCALES: ReadonlySet<string> = new Set(['ionian', 'mixolydian', 'pentatonic']);
const COMMON_SCALES: ReadonlySet<string> = new Set(['lydian', 'wholeTone', 'hirajoshi']);

/** How dark each mode sounds, 0 (bright) .. 1 (darkest). */
const SCALE_SHADE: Record<ScaleName, number> = {
  lydian: 0,
  ionian: 0.1,
  pentatonic: 0.1,
  mixolydian: 0.2,
  dorian: 0.4,
  wholeTone: 0.5,
  minorPentatonic: 0.5,
  aeolian: 0.65,
  hirajoshi: 0.65,
  phrygianDominant: 0.7,
  harmonicMinor: 0.75,
  phrygian: 0.8,
  hungarianMinor: 0.85,
  locrian: 1,
};

/** Beats per minute counted in quarter notes (6-beat bars count eighths). */
export function quarterTempo(theme: Pick<Theme, 'bpm' | 'meter'>): number {
  return theme.meter % 3 === 0 && theme.meter > 3 ? theme.bpm / 2 : theme.bpm;
}

/** How sombre a theme sounds from its mode, tempo and tone: 0 (bright, lively) .. 1 (dark, slow, muffled). */
export function sombreness(theme: Pick<Theme, 'scale' | 'bpm' | 'meter' | 'bright'>): number {
  const slow = Math.max(0, Math.min(1, (100 - quarterTempo(theme)) / 50));
  const dim = Math.max(0, Math.min(1, (0.8 - (theme.bright ?? 0.7)) / 0.45));
  return Math.min(1, SCALE_SHADE[theme.scale] * 0.5 + slow * 0.3 + dim * 0.2);
}

/** Sombreness at or above which a transition only hints at the new key. */
const VEILED_FROM = 0.6;
/** Sombreness of a dark key at or above which it is reached through its minor subdominant. */
const MINOR_PLAGAL_FROM = 0.45;

/**
 * How music moves into a theme: bright places are reached through their
 * subdominant (IV → I, warm and settled), dreamlike ones through a chord
 * that keeps the previous tonic as a common tone, sombre ones through
 * their minor subdominant (iv → i, a soft sigh) or, when either side is
 * very sombre, through a suspended chord without a leading tone that
 * barely hints at the new key; only lively dark keys keep the pull of a
 * dominant seventh (V7 → i).
 */
export function transitionKind(to: Pick<Theme, 'scale' | 'bpm' | 'meter' | 'bright'>, from: Pick<Theme, 'scale' | 'bpm' | 'meter' | 'bright'> | null = null): TransitionKind {
  if (COMMON_SCALES.has(to.scale)) return 'common';
  if (PLAGAL_SCALES.has(to.scale)) return 'plagal';
  const target = sombreness(to);
  if (Math.max(target, from ? sombreness(from) : 0) >= VEILED_FROM) return 'veiled';
  if (target >= MINOR_PLAGAL_FROM) return 'minorPlagal';
  return 'dominant';
}

/** The chord that leads from one theme's key into the next. */
export function pivotChord(from: Shade | null, to: Shade): Pivot {
  const scale = SCALES[to.scale];
  let kind = transitionKind(to, from);
  let intervals: number[] = [];
  let bass = 0;
  if (kind === 'common') {
    const fromPc = from ? ((from.root % 12) + 12) % 12 : null;
    const degree = [3, 5, 1, 4, 2, 6]
      .filter((d) => d < scale.length)
      .find((d) => fromPc !== null && chordDegrees(d).some((x) => ((degreeToMidi(to.root, scale, x) % 12) + 12) % 12 === fromPc));
    if (degree === undefined) kind = 'plagal';
    else {
      intervals = chordDegrees(degree).map((x) => degreeToMidi(0, scale, x));
      bass = degreeToMidi(0, scale, degree);
    }
  }
  if (kind === 'plagal') {
    intervals = [5, 9, 12];
    bass = 5;
  } else if (kind === 'minorPlagal') {
    intervals = [5, 8, 12];
    bass = 5;
  } else if (kind === 'veiled') {
    intervals = [7, 12, 14];
    bass = 7;
  } else if (kind === 'dominant') {
    intervals = [7, 11, 17];
    bass = 7;
  }
  const chord = pickVoicing(
    intervals.map((i) => (to.root + i) % 12),
    [],
    to.root + 7,
  );
  let low = to.root + bass - 12;
  while (low > 52) low -= 12;
  while (low < 36) low += 12;
  const gloom = Math.max(sombreness(to), from ? sombreness(from) : 0);
  return { kind, chord, bass: low, weight: Math.max(0.35, 1 - gloom * 0.75) };
}

/**
 * How much longer than written a bar lasts: with rubato, the intro and
 * breaths broaden and the last bar of a piece slows into the next.
 */
export function barStretch(theme: Pick<Theme, 'rubato'>, section: PieceSection, bar: number, endsPiece: boolean): number {
  const rubato = theme.rubato ?? 0;
  if (rubato <= 0) return 1;
  if (endsPiece && bar === section.bars - 1) return 1 + rubato * 1.5;
  if (section.kind === 'breath') return 1 + rubato;
  if (section.kind === 'intro') return 1 + rubato * 0.5;
  return 1;
}
