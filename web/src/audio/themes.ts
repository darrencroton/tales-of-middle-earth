import type { ScaleName, Voicing } from './theory.ts';

export type Instrument =
  | 'strings'
  | 'choir'
  | 'ooh'
  | 'voice'
  | 'organ'
  | 'harp'
  | 'lute'
  | 'flute'
  | 'whistle'
  | 'reed'
  | 'horn'
  | 'brass'
  | 'bell'
  | 'celesta'
  | 'glass'
  | 'cello'
  | 'drone'
  | 'drum'
  | 'timpani'
  | 'frame'
  | 'gong'
  | 'anvil'
  | 'shaker'
  | 'wood';

export const PERCUSSION: ReadonlySet<Instrument> = new Set(['drum', 'timpani', 'frame', 'gong', 'anvil', 'shaker', 'wood']);

export type Role = 'drone' | 'pad' | 'bass' | 'arp' | 'melody' | 'counter' | 'bells' | 'perc';

export type SectionKind = 'intro' | 'a' | 'b' | 'breath' | 'outro';

export interface Layer {
  role: Role;
  inst: Instrument;
  /** Octave relative to the theme root. */
  octave?: number;
  vol?: number;
  /** Rhythm over one bar (arp, bass, perc): X accent, x normal, o soft, . rest. */
  pattern?: string;
  order?: 'up' | 'down' | 'updown' | 'random';
  /** Chance each note in the pattern plays. */
  density?: number;
  /** Sections the layer plays in; defaults depend on the role. */
  in?: SectionKind[];
  /** Plays only at or above this intensity (0..1). */
  from?: number;
  /** Plays only below this intensity. */
  below?: number;
  /** Plays only on every n-th bar. */
  every?: number;
  pan?: number;
}

export type Ambience =
  | 'wind'
  | 'cave'
  | 'drips'
  | 'fire'
  | 'birds'
  | 'crickets'
  | 'water'
  | 'sea'
  | 'whispers'
  | 'rumble'
  | 'leaves'
  | 'void'
  | 'sand';

export interface Theme {
  id: string;
  /** What the theme is meant to convey. */
  mood: string;
  /** MIDI note of the tonic. */
  root: number;
  scale: ScaleName;
  /** Beats per minute; 6-beat bars count eighth notes. */
  bpm: number;
  /** Beats per bar. */
  meter: number;
  /** Chord (scale degree) for each bar of the progression. */
  chords: number[];
  voicing?: Voicing;
  /** Leitmotif in melody notation, aligned with the start of the progression. */
  motif: string;
  /** Answering phrase for B sections. */
  answer?: string;
  layers: Layer[];
  /** Reverb send 0..1. */
  space: number;
  /** Echo send 0..1. */
  echo?: number;
  /** Tone colour 0 (muffled) .. 1 (bright). */
  bright?: number;
  ambience: [Ambience, number][];
  /** Seconds of quiet between pieces; omitted plays on continuously. */
  gap?: [number, number];
  /** Intensity the music never falls below. */
  floor?: number;
  /** Delays every other step by this fraction of a step. */
  swing?: number;
}

/** Copies a theme with changes; layers in the patch replace the base layers. */
export function variant(base: Theme, id: string, patch: Partial<Omit<Theme, 'id'>>): Theme {
  return { ...base, ...patch, id };
}

/* Leitmotifs shared between related places. */
const TOME_MOTIF = '0 4*2 3*.5 2*.5 | 1*1.5 2*.5 6*2 | 7*1.5 6*.5 4*2 | 5*3 r | 0 4*2 7 | 8*1.5 7*.5 6 4 | 5 6 7*1.5 5*.5 | 7*3 r';
const TOME_ANSWER = 'r 2 4 7 | 6*2 4*2 | 2*1.5 4*.5 7*2 | 7 5 3*2 | 4*3 2 | 1*2 0 1 | 3*1.5 4*.5 5*2 | 4*4';
const DWARF_MOTIF = '0 0*.5 1*.5 2 4 | 3*2 2 1 | 3*1.5 5*.5 4*2 | 0*4';
const DWARF_ANSWER = '4 7 6 4 | 6*2 4*2 | 5 3 1*2 | 0*2 r*2';
const GONDOLIN_MOTIF = '4*2 7 | 8*2 5 | 2*1.5 4*.5 5 | 1*3';
const GONDOLIN_ANSWER = '9 8 7 | 5*2 3 | 4 2 0 | 1*2 r';
const BREE_MOTIF = '4*2 3 2*2 1 | 3*2 1 -1*3 | 0*2 1 3*3 | 2 1 0 0*3';
const BREE_ANSWER = '7*2 6 4*3 | 6*3 5 3*2 | 4*2 2 3*3 | 1*3 4*3';

const THEMES: Theme[] = [
  {
    id: 'title',
    mood: 'The opening of a long tale: heroic, wistful, firelit.',
    root: 50,
    scale: 'dorian',
    bpm: 66,
    meter: 4,
    chords: [0, 6, 2, 3, 0, 4, 3, 0],
    voicing: 'add9',
    motif: TOME_MOTIF,
    answer: TOME_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.5 },
      { role: 'pad', inst: 'strings', vol: 0.7 },
      { role: 'pad', inst: 'choir', octave: 0, vol: 0.45, in: ['breath', 'b', 'outro'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.x.o.', order: 'updown', density: 0.9 },
      { role: 'melody', inst: 'horn', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, vol: 0.9, in: ['b'] },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.3, in: ['breath', 'b'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...', vol: 0.45, every: 2, in: ['a', 'b'] },
    ],
    space: 0.55,
    bright: 0.75,
    ambience: [['fire', 0.3]],
  },
  {
    id: 'overworld',
    mood: 'The road goes ever on: a journey across Middle-earth.',
    root: 50,
    scale: 'dorian',
    bpm: 92,
    meter: 3,
    chords: [0, 6, 3, 0, 2, 6, 3, 4],
    motif: '0 4*2 | 3*.5 2*.5 1*2 | 3 5 7 | 4*3 | 2 4 7 | 6*2 4 | 5*1.5 3*.5 5 | 4*3',
    answer: '7*2 6 | 4*1.5 3*.5 1 | 3*2 5 | 4*3 | 4 2 4 | 6*2 7 | 5 3 1 | 0*3',
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.6 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'up', density: 0.85 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.85, in: ['b'] },
      { role: 'counter', inst: 'strings', octave: 1, vol: 0.5 },
      { role: 'perc', inst: 'frame', pattern: 'x.o.o.', vol: 0.4, density: 0.85, in: ['a', 'b'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.....', vol: 0.5, from: 0.4 },
    ],
    space: 0.45,
    bright: 0.75,
    ambience: [['wind', 0.3]],
    gap: [15, 40],
  },
  {
    id: 'lament',
    mood: 'The tale has ended: grief, and the memory of courage.',
    root: 50,
    scale: 'aeolian',
    bpm: 50,
    meter: 4,
    chords: [0, 6, 2, 3, 0, 4, 3, 0],
    motif: TOME_MOTIF,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.45 },
      { role: 'pad', inst: 'choir', vol: 0.6 },
      { role: 'pad', inst: 'strings', vol: 0.4 },
      { role: 'melody', inst: 'strings', octave: 1, in: ['a', 'b'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.15, in: ['breath', 'outro'] },
    ],
    space: 0.8,
    bright: 0.5,
    ambience: [['wind', 0.25]],
  },

  /* Towns */
  {
    id: 'bree',
    mood: 'Bree: the Prancing Pony, pipe smoke and chatter; homely and safe.',
    root: 55,
    scale: 'mixolydian',
    bpm: 168,
    meter: 6,
    chords: [0, 6, 3, 0, 0, 6, 3, 4],
    motif: BREE_MOTIF,
    answer: BREE_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.5, pattern: 'x..o..' },
      { role: 'arp', inst: 'lute', octave: 0, pattern: 'x.ox.o', order: 'up', density: 0.9 },
      { role: 'melody', inst: 'whistle', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'flute', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x.ox.o', vol: 0.4, density: 0.8, in: ['a', 'b'] },
    ],
    space: 0.3,
    bright: 0.85,
    ambience: [['birds', 0.4], ['fire', 0.1]],
    gap: [20, 45],
    swing: 0.08,
  },
  {
    id: 'gondolin',
    mood: 'Gondolin: the hidden city of the Noldor, white towers and fountains; wonder.',
    root: 52,
    scale: 'lydian',
    bpm: 66,
    meter: 3,
    chords: [0, 1, 5, 4],
    voicing: 'add9',
    motif: GONDOLIN_MOTIF,
    answer: GONDOLIN_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.5 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.4 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.4 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.x.x.', order: 'up', density: 0.9 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'voice', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.35 },
    ],
    space: 0.65,
    bright: 0.95,
    ambience: [['water', 0.3], ['birds', 0.25]],
    gap: [20, 45],
  },
  {
    id: 'minas-anor',
    mood: 'Minas Anor: the stone city of Gondor; stoic pride and watchfulness.',
    root: 48,
    scale: 'dorian',
    bpm: 76,
    meter: 4,
    chords: [0, 6, 2, 3],
    motif: '0*2 4*1.5 3*.5 | 3 6*2 5 | 4*1.5 2*.5 6*2 | 5*3 r',
    answer: '7*2 6 4 | 3*1.5 4*.5 5 6 | 4*2 2*2 | 3 1 0*2',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.55 },
      { role: 'pad', inst: 'brass', vol: 0.25, in: ['b'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55 },
      { role: 'melody', inst: 'horn', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..o', vol: 0.5, in: ['a', 'b'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.2, in: ['breath'] },
    ],
    space: 0.5,
    bright: 0.75,
    ambience: [['wind', 0.2]],
    gap: [20, 45],
  },
  {
    id: 'lorien',
    mood: 'Lothlórien: the golden wood where time stands still; Galadriel’s light.',
    root: 57,
    scale: 'lydian',
    bpm: 52,
    meter: 3,
    chords: [0, 1, 5, 0],
    voicing: 'add9',
    motif: '4*3 | 3 1*2 | 2*1.5 1*.5 5 | 2*3',
    answer: '7 9*2 | 8*1.5 6*.5 5 | 4*2 2 | 4*3',
    layers: [
      { role: 'pad', inst: 'choir', vol: 0.7 },
      { role: 'pad', inst: 'glass', octave: 1, vol: 0.3 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'updown', density: 0.6 },
      { role: 'melody', inst: 'voice', octave: 1, in: ['a', 'b'] },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.3 },
    ],
    space: 0.8,
    bright: 0.8,
    ambience: [['leaves', 0.3], ['birds', 0.2]],
    gap: [25, 50],
  },
  {
    id: 'khazad',
    mood: 'Khazad-dûm: dwarven halls, forges and deep-voiced pride.',
    root: 38,
    scale: 'dorian',
    bpm: 72,
    meter: 4,
    chords: [0, 6, 3, 0],
    voicing: 'open',
    motif: DWARF_MOTIF,
    answer: DWARF_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.5 },
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.55 },
      { role: 'bass', inst: 'cello', vol: 0.55 },
      { role: 'melody', inst: 'brass', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'horn', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'drum', pattern: 'x...o...', vol: 0.55, in: ['a', 'b'] },
      { role: 'perc', inst: 'anvil', pattern: '......x.', vol: 0.25, density: 0.5, every: 2 },
    ],
    space: 0.75,
    bright: 0.6,
    ambience: [['cave', 0.35], ['fire', 0.2]],
    gap: [20, 45],
  },
  {
    id: 'haven',
    mood: 'A refuge in the deep: warmth, a hearth, a moment to breathe.',
    root: 53,
    scale: 'ionian',
    bpm: 60,
    meter: 3,
    chords: [0, 3, 4, 0],
    motif: '2*2 4 | 3*1.5 5*.5 7 | 4*2 6 | 7*3',
    answer: '9*2 8 | 7*1.5 5*.5 3 | 6*2 4 | 2*3',
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.55 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.45 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'up', density: 0.8 },
      { role: 'melody', inst: 'flute', octave: 1 },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.25, in: ['breath'] },
    ],
    space: 0.45,
    bright: 0.7,
    ambience: [['fire', 0.3]],
    gap: [25, 50],
  },

  /* Wilderness */
  {
    id: 'plains',
    mood: 'Open grassland under a wide sky: freedom and the pull of the road.',
    root: 55,
    scale: 'ionian',
    bpm: 84,
    meter: 3,
    chords: [0, 3, 0, 4],
    motif: '4 7*2 | 5*1.5 4*.5 3 | 2 4 7 | 8*2 r',
    answer: '9*1.5 8*.5 7 | 7 5 3 | 4*1.5 2*.5 4 | 1*3',
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.5 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.45 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'up', density: 0.75 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b'] },
    ],
    space: 0.4,
    bright: 0.8,
    ambience: [['wind', 0.25], ['birds', 0.4]],
    gap: [30, 70],
  },
  {
    id: 'forest',
    mood: 'Old woods: dappled light, birdsong and the sense of being watched.',
    root: 52,
    scale: 'dorian',
    bpm: 150,
    meter: 6,
    chords: [0, 3, 6, 0],
    motif: '4*3 2*2 1 | 3*2 4 5*3 | 6*3 4*2 3 | 4*6',
    answer: '7*2 6 4*3 | 5*3 3*3 | 4*2 6 8*3 | 7*6',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.3 },
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'random', density: 0.7 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b'] },
    ],
    space: 0.5,
    bright: 0.65,
    ambience: [['leaves', 0.4], ['birds', 0.35]],
    gap: [30, 70],
  },
  {
    id: 'mountains',
    mood: 'High passes and cold stone: majesty, distance, echoing horns.',
    root: 50,
    scale: 'aeolian',
    bpm: 60,
    meter: 4,
    chords: [0, 5, 6, 0],
    voicing: 'sus',
    motif: '0 4*3 | 3 5*3 | 6*1.5 4*.5 3*2 | 4*4',
    answer: '7*2 9*2 | 9 7 5*2 | 6*2 8*2 | 7*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.55 },
      { role: 'melody', inst: 'horn', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...', vol: 0.4, every: 2, in: ['a', 'b'] },
    ],
    space: 0.65,
    echo: 0.3,
    bright: 0.65,
    ambience: [['wind', 0.55]],
    gap: [30, 70],
  },
  {
    id: 'marsh',
    mood: 'Fens and mist: murk underfoot and slow, uneasy water.',
    root: 47,
    scale: 'phrygian',
    bpm: 54,
    meter: 4,
    chords: [0, 1, 0, 6],
    motif: '0*2 1 0 | 1*3 3 | 2*1.5 1*.5 0*2 | -1*4',
    answer: '4*2 5 4 | 3 1 3*2 | 2 0 2*2 | 6*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.4 },
      { role: 'arp', inst: 'harp', octave: 0, pattern: 'x...o...', order: 'random', density: 0.5 },
      { role: 'melody', inst: 'reed', octave: 1 },
    ],
    space: 0.55,
    bright: 0.45,
    ambience: [['water', 0.35], ['crickets', 0.25], ['drips', 0.2]],
    gap: [30, 70],
  },
  {
    id: 'desert',
    mood: 'Sun-baked sands: heat shimmer, emptiness, a far-off caravan.',
    root: 52,
    scale: 'phrygianDominant',
    bpm: 76,
    meter: 4,
    chords: [0, 1, 0, 6],
    motif: '0 1*.5 2*.5 3 2 | 1*2 0 1 | 2*1.5 1*.5 0*2 | 6*1.5 5*.5 3*2',
    answer: '4*2 5 4 | 5*1.5 4*.5 3 2 | 2*2 1 0 | 1*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'melody', inst: 'lute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'flute', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x.ox..o.', vol: 0.4, density: 0.85, in: ['a', 'b'] },
    ],
    space: 0.35,
    bright: 0.75,
    ambience: [['wind', 0.4], ['sand', 0.25]],
    gap: [30, 70],
  },
  {
    id: 'ice',
    mood: 'Ice fields: glassy stillness and a wind that cuts.',
    root: 54,
    scale: 'wholeTone',
    bpm: 50,
    meter: 3,
    chords: [0, 1, 0, 5],
    motif: '3*3 | 2 4*2 | 3*3 | 1*3',
    answer: '6*3 | 5 4*2 | 3*2 2 | 0*3',
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.5 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.3, in: ['b', 'breath'] },
      { role: 'melody', inst: 'celesta', octave: 1 },
      { role: 'bells', inst: 'glass', octave: 2, density: 0.25 },
    ],
    space: 0.85,
    bright: 0.75,
    ambience: [['wind', 0.65]],
    gap: [35, 80],
  },
  {
    id: 'coast',
    mood: 'Grey shores of the Sundering Sea: longing for lands beyond the West.',
    root: 57,
    scale: 'ionian',
    bpm: 60,
    meter: 3,
    chords: [0, 3, 5, 4],
    motif: '4*2 2 | 3 5*2 | 5*1.5 4*.5 2 | 1*3',
    answer: '7*2 9 | 8*1.5 7*.5 5 | 4*2 2 | 4*3',
    layers: [
      { role: 'pad', inst: 'choir', vol: 0.55 },
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'updown', density: 0.7 },
      { role: 'melody', inst: 'voice', octave: 1 },
    ],
    space: 0.7,
    bright: 0.7,
    ambience: [['sea', 0.55], ['wind', 0.15]],
    gap: [30, 70],
  },
  {
    id: 'ashlands',
    mood: 'Blasted lands near the Enemy: ash, dread and distant drums.',
    root: 48,
    scale: 'phrygian',
    bpm: 56,
    meter: 4,
    chords: [0, 1, 0, 1],
    voicing: 'open',
    motif: '0*3 1 | 0*4 | 3*2 2 1 | 0*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.55 },
      { role: 'pad', inst: 'brass', vol: 0.25 },
      { role: 'melody', inst: 'brass', octave: 0, vol: 0.8 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.......', vol: 0.4 },
    ],
    space: 0.6,
    bright: 0.45,
    ambience: [['wind', 0.5], ['rumble', 0.3]],
    gap: [25, 60],
  },

  /* Dungeons */
  {
    id: 'depths',
    mood: 'Unknown passages under the earth: caution, curiosity, cold air.',
    root: 45,
    scale: 'aeolian',
    bpm: 56,
    meter: 4,
    chords: [0, 5, 3, 4],
    motif: '4*3 2 | 0*2 r*2 | 3*1.5 2*.5 1*2 | 4*4',
    answer: '7*2 6*2 | 5*3 r | 3*2 5*2 | 4*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.5 },
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x...o...', order: 'random', density: 0.45 },
      { role: 'melody', inst: 'cello', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.12 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...', vol: 0.45, from: 0.45 },
      { role: 'perc', inst: 'frame', pattern: '..o...o.', vol: 0.3, from: 0.65 },
    ],
    space: 0.7,
    bright: 0.5,
    ambience: [['cave', 0.45], ['drips', 0.35]],
    gap: [30, 75],
  },
  {
    id: 'mirkwood',
    mood: 'Mirkwood: smothering dark trees and webs; something skitters overhead.',
    root: 52,
    scale: 'phrygian',
    bpm: 132,
    meter: 6,
    chords: [0, 1, 0, 6],
    motif: '7 6 7 4*3 | 5*2 3 1*3 | 2*3 4*3 | 3*3 6*3',
    answer: '0 1 2 4*3 | 5*3 3*3 | 4 2 0 2*3 | 1*6',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.45 },
      { role: 'pad', inst: 'strings', vol: 0.4 },
      { role: 'arp', inst: 'harp', octave: 2, pattern: 'x.x.x.', order: 'random', density: 0.55, vol: 0.7 },
      { role: 'melody', inst: 'flute', octave: 0, in: ['a'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x..o..', vol: 0.35, from: 0.45 },
    ],
    space: 0.55,
    bright: 0.5,
    ambience: [['leaves', 0.35], ['crickets', 0.2], ['whispers', 0.1]],
    gap: [30, 70],
  },
  {
    id: 'mordor',
    mood: 'Mordor: the land of shadow; forges, marching feet, an eye that watches.',
    root: 48,
    scale: 'phrygian',
    bpm: 66,
    meter: 4,
    chords: [0, 1, 6, 0],
    voicing: 'open',
    motif: '0*1.5 0*.5 1*2 | 0 1 3*2 | 3*2 1*2 | 0*4',
    answer: '4*2 5 4 | 5*3 4 | 3*2 1*2 | 0*2 r*2',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.55 },
      { role: 'pad', inst: 'brass', vol: 0.3 },
      { role: 'pad', inst: 'ooh', octave: 0, vol: 0.4, in: ['b', 'breath'] },
      { role: 'melody', inst: 'brass', octave: 0 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.......', vol: 0.5 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x..x..x.', vol: 0.5, from: 0.45 },
      { role: 'perc', inst: 'anvil', pattern: '....x...', vol: 0.2, density: 0.4, from: 0.3 },
    ],
    space: 0.6,
    bright: 0.5,
    ambience: [['wind', 0.3], ['rumble', 0.35], ['fire', 0.15]],
    gap: [25, 60],
  },
  {
    id: 'angband',
    mood: 'Angband: the iron hells of Morgoth; ancient, vast and pitiless.',
    root: 46,
    scale: 'harmonicMinor',
    bpm: 50,
    meter: 4,
    chords: [0, 5, 3, 4],
    motif: '0*2 2*2 | 5*3 4 | 3*2 5*2 | 4*3 6',
    answer: '7*3 6 | 5*2 2*2 | 3*1.5 2*.5 0*2 | 4*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.55 },
      { role: 'pad', inst: 'organ', vol: 0.4 },
      { role: 'pad', inst: 'choir', vol: 0.45 },
      { role: 'melody', inst: 'brass', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'choir', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.35, every: 4 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...', vol: 0.5, from: 0.3 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.', vol: 0.45, from: 0.6 },
    ],
    space: 0.85,
    bright: 0.55,
    ambience: [['rumble', 0.4], ['cave', 0.4]],
    gap: [25, 60],
  },
  {
    id: 'barrow',
    mood: 'The Barrow-downs: fog over old graves; cold voices that remember.',
    root: 50,
    scale: 'hirajoshi',
    bpm: 48,
    meter: 4,
    chords: [0, 3, 4, 0],
    voicing: 'open',
    motif: '2*3 1 | 0*4 | 4*2 3*2 | 1*4',
    answer: '5*3 4 | 3*4 | 2*2 4*2 | 0*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'ooh', vol: 0.6 },
      { role: 'pad', inst: 'glass', octave: 1, vol: 0.25 },
      { role: 'melody', inst: 'voice', octave: 1 },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.15 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.......', vol: 0.35, from: 0.5 },
    ],
    space: 0.9,
    bright: 0.4,
    ambience: [['wind', 0.45], ['whispers', 0.2]],
    gap: [35, 80],
  },
  {
    id: 'doom',
    mood: 'Mount Doom: the fire of the Sammath Naur; heat, ruin and the last choice.',
    root: 41,
    scale: 'phrygianDominant',
    bpm: 58,
    meter: 4,
    chords: [0, 1, 0, 6],
    voicing: 'open',
    motif: '0*2 1*2 | 2*3 1 | 0 1 2 4 | 3*4',
    answer: '7*2 8*2 | 9*3 8 | 7*2 6 4 | 0*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.6 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.45 },
      { role: 'pad', inst: 'brass', vol: 0.3 },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...', vol: 0.5 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'xoxoxoxo', vol: 0.35, from: 0.5 },
    ],
    space: 0.7,
    bright: 0.55,
    ambience: [['fire', 0.45], ['rumble', 0.5]],
    gap: [20, 50],
  },
  {
    id: 'nether',
    mood: 'The Nether Realm: a place outside the world, where nothing is quite solid.',
    root: 51,
    scale: 'wholeTone',
    bpm: 46,
    meter: 4,
    chords: [0, 1, 0, 2],
    motif: '0*2 2*2 | 4*4 | 3*2 1*2 | 5*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.45 },
      { role: 'pad', inst: 'glass', vol: 0.5 },
      { role: 'pad', inst: 'choir', vol: 0.35 },
      { role: 'melody', inst: 'celesta', octave: 1 },
    ],
    space: 0.95,
    echo: 0.4,
    bright: 0.6,
    ambience: [['void', 0.5], ['whispers', 0.12]],
    gap: [30, 70],
  },
  {
    id: 'numenor',
    mood: 'The drowned halls of Númenor: lost grandeur under green water.',
    root: 45,
    scale: 'dorian',
    bpm: 54,
    meter: 4,
    chords: [0, 6, 3, 0],
    motif: '4*2 3 2 | 1*2 3*2 | 5*1.5 4*.5 3*2 | 4*4',
    answer: '7*2 6*2 | 8*2 6*2 | 5*2 3*2 | 2*4',
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.5 },
      { role: 'pad', inst: 'choir', vol: 0.35, in: ['b', 'breath'] },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.8, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'celesta', octave: 1, density: 0.25 },
    ],
    space: 0.8,
    echo: 0.2,
    bright: 0.35,
    ambience: [['sea', 0.3], ['drips', 0.3]],
    gap: [30, 70],
  },
  {
    id: 'mandos',
    mood: 'The Halls of Mandos: the house of waiting; solemn and outside of time.',
    root: 50,
    scale: 'aeolian',
    bpm: 44,
    meter: 4,
    chords: [0, 5, 2, 6],
    motif: '0*2 2*2 | 2*4 | 4*2 2*2 | 6*2 3*2',
    answer: '7*3 6 | 5*4 | 4*2 6*2 | 8*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.4 },
      { role: 'pad', inst: 'organ', vol: 0.35 },
      { role: 'pad', inst: 'choir', vol: 0.5 },
      { role: 'melody', inst: 'choir', octave: 1 },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.3, every: 4 },
    ],
    space: 0.95,
    bright: 0.55,
    ambience: [['void', 0.2], ['cave', 0.2]],
  },
  {
    id: 'cirith-ungol',
    mood: 'Cirith Ungol: Shelob’s lair; tight tunnels, stench, and legs in the dark.',
    root: 49,
    scale: 'phrygian',
    bpm: 72,
    meter: 4,
    chords: [0, 1, 0, 1],
    motif: '0*3 1 | 2*2 1*2 | 0*4 | r*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.5 },
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'pad', inst: 'glass', octave: 2, vol: 0.2 },
      { role: 'arp', inst: 'harp', octave: 2, pattern: 'xoxoxoxoxoxoxoxo', order: 'random', density: 0.45, vol: 0.55 },
      { role: 'melody', inst: 'reed', octave: 0 },
      { role: 'perc', inst: 'frame', pattern: 'x..ox..o', vol: 0.35, from: 0.45 },
    ],
    space: 0.6,
    bright: 0.45,
    ambience: [['drips', 0.4], ['whispers', 0.25]],
    gap: [25, 60],
  },
  {
    id: 'heart',
    mood: 'The Heart of the Earth: crushing depth and the slow pulse of the world.',
    root: 41,
    scale: 'locrian',
    bpm: 40,
    meter: 4,
    chords: [0, 1, 0, 4],
    voicing: 'open',
    motif: '0*4 | 1*4 | 0*2 4*2 | 3*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.6 },
      { role: 'pad', inst: 'ooh', vol: 0.4 },
      { role: 'melody', inst: 'cello', octave: 0 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...', vol: 0.45, every: 2 },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.3, every: 4 },
    ],
    space: 0.85,
    bright: 0.35,
    ambience: [['rumble', 0.6], ['cave', 0.3]],
    gap: [30, 70],
  },
  {
    id: 'void',
    mood: 'The Void: almost nothing; a few lights in an endless dark.',
    root: 60,
    scale: 'wholeTone',
    bpm: 40,
    meter: 4,
    chords: [0, 0, 1, 1],
    motif: '4*4 | r*4 | 2*4 | r*4',
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.35 },
      { role: 'melody', inst: 'glass', octave: 1 },
      { role: 'bells', inst: 'celesta', octave: 1, density: 0.2 },
    ],
    space: 1,
    echo: 0.45,
    bright: 0.7,
    ambience: [['void', 0.5]],
    gap: [40, 90],
  },
  {
    id: 'paths-dead',
    mood: 'The Paths of the Dead: oathbreakers marching in the dark, waiting.',
    root: 43,
    scale: 'aeolian',
    bpm: 52,
    meter: 4,
    chords: [0, 5, 6, 0],
    motif: '0*2 4*2 | 2*3 r | 3*2 1*2 | 0*4',
    answer: '4*2 5*2 | 7*2 5*2 | 6*2 3*2 | 4*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.6 },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.55 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...x...', vol: 0.35 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.x.x.', vol: 0.4, from: 0.5 },
    ],
    space: 0.85,
    bright: 0.45,
    ambience: [['whispers', 0.3], ['wind', 0.35]],
    gap: [25, 60],
  },
  {
    id: 'illusory',
    mood: 'The Illusory Castle: a music box that plays slightly wrong; nothing is as it seems.',
    root: 58,
    scale: 'lydian',
    bpm: 88,
    meter: 3,
    chords: [0, 1, 0, 1],
    motif: '4 7 9 | 8*2 7 | 6 4 1 | 3*3',
    answer: '9*1.5 8*.5 7 | 5*3 | 4 2 0 | 1*3',
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.x.x.', order: 'updown', density: 0.8 },
      { role: 'melody', inst: 'celesta', octave: 1 },
      { role: 'bells', inst: 'glass', octave: 2, density: 0.2 },
    ],
    space: 0.7,
    echo: 0.35,
    bright: 0.85,
    ambience: [['void', 0.15]],
    gap: [25, 60],
  },
  {
    id: 'maze',
    mood: 'The Maze: turning corners that look the same; a patient, ticking puzzle.',
    root: 50,
    scale: 'dorian',
    bpm: 104,
    meter: 4,
    chords: [0, 0, 6, 6],
    motif: '4*2 3*2 | 2*4 | 6*2 3*2 | 1*4',
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'arp', inst: 'lute', octave: 1, pattern: 'xooo xooo xooo xooo'.replaceAll(' ', ''), order: 'up', density: 0.85, vol: 0.7 },
      { role: 'melody', inst: 'reed', octave: 1 },
      { role: 'perc', inst: 'wood', pattern: 'x.o.x.o.', vol: 0.35, density: 0.9 },
    ],
    space: 0.4,
    bright: 0.7,
    ambience: [['cave', 0.25]],
    gap: [25, 60],
  },
  {
    id: 'orc-cave',
    mood: 'An orc cave: crude, loud and close; war drums echo off wet rock.',
    root: 40,
    scale: 'phrygian',
    bpm: 84,
    meter: 4,
    chords: [0, 1, 0, 6],
    voicing: 'open',
    motif: '0 0*.5 0*.5 1 0 | 1*2 3*2 | 0 2 1 0 | 6*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'brass', vol: 0.25 },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.ox', vol: 0.45 },
      { role: 'perc', inst: 'frame', pattern: 'oxoxoxox', vol: 0.3, from: 0.4 },
    ],
    space: 0.55,
    bright: 0.55,
    ambience: [['cave', 0.4], ['drips', 0.25]],
    gap: [25, 55],
  },
  {
    id: 'moria',
    mood: 'Moria: the fallen dwarf-realm; vast dark halls and drums in the deep.',
    root: 38,
    scale: 'aeolian',
    bpm: 50,
    meter: 4,
    chords: [0, 6, 3, 0],
    voicing: 'open',
    motif: DWARF_MOTIF,
    answer: DWARF_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.5 },
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.5 },
      { role: 'melody', inst: 'cello', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.7, in: ['b'] },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.......', order: 'random', density: 0.5 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.....x.', vol: 0.35 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.x...', vol: 0.5, from: 0.4 },
    ],
    space: 0.95,
    bright: 0.4,
    ambience: [['cave', 0.5], ['drips', 0.35]],
    gap: [25, 60],
  },
  {
    id: 'dol-guldur',
    mood: 'Dol Guldur: the Necromancer’s hill; sorcery, cold ruin and creeping fear.',
    root: 47,
    scale: 'hungarianMinor',
    bpm: 54,
    meter: 4,
    chords: [0, 5, 3, 4],
    motif: '0 3 4*2 | 5*3 4 | 3*2 2*2 | 4*4',
    answer: '7*2 6*2 | 5 3 2*2 | 3*1.5 2*.5 0*2 | 1*4',
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.5 },
      { role: 'pad', inst: 'organ', vol: 0.3 },
      { role: 'pad', inst: 'choir', vol: 0.4 },
      { role: 'melody', inst: 'reed', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'choir', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'bell', octave: 0, density: 0.15 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x', vol: 0.45, from: 0.4 },
    ],
    space: 0.8,
    bright: 0.45,
    ambience: [['whispers', 0.3], ['wind', 0.25]],
    gap: [25, 60],
  },
  {
    id: 'water-cave',
    mood: 'A small water cave: cool, calm, every drop ringing.',
    root: 60,
    scale: 'pentatonic',
    bpm: 60,
    meter: 4,
    chords: [0, 3, 0, 4],
    motif: '2*2 4*2 | 3*4 | 1*2 2*2 | 0*4',
    answer: '5*2 4*2 | 6*4 | 4*2 2*2 | 3*4',
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.4 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.o.', order: 'updown', density: 0.5 },
      { role: 'melody', inst: 'celesta', octave: 1 },
    ],
    space: 0.85,
    echo: 0.35,
    bright: 0.75,
    ambience: [['drips', 0.5], ['water', 0.3]],
    gap: [30, 70],
  },
  {
    id: 'sacred',
    mood: 'The Sacred Land of Mountains: thin bright air, holy and austere.',
    root: 52,
    scale: 'lydian',
    bpm: 50,
    meter: 4,
    chords: [0, 1, 0, 4],
    voicing: 'add9',
    motif: '4*2 7*2 | 8*4 | 9*2 7*2 | 8*4',
    answer: '7*2 4*2 | 5*4 | 4*2 2*2 | 1*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.35 },
      { role: 'pad', inst: 'choir', vol: 0.6 },
      { role: 'melody', inst: 'horn', octave: 0, vol: 0.7, in: ['a'] },
      { role: 'melody', inst: 'voice', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.2 },
    ],
    space: 0.85,
    echo: 0.25,
    bright: 0.85,
    ambience: [['wind', 0.5]],
    gap: [30, 70],
  },
  {
    id: 'rhun',
    mood: 'The Land of Rhûn: the far East; strange rhythms, dust and horsemen.',
    root: 50,
    scale: 'phrygianDominant',
    bpm: 92,
    meter: 4,
    chords: [0, 1, 0, 6],
    motif: '0*.5 1*.5 2 1*.5 0*.5 1 | 2*1.5 3*.5 4*2 | 2 1 0*2 | 6*2 3*2',
    answer: '4*2 5 4 | 5*1.5 4*.5 3 2 | 2*2 1 0 | 1*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'melody', inst: 'lute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x.ox.xo.', vol: 0.45, density: 0.9 },
      { role: 'perc', inst: 'shaker', pattern: 'oooooooo', vol: 0.25, density: 0.6, from: 0.3 },
    ],
    space: 0.4,
    bright: 0.75,
    ambience: [['wind', 0.35], ['sand', 0.2]],
    gap: [25, 55],
  },
  {
    id: 'sandworm',
    mood: 'The Sandworm lair: hissing sand and something vast moving beneath.',
    root: 42,
    scale: 'phrygian',
    bpm: 60,
    meter: 4,
    chords: [0, 1, 0, 1],
    voicing: 'open',
    motif: '0*4 | 1*4 | 0*2 1*2 | 0*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.5 },
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'melody', inst: 'cello', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x..x....', vol: 0.4 },
    ],
    space: 0.6,
    bright: 0.5,
    ambience: [['sand', 0.4], ['rumble', 0.4]],
    gap: [25, 60],
  },
  {
    id: 'temple',
    mood: 'A lost temple: old rites, incense and a held breath.',
    root: 45,
    scale: 'dorian',
    bpm: 56,
    meter: 4,
    chords: [0, 3, 0, 6],
    motif: '0*2 2 3 | 4*4 | 3*2 2*2 | 0*4',
    answer: '4*2 5 6 | 7*4 | 6*2 4*2 | 3*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'choir', vol: 0.5 },
      { role: 'melody', inst: 'flute', octave: 1 },
      { role: 'perc', inst: 'frame', pattern: 'x..o', vol: 0.4 },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.3, every: 4 },
    ],
    space: 0.75,
    bright: 0.6,
    ambience: [['cave', 0.3], ['drips', 0.3]],
    gap: [25, 60],
  },

  /* Quests */
  {
    id: 'thieves',
    mood: 'Thieves in the night: soft footfalls and quick hands.',
    root: 55,
    scale: 'dorian',
    bpm: 100,
    meter: 4,
    chords: [0, 3, 0, 4],
    motif: '0*.5 r*.5 2*.5 r*.5 4 3*.5 2*.5 | 3 r 5 r | 4*.5 3*.5 2*.5 1*.5 0*2 | 4*2 r*2',
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'bass', inst: 'cello', octave: -1, pattern: 'x.x.x.x.', vol: 0.5 },
      { role: 'melody', inst: 'lute', octave: 1 },
      { role: 'perc', inst: 'wood', pattern: 'x.o.x.o.', vol: 0.3, density: 0.8 },
    ],
    space: 0.35,
    bright: 0.7,
    ambience: [['crickets', 0.25]],
    gap: [15, 35],
  },
  {
    id: 'nazgul',
    mood: 'A Black Rider on the road: hooves, a cold shriek, the urge to hide.',
    root: 40,
    scale: 'phrygian',
    bpm: 108,
    meter: 4,
    chords: [0, 1, 0, 1],
    voicing: 'open',
    motif: '0*3 1 | 0*4 | 4*2 5*2 | 4*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.5 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.4 },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.xx.xx.', vol: 0.4 },
      { role: 'bells', inst: 'glass', octave: 3, density: 0.2, from: 0.4 },
    ],
    space: 0.6,
    bright: 0.5,
    ambience: [['wind', 0.4]],
    floor: 0.3,
    gap: [10, 25],
  },
  {
    id: 'trolls',
    mood: 'The Trolls’ glade: heavy feet, stupid strength, trampled undergrowth.',
    root: 38,
    scale: 'locrian',
    bpm: 60,
    meter: 4,
    chords: [0, 1, 0, 1],
    voicing: 'open',
    motif: '0*2 0 1 | 0*4 | 3*2 1*2 | 0*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.5 },
      { role: 'pad', inst: 'brass', vol: 0.3 },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...x...', vol: 0.55 },
    ],
    space: 0.45,
    bright: 0.5,
    ambience: [['leaves', 0.25], ['wind', 0.2]],
    gap: [15, 35],
  },
  {
    id: 'wolves',
    mood: 'Wolves! A chase through the dark; breath, teeth and running feet.',
    root: 45,
    scale: 'aeolian',
    bpm: 116,
    meter: 4,
    chords: [0, 5, 6, 0],
    motif: '0 4 3 2 | 0*2 2*2 | 6 4 3 1 | 0*4',
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.4 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'xoxoxoxo', order: 'up', density: 0.9, vol: 0.6 },
      { role: 'melody', inst: 'horn', octave: 1 },
      { role: 'perc', inst: 'frame', pattern: 'x.xxx.x.', vol: 0.45 },
    ],
    space: 0.5,
    bright: 0.6,
    ambience: [['wind', 0.3]],
    floor: 0.35,
    gap: [10, 25],
  },
];

/* Quest and story variants of the themes above; later ones may build on earlier ones. */
function derived(): Theme[] {
  const built = new Map(THEMES.map((theme) => [theme.id, theme]));
  const result: Theme[] = [];
  const t = (id: string) => {
    const theme = built.get(id);
    if (!theme) throw new Error(`Unknown theme ${id}`);
    return theme;
  };
  const add = (theme: Theme) => {
    built.set(theme.id, theme);
    result.push(theme);
  };
  const battleDrums: Layer[] = [
    { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x', vol: 0.5 },
    { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.x.xx', vol: 0.45, from: 0.4 },
  ];
  add(variant(t('khazad'), 'erebor', {
    mood: 'Erebor: the Lonely Mountain; dwarven gold and the memory of the Dragon.',
    scale: 'aeolian',
    bpm: 60,
    layers: [
      ...t('khazad').layers.filter((l) => l.role !== 'perc'),
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...', vol: 0.45, from: 0.3 },
      { role: 'perc', inst: 'anvil', pattern: '......x.', vol: 0.2, density: 0.4, every: 2 },
    ],
    ambience: [['fire', 0.25], ['cave', 0.35], ['rumble', 0.15]],
  }));
  add(variant(t('bree'), 'hobbit', { mood: 'A hobbit errand: cheerful worry and muddy lanes.', root: 60, scale: 'ionian', bpm: 180 }));
  add(variant(t('barrow'), 'wight', {
    mood: 'The Wight’s grave: cold hands in the dark.',
    floor: 0.3,
    gap: [15, 35],
  }));
  add(variant(t('mirkwood'), 'spiders', { mood: 'Spiders of Mirkwood: webs everywhere, and they are hungry.', bpm: 150, floor: 0.3, gap: [10, 25] }));
  add(variant(t('marsh'), 'poison', { mood: 'Poisoned water: sickly, wrong, slowly spreading.', scale: 'wholeTone', bright: 0.4 }));
  add(variant(t('minas-anor'), 'narsil', {
    mood: 'The Broken Sword: an heirloom of kings waiting to be found.',
    layers: [...t('minas-anor').layers, { role: 'bells', inst: 'celesta', octave: 2, density: 0.25 }],
    gap: [15, 35],
  }));
  add(variant(t('gondolin'), 'eol', {
    mood: 'Eöl the Dark Elf: elven grace turned bitter and secret.',
    scale: 'harmonicMinor',
    bright: 0.5,
    ambience: [['leaves', 0.3], ['whispers', 0.15]],
    gap: [15, 35],
  }));
  add(variant(t('title'), 'nirnaeth', {
    mood: 'Nirnaeth Arnoediad: the Battle of Unnumbered Tears; courage against hopeless odds.',
    scale: 'aeolian',
    bpm: 76,
    layers: [...t('title').layers.filter((l) => l.role !== 'perc'), ...battleDrums],
    ambience: [['wind', 0.3], ['fire', 0.15]],
    floor: 0.4,
  }));
  add(variant(t('gondolin'), 'gondolin-falls', {
    mood: 'The fall of Gondolin: the white city burns; flight and grief.',
    scale: 'aeolian',
    bpm: 80,
    layers: [...t('gondolin').layers.filter((l) => l.role !== 'bells'), ...battleDrums],
    ambience: [['fire', 0.4], ['wind', 0.2]],
    floor: 0.4,
  }));
  add(variant(t('minas-anor'), 'alliance', {
    mood: 'The Last Alliance: Elves and Men standing together before the Black Gate.',
    bpm: 84,
    layers: [...t('minas-anor').layers.filter((l) => l.role !== 'perc'), ...battleDrums],
    floor: 0.35,
  }));
  add(variant(t('erebor'), 'dragons', {
    mood: 'Dragons! Wings in the dark, heat, and gold-lust.',
    floor: 0.4,
    ambience: [['fire', 0.45], ['rumble', 0.3]],
    gap: [10, 25],
  }));
  add(variant(t('illusory'), 'haunted', {
    mood: 'A haunted house: a music box playing to nobody.',
    scale: 'harmonicMinor',
    bpm: 76,
    bright: 0.6,
    ambience: [['whispers', 0.3], ['wind', 0.2]],
  }));
  add(variant(t('dol-guldur'), 'evil', { mood: 'An evil place: the air itself is hostile.', floor: 0.25 }));
  add(variant(t('dol-guldur'), 'thrain', { mood: 'A prisoner in Dol Guldur: hope in a hopeless place.', scale: 'harmonicMinor' }));
  add(variant(t('sacred'), 'apotheosis', { mood: 'Falling toward apotheosis: power beyond mortal measure.', floor: 0.3, bpm: 56 }));
  add(variant(t('ice'), 'helcaraxe', {
    mood: 'The Helcaraxë: the Grinding Ice; cold beyond bearing and cracking floes.',
    root: 47,
    ambience: [['wind', 0.8]],
    layers: [...t('ice').layers, { role: 'perc', inst: 'anvil', octave: 2, pattern: '......x.', vol: 0.15, density: 0.35 }],
  }));
  add(variant(t('forest'), 'old-forest', {
    mood: 'The Old Forest: drowsy, ancient trees that do not like walkers; and a merry song somewhere.',
    root: 53,
    scale: 'mixolydian',
    bpm: 132,
    motif: '4*2 5 4 2*2 | 6*3 4*3 | 2 3 4 7*3 | 3*3 1*3',
    answer: '7*2 6 4*3 | 8*3 6*3 | 4*2 2 0*3 | 5*6',
    layers: [
      ...t('forest').layers.filter((l) => l.role !== 'melody'),
      { role: 'melody', inst: 'whistle', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'flute', octave: 1, in: ['b'] },
      { role: 'counter', inst: 'reed', octave: 0, vol: 0.5 },
    ],
    ambience: [['leaves', 0.45], ['birds', 0.3]],
  }));
  return result;
}

/**
 * Average level of each theme in dBFS at the default volume (measured by
 * rendering it offline). Themes are brought most of the way to a common
 * level; a little of their natural contrast is kept.
 */
const MEASURED_DB: Readonly<Record<string, number>> = {
  title: -26.6, overworld: -26.2, lament: -26.1, bree: -28.1, gondolin: -25.6, 'minas-anor': -27.1, lorien: -30,
  khazad: -26.4, haven: -27.1, plains: -26.4, forest: -28.2, mountains: -29.2, marsh: -29.2, desert: -32, ice: -34.2,
  coast: -30, ashlands: -33, depths: -26.6, mirkwood: -29.5, mordor: -31.8, angband: -30.5, barrow: -29.8, doom: -31,
  nether: -33.1, numenor: -31.1, mandos: -31.2, 'cirith-ungol': -28.3, heart: -25, void: -33.1, 'paths-dead': -28.2,
  illusory: -28.8, maze: -30.2, 'orc-cave': -30.5, moria: -24.1, 'dol-guldur': -30.2, 'water-cave': -34.3, sacred: -32.6,
  rhun: -31.1, sandworm: -24.4, temple: -29.2, thieves: -27.5, nazgul: -27.5, trolls: -32.3, wolves: -29, erebor: -27.6,
  hobbit: -29, wight: -29.6, spiders: -28.3, poison: -31.2, narsil: -27.6, eol: -25.3, nirnaeth: -23.4,
  'gondolin-falls': -21.5, alliance: -26.2, dragons: -27.3, haunted: -28.9, evil: -30.4, thrain: -30.1, apotheosis: -31.9,
  helcaraxe: -35.1, 'old-forest': -29.1,
};
const TARGET_DB = -27;

/** Gain that evens out the loudness of a theme. */
export function themeGain(id: string): number {
  const measured = MEASURED_DB[id];
  if (measured === undefined) return 1;
  return Math.min(2, Math.max(0.5, Math.pow(10, (0.75 * (TARGET_DB - measured)) / 20)));
}

/** Every theme by id. */
export const THEME_LIST: readonly Theme[] = [...THEMES, ...derived()];

export const THEME_BY_ID: ReadonlyMap<string, Theme> = new Map(THEME_LIST.map((theme) => [theme.id, theme]));

export function themeById(id: string): Theme {
  return THEME_BY_ID.get(id) ?? THEME_BY_ID.get('depths')!;
}
