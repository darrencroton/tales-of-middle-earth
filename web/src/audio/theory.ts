/** Scales as semitone offsets from the tonic. */
export const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  hungarianMinor: [0, 2, 3, 6, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
} as const satisfies Record<string, readonly number[]>;

export type ScaleName = keyof typeof SCALES;

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** MIDI note of a scale degree; degrees past the scale length move up or down octaves. */
export function degreeToMidi(root: number, scale: readonly number[], degree: number, accidental = 0): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const index = degree - octave * n;
  return root + octave * 12 + scale[index] + accidental;
}

export type Voicing = 'triad' | 'open' | 'seventh' | 'add9' | 'sus';

/** Scale degrees of a chord built on a degree (stacked thirds within the scale). */
export function chordDegrees(degree: number, voicing: Voicing = 'triad'): number[] {
  switch (voicing) {
    case 'open':
      return [degree, degree + 4];
    case 'seventh':
      return [degree, degree + 2, degree + 4, degree + 6];
    case 'add9':
      return [degree, degree + 2, degree + 4, degree + 8];
    case 'sus':
      return [degree, degree + 1, degree + 4];
    default:
      return [degree, degree + 2, degree + 4];
  }
}

/** Small deterministic random generator (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MelodyNote {
  /** Scale degree, or null for a rest. */
  degree: number | null;
  accidental: number;
  beats: number;
}

/**
 * Parses melody notation: space-separated tokens `degree[#|b][*beats]` or
 * `r[*beats]` for a rest; `|` bar lines are ignored. Example: `0*2 2 4# r*.5`.
 */
export function parseMelody(text: string): MelodyNote[] {
  const notes: MelodyNote[] = [];
  for (const token of text.split(/\s+/)) {
    if (!token || token === '|') continue;
    const match = /^(r|-?\d+)([#b]?)(?:\*(\d*\.?\d+))?$/.exec(token);
    if (!match) throw new Error(`Bad melody token "${token}"`);
    const beats = match[3] ? Number(match[3]) : 1;
    notes.push({
      degree: match[1] === 'r' ? null : Number(match[1]),
      accidental: match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0,
      beats,
    });
  }
  return notes;
}

export function melodyBeats(notes: readonly MelodyNote[]): number {
  return notes.reduce((sum, n) => sum + n.beats, 0);
}

function formatNote(note: MelodyNote): string {
  const pitch = note.degree === null ? 'r' : `${note.degree}${note.accidental > 0 ? '#' : note.accidental < 0 ? 'b' : ''}`;
  return note.beats === 1 ? pitch : `${pitch}*${note.beats}`;
}

/** Applies `change` to each bar of a melody, keeping the bar lines. */
function eachBar(text: string, change: (notes: MelodyNote[]) => MelodyNote[]): string {
  return text
    .split('|')
    .map((bar) => change(parseMelody(bar)).map(formatNote).join(' '))
    .join(' | ');
}

/** Moves a melody by scale degrees. */
export function transposeMelody(text: string, degrees: number): string {
  return eachBar(text, (notes) => notes.map((n) => (n.degree === null ? n : { ...n, degree: n.degree + degrees })));
}

/** Mirrors a melody's contour around a degree. */
export function invertMelody(text: string, axis: number): string {
  return eachBar(text, (notes) => notes.map((n) => (n.degree === null ? n : { ...n, degree: 2 * axis - n.degree, accidental: -n.accidental })));
}

/** Plays a melody `factor` times slower; bar lines are dropped as the bars grow. */
export function augmentMelody(text: string, factor: number): string {
  return parseMelody(text)
    .map((n) => formatNote({ ...n, beats: n.beats * factor }))
    .join(' ');
}

/** Detaches each note of a beat or longer: half the note sounds, the rest is silence. */
export function staccatoMelody(text: string): string {
  return eachBar(text, (notes) =>
    notes.flatMap((n) => (n.degree === null || n.beats < 1 ? [n] : [{ ...n, beats: n.beats / 2 }, { degree: null, accidental: 0, beats: n.beats / 2 }])),
  );
}

/** The first `count` bars of a melody written with bar lines. */
export function melodyBars(text: string, count: number, from = 0): string {
  return text
    .split('|')
    .slice(from, from + count)
    .map((bar) => bar.trim())
    .join(' | ');
}

/** Holds each chord of a progression for `factor` bars. */
export function stretchChords(chords: readonly number[], factor: number): number[] {
  return chords.flatMap((c) => Array.from({ length: factor }, () => c));
}

/** Lengthens each bar of a melody to `beats` with a closing rest. */
export function padBars(text: string, beats: number): string {
  return eachBar(text, (notes) => {
    const missing = beats - melodyBeats(notes);
    return missing > 0 ? [...notes, { degree: null, accidental: 0, beats: missing }] : notes;
  });
}
