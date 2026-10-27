import { augmentMelody, invertMelody, melodyBars, staccatoMelody, stretchChords, transposeMelody, type ScaleName, type Voicing } from './theory.ts';

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


export type ThemeGroup = 'Opening' | 'Towns' | 'Wilderness' | 'Dungeons' | 'Quests';

export interface Theme {
  id: string;
  /** Title shown in the soundtrack list. */
  name: string;
  group: ThemeGroup;
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
  /** Bars of accompaniment before the first melody (default 1). */
  intro?: number;
  /** Intensity the music never falls below. */
  floor?: number;
  /** Delays every other step by this fraction of a step. */
  swing?: number;
}

/** Copies a theme with changes; layers in the patch replace the base layers. */
export function variant(base: Theme, id: string, patch: Partial<Omit<Theme, 'id'>>): Theme {
  return { ...base, ...patch, id };
}

/*
 * Leitmotifs. Each family has a melody and an answer in scale degrees, so
 * the same tune can be heard in another mode, tempo, metre or orchestration:
 * the Tale is the hero's theme, the Hearth is home, the Elven theme is the
 * Eldar, the Dwarf theme is Durin's folk, the Shadow is the Enemy, the Wild
 * is the woods, the Deep is the under-earth, the Chant is the dead, the
 * Dream is what lies outside the world, and the East is the far lands.
 */

/* The Tale (4/4): a dotted call rising a fifth, answered a third higher. */
const TALE_CHORDS = [0, 3, 0, 6, 2, 3, 4, 0];
const TALE = '0*.75 0*.25 4*1.5 3*.5 4 | 5*.5 4*.5 3*.5 2*.5 3*2 | 0*.75 0*.25 4*1.5 3*.5 4 | 7*1.5 8*.5 6*2 | 2*.75 2*.25 6*1.5 5*.5 6 | 7*.5 6*.5 5*.5 4*.5 5*2 | 4*.5 5*.5 6 7*.5 6*.5 4 | 3*.5 2*.5 1*.5 2*.5 0*2';
const TALE_ANSWER = 'r*.5 4*.5 7 9*1.5 8*.5 | 7*1.5 6*.5 5*2 | r*.5 4*.5 7 9*1.5 10*.5 | 11*1.5 9*.5 8*2 | 9*.5 8*.5 7*.5 6*.5 7*2 | 10*.5 9*.5 8*.5 7*.5 8*2 | 11*1.5 10*.5 8 6 | 7*2 4*2';

/* The Hearth (6/8 jig): an arpeggio that skips up to the octave and back. */
const HEARTH_CHORDS = [0, 3, 0, 6, 0, 3, 4, 0];
const HEARTH = '0 2 4 7*2 4 | 3 5 7 10*2 7 | 7 6 7 4*2 2 | 6*3 4*2 2 | 0 2 4 7*2 4 | 3 5 7 10*2 9 | 8 7 6 4*2 6 | 7*2 4 0*3';
const HEARTH_ANSWER = '9*3 7*2 9 | 10*3 10 9 7 | 7 8 9 11*2 9 | 10*3 8*3 | 9*3 7*2 9 | 10*3 12*2 10 | 11 10 8 6*2 8 | 7*3 r*3';

/* The Elven theme (3/4): a rising sixth, then a falling line through the raised fourth. */
const ELVEN_CHORDS = [0, 1, 0, 1, 5, 4, 1, 0];
const ELVEN = '0 4 7 | 8*2 5 | 9*1.5 8*.5 7 | 5 3 1 | 5*1.5 4*.5 5 | 4*2 6 | 8 7 5 | 7*2 r';
const ELVEN_ANSWER = '11*2 9 | 10*2 8 | 9 7 4 | 5*2 3 | 9 7 5 | 6 8 11 | 10 8 5 | 7*2 r';

/* The Dwarf theme (4/4): hammer blows on one note, then a leap of a fifth. */
const DWARF_CHORDS = [0, 6, 3, 0, 0, 6, 4, 0];
const DWARF = '0*.75 0*.25 0 4*1.5 2*.5 | 6*.75 6*.25 6 10*1.5 8*.5 | 7*1.5 5*.5 3*1.5 5*.5 | 4 2 0*2 | 0*.75 0*.25 0 4*1.5 7*.5 | 8*1.5 7*.5 6 8 | 8*.5 7*.5 6*.5 5*.5 4 6 | 0*1.5 -3*.5 0*2';
const DWARF_ANSWER = '4*1.5 4*.5 7 4 | 6*1.5 6*.5 8 6 | 5*1.5 5*.5 7 5 | 4*2 2 0 | 4*1.5 4*.5 7 9 | 8*1.5 7*.5 6 4 | 4*1.5 6*.5 8 6 | 7*2 r*2';

/* The Shadow (4/4): a note that leans on the semitone above and falls back. */
const SHADOW_CHORDS = [0, 1, 0, 5, 0, 1, 6, 0];
const SHADOW = '0*1.5 1*.5 0*2 | 1*1.5 2*.5 1 3 | 4*1.5 5*.5 4*2 | 5 4 3 2 | 0*1.5 1*.5 0*2 | 3*1.5 4*.5 5 3 | 6*.5 5*.5 4 3 1 | 0*3 r';
const SHADOW_ANSWER = '7*.5 7*.5 7*.5 8*.5 7*2 | 8*.5 8*.5 8*.5 10*.5 8*2 | 11*1.5 10*.5 9 8 | 9*2 7*2 | 7*.5 7*.5 7*.5 8*.5 7*2 | 8*.5 8*.5 8*.5 10*.5 8*2 | 6*1.5 5*.5 4 3 | 0*3 r';

/* The Wild (6/8): a call from the treetops and a reply from below. */
const WILD_CHORDS = [0, 3, 0, 6, 0, 3, 4, 0];
const WILD = '7*2 4 2*2 4 | 3*3 5*2 3 | 4 5 7 9*2 7 | 8*3 6*3 | 7*2 4 2*2 4 | 3 4 5 7*2 5 | 6 5 4 6*2 8 | 7*3 r*3';
const WILD_ANSWER = '11*2 9 7*3 | 10*2 12 10*3 | 11*2 9 7 9 11 | 13*2 12 13*3 | 11*2 9 7*3 | 10 9 8 7*2 8 | 8*2 6 4*3 | 7*3 r*3';

/* The Deep (4/4): a few careful steps, a pause, a few more. */
const DEEP_CHORDS = [0, 5, 3, 4, 0, 5, 6, 4];
const DEEP = '0*.5 2*.5 4 r*.5 4*.5 3*.5 2*.5 | 2*.5 3*.5 5 r*.5 5*.5 4*.5 3*.5 | 3*1.5 5*.5 7*2 | 6*.5 5*.5 4*2 r | 0*.5 2*.5 4 r*.5 4*.5 3*.5 2*.5 | 2*.5 3*.5 5 r*.5 5*.5 4*.5 3*.5 | 6 8 7*1.5 6*.5 | 4*2 r*2';
const DEEP_ANSWER = '7*2 6 4 | 5*2 7 5 | 3*2 5 7 | 6*1.5 5*.5 4*2 | 9*2 7 9 | 7*2 5 7 | 8*2 6 8 | 4*2 r*2';

/* The Chant (4/4): a slow turn around one note, sung by the dead. */
const CHANT_CHORDS = [0, 0, 5, 4, 0, 3, 5, 4];
const CHANT = '4*1.5 3*.5 4 2 | 2*1.5 1*.5 0*2 | 2*1.5 3*.5 2 0 | 1*2 r*2 | 4*1.5 3*.5 4 7 | 5*1.5 4*.5 3*2 | 2*1.5 3*.5 2 0 | -1*2 r*2';
const CHANT_ANSWER = '7*1.5 6*.5 7 5 | 4*2 2*2 | 5*1.5 4*.5 2*2 | 4*2 r*2 | 7*1.5 6*.5 7 9 | 8*2 5*2 | 5*1.5 4*.5 2 0 | 1*2 r*2';

/* The Dream (3/4): a music box climbing and drifting back. */
const DREAM_CHORDS = [0, 1, 0, 1, 0, 1, 4, 0];
const DREAM = '4 7 9 | 8*2 7 | 7 4 2 | 3*2 r | 4 7 9 | 10*2 8 | 8 6 4 | 7*2 r';
const DREAM_ANSWER = '9*2 11 | 10*2 8 | 9 7 4 | 5*2 r | 11 9 7 | 8*2 10 | 8 6 4 | 0*2 r';

/* The East (4/4): a winding figure around the augmented second. */
const EAST_CHORDS = [0, 1, 0, 6, 0, 1, 6, 0];
const EAST = '0*.5 1*.5 2*1.5 1*.5 0 | 1*1.5 2*.5 3*2 | 4*.5 3*.5 2*1.5 1*.5 0 | -1*2 r*2 | 0*.5 1*.5 2*1.5 1*.5 0 | 1*1.5 2*.5 3*2 | 6*.5 5*.5 3*1.5 2*.5 3 | 0*2 r*2';
const EAST_ANSWER = '7*1.5 8*.5 9 8 | 8*1.5 9*.5 10*2 | 7*.5 8*.5 9*1.5 8*.5 7 | 6*2 r*2 | 11*1.5 10*.5 9 8 | 8*1.5 7*.5 5*2 | 6*.5 5*.5 3*1.5 2*.5 1 | 0*2 r*2';

const THEMES: Theme[] = [
  /* Opening */
  {
    id: 'title',
    name: 'Tales of Middle-earth',
    group: 'Opening',
    mood: 'The opening of a long tale: a horn call, firelight, and the road ahead.',
    root: 50,
    scale: 'dorian',
    bpm: 88,
    meter: 4,
    chords: TALE_CHORDS,
    voicing: 'add9',
    motif: TALE,
    answer: TALE_ANSWER,
    intro: 0,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.55 },
      { role: 'pad', inst: 'choir', vol: 0.4, in: ['b', 'breath'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.6, pattern: 'x..x..o.' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.ox.ox.', order: 'updown', density: 0.95, vol: 0.75 },
      { role: 'melody', inst: 'horn', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, vol: 0.85, in: ['b', 'breath'] },
      { role: 'counter', inst: 'flute', octave: 2, vol: 0.4, in: ['b'] },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.3, in: ['breath'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.......', vol: 0.45, in: ['a', 'b'] },
      { role: 'perc', inst: 'frame', pattern: '..o...o.', vol: 0.3, in: ['b'] },
    ],
    space: 0.5,
    bright: 0.8,
    ambience: [['fire', 0.3]],
  },
  {
    id: 'lament',
    name: 'The Tale Ends',
    group: 'Opening',
    mood: 'The tale has ended: the hero’s theme, slow and grieving.',
    root: 50,
    scale: 'aeolian',
    bpm: 72,
    meter: 4,
    chords: stretchChords(TALE_CHORDS.slice(0, 4), 2),
    motif: augmentMelody(melodyBars(TALE, 4), 2),
    answer: augmentMelody(melodyBars(TALE_ANSWER, 4), 2),
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'pad', inst: 'ooh', vol: 0.4, in: ['b', 'breath'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.45, pattern: 'x.......' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.o.', order: 'up', density: 0.75, vol: 0.6 },
      { role: 'melody', inst: 'cello', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'voice', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.15, in: ['breath'] },
    ],
    space: 0.8,
    bright: 0.5,
    ambience: [['wind', 0.25]],
  },
  {
    id: 'overworld',
    name: 'The Road Goes Ever On',
    group: 'Wilderness',
    mood: 'The road across Middle-earth: the hero’s theme as a walking song.',
    root: 50,
    scale: 'dorian',
    bpm: 100,
    meter: 4,
    chords: TALE_CHORDS,
    motif: staccatoMelody(TALE),
    answer: TALE_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.4, in: ['b', 'breath'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55, pattern: 'x.o.x.o.' },
      { role: 'arp', inst: 'lute', octave: 0, pattern: 'x.ox.ox.', order: 'up', density: 0.9, vol: 0.75 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'reed', octave: 1, vol: 0.8, in: ['b'] },
      { role: 'counter', inst: 'strings', octave: 1, vol: 0.4, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x.o.x.oo', vol: 0.4, density: 0.85, in: ['a', 'b'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.......', vol: 0.5, from: 0.4 },
    ],
    space: 0.4,
    bright: 0.8,
    ambience: [['wind', 0.3]],
  },

  /* Towns */
  {
    id: 'bree',
    name: 'The Prancing Pony',
    group: 'Towns',
    mood: 'Bree: a jig in the common room, pipe smoke and chatter; homely and safe.',
    root: 55,
    scale: 'mixolydian',
    bpm: 176,
    meter: 6,
    chords: HEARTH_CHORDS,
    motif: HEARTH,
    answer: HEARTH_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.3, in: ['b', 'breath'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55, pattern: 'x..o..' },
      { role: 'arp', inst: 'lute', octave: 0, pattern: 'x.ox.o', order: 'up', density: 0.95 },
      { role: 'melody', inst: 'whistle', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'flute', octave: 1, in: ['b'] },
      { role: 'counter', inst: 'reed', octave: 0, vol: 0.4, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x.ox.o', vol: 0.45, density: 0.85, in: ['a', 'b'] },
      { role: 'perc', inst: 'wood', pattern: '...x..', vol: 0.25, density: 0.6, in: ['a'] },
    ],
    space: 0.3,
    bright: 0.9,
    ambience: [['birds', 0.4], ['fire', 0.1]],
    swing: 0.08,
  },
  {
    id: 'gondolin',
    name: 'The Hidden City',
    group: 'Towns',
    mood: 'Gondolin: white towers and fountains; the Elven theme in full, bright wonder.',
    root: 52,
    scale: 'lydian',
    bpm: 96,
    meter: 3,
    chords: ELVEN_CHORDS,
    voicing: 'add9',
    motif: ELVEN,
    answer: ELVEN_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.35, in: ['b'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.4, pattern: 'x.o.o.' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'xoxoxo', order: 'updown', density: 0.95 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'voice', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.35 },
      { role: 'perc', inst: 'shaker', pattern: 'x.o.o.', vol: 0.2, density: 0.7, in: ['b'] },
    ],
    space: 0.6,
    bright: 0.95,
    ambience: [['water', 0.3], ['birds', 0.25]],
  },
  {
    id: 'minas-anor',
    name: 'The Tower of the Sun',
    group: 'Towns',
    mood: 'Minas Anor: the hero’s answer as a fanfare from the white walls; pride and watchfulness.',
    root: 48,
    scale: 'ionian',
    bpm: 92,
    meter: 4,
    chords: [0, 3, 0, 4, 5, 3, 4, 0],
    motif: TALE_ANSWER,
    answer: transposeMelody(TALE, 2),
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.5 },
      { role: 'pad', inst: 'brass', vol: 0.22, in: ['b'] },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55, pattern: 'x..xx...' },
      { role: 'melody', inst: 'brass', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'horn', octave: 1, in: ['b', 'breath'] },
      { role: 'counter', inst: 'strings', octave: 1, vol: 0.45, in: ['a'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x..x.', vol: 0.5, in: ['a', 'b'] },
      { role: 'perc', inst: 'drum', pattern: '....x...', vol: 0.3, in: ['a'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.2, in: ['breath'] },
    ],
    space: 0.5,
    bright: 0.85,
    ambience: [['wind', 0.2]],
  },
  {
    id: 'lorien',
    name: 'The Golden Wood',
    group: 'Towns',
    mood: 'Lothlórien: the Elven theme at half speed, sung, where time stands still.',
    root: 57,
    scale: 'lydian',
    bpm: 132,
    meter: 3,
    chords: stretchChords(ELVEN_CHORDS.slice(0, 4), 2),
    voicing: 'add9',
    motif: augmentMelody(melodyBars(ELVEN, 4), 2),
    answer: augmentMelody(melodyBars(ELVEN_ANSWER, 4), 2),
    layers: [
      { role: 'pad', inst: 'choir', vol: 0.55 },
      { role: 'pad', inst: 'glass', octave: 1, vol: 0.25 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'updown', density: 0.8 },
      { role: 'melody', inst: 'voice', octave: 1, in: ['a', 'b'] },
      { role: 'melody', inst: 'flute', octave: 1, vol: 0.7, in: ['breath'] },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.35 },
    ],
    space: 0.85,
    echo: 0.25,
    bright: 0.8,
    ambience: [['leaves', 0.3], ['birds', 0.2]],
  },
  {
    id: 'khazad',
    name: 'Durin’s Halls',
    group: 'Towns',
    mood: 'Khazad-dûm: the Dwarf theme as a forge march; hammers, horns and deep-voiced pride.',
    root: 38,
    scale: 'dorian',
    bpm: 96,
    meter: 4,
    chords: DWARF_CHORDS,
    voicing: 'open',
    motif: DWARF,
    answer: DWARF_ANSWER,
    layers: [
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.45, in: ['b', 'breath'] },
      { role: 'bass', inst: 'cello', vol: 0.6, pattern: 'x.x.x.o.' },
      { role: 'melody', inst: 'brass', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'horn', octave: 1, in: ['b', 'breath'] },
      { role: 'counter', inst: 'cello', octave: 1, vol: 0.4, in: ['b'] },
      { role: 'perc', inst: 'drum', pattern: 'x...x.x.', vol: 0.55, in: ['a', 'b'] },
      { role: 'perc', inst: 'anvil', pattern: '..x...x.', vol: 0.25, density: 0.8 },
    ],
    space: 0.7,
    bright: 0.65,
    ambience: [['cave', 0.3], ['fire', 0.2]],
  },
  {
    id: 'haven',
    name: 'A Fire in the Dark',
    group: 'Towns',
    mood: 'A refuge in the deep: the Hearth tune slowed to a lullaby by the fire.',
    root: 53,
    scale: 'ionian',
    bpm: 108,
    meter: 6,
    chords: HEARTH_CHORDS,
    motif: HEARTH,
    answer: HEARTH_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.45, pattern: 'x.....' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'up', density: 0.9 },
      { role: 'melody', inst: 'flute', octave: 1 },
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.25, in: ['breath'] },
    ],
    space: 0.45,
    bright: 0.7,
    ambience: [['fire', 0.3]],
  },

  /* Wilderness */
  {
    id: 'plains',
    name: 'Under a Wide Sky',
    group: 'Wilderness',
    mood: 'Open grassland: the Hearth’s answer drifting over the fields; freedom.',
    root: 55,
    scale: 'ionian',
    bpm: 132,
    meter: 6,
    chords: HEARTH_CHORDS,
    motif: HEARTH_ANSWER,
    answer: HEARTH,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.45, pattern: 'x..o..' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.ox.o', order: 'up', density: 0.8 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b'] },
    ],
    space: 0.4,
    bright: 0.85,
    ambience: [['wind', 0.25], ['birds', 0.4]],
  },
  {
    id: 'forest',
    name: 'Green Shadows',
    group: 'Wilderness',
    mood: 'Old woods: the Wild theme on pipes; dappled light and the sense of being watched.',
    root: 52,
    scale: 'dorian',
    bpm: 138,
    meter: 6,
    chords: WILD_CHORDS,
    motif: WILD,
    answer: WILD_ANSWER,
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.4 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.4, pattern: 'x.....' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.ox.o', order: 'random', density: 0.7 },
      { role: 'melody', inst: 'flute', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'wood', pattern: 'x..o..', vol: 0.2, density: 0.6, in: ['b'] },
    ],
    space: 0.5,
    bright: 0.65,
    ambience: [['leaves', 0.4], ['birds', 0.35]],
  },
  {
    id: 'mountains',
    name: 'The High Passes',
    group: 'Wilderness',
    mood: 'High passes and cold stone: the hero’s call on horns, echoing from peak to peak.',
    root: 50,
    scale: 'aeolian',
    bpm: 96,
    meter: 4,
    chords: stretchChords([0, 5, 0, 6], 2),
    voicing: 'sus',
    motif: augmentMelody(melodyBars(TALE, 4), 2),
    answer: augmentMelody(melodyBars(TALE_ANSWER, 4), 2),
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.5 },
      { role: 'arp', inst: 'harp', octave: 0, pattern: 'x...o...', order: 'up', density: 0.8 },
      { role: 'melody', inst: 'horn', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.......', vol: 0.45, in: ['a', 'b'] },
    ],
    space: 0.65,
    echo: 0.35,
    bright: 0.65,
    ambience: [['wind', 0.55]],
  },
  {
    id: 'marsh',
    name: 'The Midgewater Fens',
    group: 'Wilderness',
    mood: 'Fens and mist: the Wild theme sinking into a slow, murky phrygian.',
    root: 47,
    scale: 'phrygian',
    bpm: 96,
    meter: 6,
    chords: WILD_CHORDS,
    motif: WILD,
    answer: WILD_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'arp', inst: 'harp', octave: 0, pattern: 'x.....o.....', order: 'random', density: 0.6 },
      { role: 'melody', inst: 'reed', octave: 1 },
      { role: 'perc', inst: 'frame', pattern: 'x.....', vol: 0.25, density: 0.7 },
    ],
    space: 0.6,
    bright: 0.45,
    ambience: [['water', 0.35], ['crickets', 0.25], ['drips', 0.2]],
  },
  {
    id: 'desert',
    name: 'Sun on the Sand',
    group: 'Wilderness',
    mood: 'Sun-baked sands: the East theme at a camel’s pace; heat shimmer and a far-off caravan.',
    root: 52,
    scale: 'phrygianDominant',
    bpm: 84,
    meter: 4,
    chords: EAST_CHORDS,
    motif: EAST,
    answer: EAST_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.25 },
      { role: 'arp', inst: 'lute', octave: 0, pattern: 'x..x..x.', order: 'up', density: 0.8, vol: 0.6 },
      { role: 'melody', inst: 'reed', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'flute', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'frame', pattern: 'x..x..o.', vol: 0.4, density: 0.85, in: ['a', 'b'] },
    ],
    space: 0.4,
    bright: 0.75,
    ambience: [['wind', 0.4], ['sand', 0.25]],
  },
  {
    id: 'ice',
    name: 'Fields of Ice',
    group: 'Wilderness',
    mood: 'Ice fields: the Dream theme on glass in a whole-tone scale; stillness and a cutting wind.',
    root: 54,
    scale: 'wholeTone',
    bpm: 108,
    meter: 3,
    chords: DREAM_CHORDS,
    motif: DREAM,
    answer: DREAM_ANSWER,
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.45 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.25, in: ['b', 'breath'] },
      { role: 'arp', inst: 'celesta', octave: 2, pattern: 'x.o.o.', order: 'down', density: 0.6, vol: 0.6 },
      { role: 'melody', inst: 'glass', octave: 1 },
      { role: 'bells', inst: 'bell', octave: 2, density: 0.2 },
    ],
    space: 0.85,
    echo: 0.3,
    bright: 0.75,
    ambience: [['wind', 0.65]],
  },
  {
    id: 'coast',
    name: 'The Sundering Sea',
    group: 'Wilderness',
    mood: 'Grey shores: the Elven answer sung over the waves; longing for lands beyond the West.',
    root: 57,
    scale: 'ionian',
    bpm: 96,
    meter: 3,
    chords: [0, 1, 0, 3, 5, 4, 1, 0],
    motif: ELVEN_ANSWER,
    answer: ELVEN,
    layers: [
      { role: 'pad', inst: 'choir', vol: 0.5 },
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.', order: 'updown', density: 0.85 },
      { role: 'melody', inst: 'voice', octave: 1 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.4, pattern: 'x.....' },
    ],
    space: 0.75,
    bright: 0.7,
    ambience: [['sea', 0.55], ['wind', 0.15]],
  },
  {
    id: 'ashlands',
    name: 'Ash and Ember',
    group: 'Wilderness',
    mood: 'Blasted lands near the Enemy: the Shadow theme half-heard through drifting ash.',
    root: 48,
    scale: 'phrygian',
    bpm: 72,
    meter: 4,
    chords: SHADOW_CHORDS,
    voicing: 'open',
    motif: SHADOW,
    answer: SHADOW_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.5 },
      { role: 'pad', inst: 'brass', vol: 0.22 },
      { role: 'melody', inst: 'cello', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'brass', octave: 0, vol: 0.8, in: ['b'] },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.......', vol: 0.4 },
    ],
    space: 0.6,
    bright: 0.45,
    ambience: [['wind', 0.5], ['rumble', 0.3]],
  },

  /* Dungeons */
  {
    id: 'depths',
    name: 'Under the Earth',
    group: 'Dungeons',
    mood: 'Unknown passages: the Deep theme on plucked strings; caution, curiosity, cold air.',
    root: 45,
    scale: 'aeolian',
    bpm: 80,
    meter: 4,
    chords: DEEP_CHORDS,
    motif: DEEP,
    answer: DEEP_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.45, pattern: 'x...x...' },
      { role: 'melody', inst: 'harp', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'cello', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.12 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...x...', vol: 0.45, from: 0.45 },
      { role: 'perc', inst: 'frame', pattern: '..o...o.', vol: 0.3, from: 0.65 },
    ],
    space: 0.7,
    bright: 0.5,
    ambience: [['cave', 0.45], ['drips', 0.35]],
  },
  {
    id: 'mirkwood',
    name: 'Mirkwood',
    group: 'Dungeons',
    mood: 'Mirkwood: the Wild theme twisted into phrygian; smothering trees and something skittering overhead.',
    root: 52,
    scale: 'phrygian',
    bpm: 126,
    meter: 6,
    chords: WILD_CHORDS,
    motif: WILD,
    answer: invertMelody(WILD_ANSWER, 9),
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'arp', inst: 'harp', octave: 2, pattern: 'xoxoxo', order: 'random', density: 0.55, vol: 0.6 },
      { role: 'melody', inst: 'flute', octave: 0, in: ['a', 'breath'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'wood', pattern: 'x.xo..', vol: 0.25, density: 0.7 },
      { role: 'perc', inst: 'frame', pattern: 'x..o..', vol: 0.35, from: 0.45 },
    ],
    space: 0.55,
    bright: 0.5,
    ambience: [['leaves', 0.35], ['crickets', 0.2], ['whispers', 0.1]],
  },
  {
    id: 'mordor',
    name: 'The Land of Shadow',
    group: 'Dungeons',
    mood: 'Mordor: the Shadow theme as a march of iron-shod feet; forges and a watching eye.',
    root: 40,
    scale: 'phrygian',
    bpm: 84,
    meter: 4,
    chords: SHADOW_CHORDS,
    voicing: 'open',
    motif: SHADOW,
    answer: SHADOW_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: 0, vol: 0.5 },
      { role: 'pad', inst: 'brass', octave: 1, vol: 0.25 },
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.4, in: ['b', 'breath'] },
      { role: 'bass', inst: 'cello', octave: 0, vol: 0.55, pattern: 'x.x.x.x.' },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...x...', vol: 0.55 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: '..x...xx', vol: 0.45, from: 0.45 },
      { role: 'perc', inst: 'anvil', pattern: '......x.', vol: 0.2, density: 0.5 },
    ],
    space: 0.6,
    bright: 0.5,
    ambience: [['wind', 0.3], ['rumble', 0.35], ['fire', 0.15]],
  },
  {
    id: 'angband',
    name: 'The Iron Hells',
    group: 'Dungeons',
    mood: 'Angband: the Shadow theme vast and slow on organ and choir; ancient and pitiless.',
    root: 46,
    scale: 'harmonicMinor',
    bpm: 76,
    meter: 4,
    chords: stretchChords(SHADOW_CHORDS.slice(0, 4), 2),
    motif: augmentMelody(melodyBars(SHADOW, 4), 2),
    answer: augmentMelody(melodyBars(SHADOW_ANSWER, 4), 2),
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.5 },
      { role: 'pad', inst: 'organ', vol: 0.4 },
      { role: 'pad', inst: 'choir', vol: 0.4 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.5, pattern: 'x..xx...' },
      { role: 'melody', inst: 'brass', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'choir', octave: 1, in: ['b', 'breath'] },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.35, every: 4 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x', vol: 0.5, from: 0.3 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.', vol: 0.45, from: 0.6 },
    ],
    space: 0.85,
    bright: 0.55,
    ambience: [['rumble', 0.4], ['cave', 0.4]],
  },
  {
    id: 'barrow',
    name: 'The Barrow-downs',
    group: 'Dungeons',
    mood: 'The Barrow-downs: the Chant of the dead in fog over old graves; cold voices that remember.',
    root: 50,
    scale: 'aeolian',
    bpm: 66,
    meter: 4,
    chords: CHANT_CHORDS,
    voicing: 'open',
    motif: CHANT,
    answer: CHANT_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'ooh', vol: 0.5 },
      { role: 'pad', inst: 'glass', octave: 1, vol: 0.2 },
      { role: 'arp', inst: 'harp', octave: 0, pattern: 'x.......', order: 'down', density: 0.7 },
      { role: 'melody', inst: 'voice', octave: 1 },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.15 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.......', vol: 0.35, from: 0.5 },
    ],
    space: 0.9,
    bright: 0.4,
    ambience: [['wind', 0.45], ['whispers', 0.2]],
  },
  {
    id: 'doom',
    name: 'The Crack of Doom',
    group: 'Dungeons',
    mood: 'Mount Doom: the Shadow theme blazing in fire-red harmony; heat, ruin and the last choice.',
    root: 41,
    scale: 'phrygianDominant',
    bpm: 80,
    meter: 4,
    chords: SHADOW_CHORDS,
    voicing: 'open',
    motif: SHADOW,
    answer: SHADOW_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.55 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.45 },
      { role: 'pad', inst: 'brass', vol: 0.28 },
      { role: 'bass', inst: 'cello', octave: 0, vol: 0.5, pattern: 'xx..xx..' },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x..x.', vol: 0.5 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'xoxoxoxo', vol: 0.35, from: 0.5 },
    ],
    space: 0.7,
    bright: 0.55,
    ambience: [['fire', 0.45], ['rumble', 0.5]],
  },
  {
    id: 'nether',
    name: 'The Nether Realm',
    group: 'Dungeons',
    mood: 'The Nether Realm: the Dream theme on celesta with nothing solid beneath it.',
    root: 51,
    scale: 'wholeTone',
    bpm: 84,
    meter: 3,
    chords: DREAM_CHORDS,
    motif: DREAM,
    answer: invertMelody(DREAM_ANSWER, 6),
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.4 },
      { role: 'pad', inst: 'glass', vol: 0.45 },
      { role: 'pad', inst: 'choir', vol: 0.3 },
      { role: 'melody', inst: 'celesta', octave: 1 },
      { role: 'bells', inst: 'glass', octave: 2, density: 0.25 },
    ],
    space: 0.95,
    echo: 0.45,
    bright: 0.6,
    ambience: [['void', 0.5], ['whispers', 0.12]],
  },
  {
    id: 'numenor',
    name: 'Drowned Númenor',
    group: 'Dungeons',
    mood: 'The drowned halls of Númenor: the Elven theme under green water, slow and far away.',
    root: 45,
    scale: 'dorian',
    bpm: 120,
    meter: 3,
    chords: stretchChords(ELVEN_CHORDS.slice(0, 4), 2),
    motif: augmentMelody(melodyBars(ELVEN, 4), 2),
    answer: augmentMelody(melodyBars(ELVEN_ANSWER, 4), 2),
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.45 },
      { role: 'pad', inst: 'choir', vol: 0.3, in: ['b', 'breath'] },
      { role: 'arp', inst: 'harp', octave: 0, pattern: 'x.o.o.', order: 'down', density: 0.6 },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.8, in: ['a'] },
      { role: 'melody', inst: 'strings', octave: 1, in: ['b', 'breath'] },
      { role: 'bells', inst: 'celesta', octave: 1, density: 0.25 },
    ],
    space: 0.85,
    echo: 0.3,
    bright: 0.35,
    ambience: [['sea', 0.3], ['drips', 0.3]],
  },
  {
    id: 'mandos',
    name: 'The Halls of Mandos',
    group: 'Dungeons',
    mood: 'The Halls of Mandos: the Chant on organ and choir; solemn and outside of time.',
    root: 50,
    scale: 'dorian',
    bpm: 60,
    meter: 4,
    chords: CHANT_CHORDS,
    motif: CHANT,
    answer: CHANT_ANSWER,
    layers: [
      { role: 'pad', inst: 'organ', vol: 0.35 },
      { role: 'pad', inst: 'choir', vol: 0.45 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.4, pattern: 'x.......' },
      { role: 'melody', inst: 'choir', octave: 1 },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.15 },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.3, every: 4 },
    ],
    space: 0.95,
    bright: 0.55,
    ambience: [['void', 0.2], ['cave', 0.2]],
  },
  {
    id: 'cirith-ungol',
    name: 'Shelob’s Lair',
    group: 'Dungeons',
    mood: 'Cirith Ungol: the Shadow theme in tight tunnels, with legs ticking in the dark.',
    root: 49,
    scale: 'phrygian',
    bpm: 92,
    meter: 4,
    chords: SHADOW_CHORDS,
    motif: staccatoMelody(SHADOW),
    answer: SHADOW_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.45 },
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'pad', inst: 'glass', octave: 2, vol: 0.18 },
      { role: 'arp', inst: 'harp', octave: 2, pattern: 'xoxoxoxoxoxoxoxo', order: 'random', density: 0.45, vol: 0.5 },
      { role: 'melody', inst: 'reed', octave: 0 },
      { role: 'perc', inst: 'wood', pattern: 'x.x.x.xx', vol: 0.2, density: 0.6 },
      { role: 'perc', inst: 'frame', pattern: 'x..ox..o', vol: 0.35, from: 0.45 },
    ],
    space: 0.6,
    bright: 0.45,
    ambience: [['drips', 0.4], ['whispers', 0.25]],
  },
  {
    id: 'heart',
    name: 'The Heart of the Earth',
    group: 'Dungeons',
    mood: 'The Heart of the Earth: the Deep theme crushed into locrian over a slow pulse.',
    root: 41,
    scale: 'locrian',
    bpm: 66,
    meter: 4,
    chords: DEEP_CHORDS,
    voicing: 'open',
    motif: DEEP,
    answer: DEEP_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.55 },
      { role: 'pad', inst: 'ooh', vol: 0.35 },
      { role: 'melody', inst: 'cello', octave: 0 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.x.....', vol: 0.45 },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.3, every: 4 },
    ],
    space: 0.85,
    bright: 0.35,
    ambience: [['rumble', 0.6], ['cave', 0.3]],
  },
  {
    id: 'void',
    name: 'The Void',
    group: 'Dungeons',
    mood: 'The Void: a few notes of the Dream theme, very far apart, in an endless dark.',
    root: 60,
    scale: 'wholeTone',
    bpm: 72,
    meter: 3,
    chords: stretchChords(DREAM_CHORDS.slice(0, 4), 2),
    motif: augmentMelody(melodyBars(DREAM, 4), 2),
    answer: augmentMelody(melodyBars(DREAM_ANSWER, 4), 2),
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.35 },
      { role: 'melody', inst: 'glass', octave: 1 },
      { role: 'bells', inst: 'celesta', octave: 1, density: 0.25 },
    ],
    space: 1,
    echo: 0.5,
    bright: 0.7,
    ambience: [['void', 0.5]],
  },
  {
    id: 'paths-dead',
    name: 'The Paths of the Dead',
    group: 'Dungeons',
    mood: 'The Paths of the Dead: the Chant as a march of oathbreakers who wait in the dark.',
    root: 43,
    scale: 'aeolian',
    bpm: 76,
    meter: 4,
    chords: CHANT_CHORDS,
    motif: CHANT,
    answer: CHANT_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.55 },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.6 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...x...', vol: 0.4 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: '..x...x.', vol: 0.4, from: 0.5 },
    ],
    space: 0.85,
    bright: 0.45,
    ambience: [['whispers', 0.3], ['wind', 0.35]],
  },
  {
    id: 'illusory',
    name: 'The Illusory Castle',
    group: 'Dungeons',
    mood: 'The Illusory Castle: the Dream theme in a music box that plays slightly wrong.',
    root: 58,
    scale: 'lydian',
    bpm: 120,
    meter: 3,
    chords: DREAM_CHORDS,
    motif: DREAM,
    answer: DREAM_ANSWER,
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.25 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'xoxoxo', order: 'updown', density: 0.85 },
      { role: 'melody', inst: 'celesta', octave: 1 },
      { role: 'bells', inst: 'glass', octave: 2, density: 0.2 },
    ],
    space: 0.7,
    echo: 0.35,
    bright: 0.85,
    ambience: [['void', 0.15]],
  },
  {
    id: 'maze',
    name: 'The Maze',
    group: 'Dungeons',
    mood: 'The Maze: the Deep theme as a ticking puzzle; corners that all look the same.',
    root: 50,
    scale: 'dorian',
    bpm: 108,
    meter: 4,
    chords: DEEP_CHORDS,
    motif: staccatoMelody(DEEP),
    answer: staccatoMelody(DEEP_ANSWER),
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.3 },
      { role: 'arp', inst: 'lute', octave: 1, pattern: 'xooo'.repeat(4), order: 'up', density: 0.85, vol: 0.6 },
      { role: 'melody', inst: 'reed', octave: 1 },
      { role: 'perc', inst: 'wood', pattern: 'x.o.x.o.', vol: 0.35, density: 0.9 },
    ],
    space: 0.4,
    bright: 0.7,
    ambience: [['cave', 0.25]],
  },
  {
    id: 'orc-cave',
    name: 'The Orc Warrens',
    group: 'Dungeons',
    mood: 'An orc cave: the Shadow theme bashed out on war drums, crude and close.',
    root: 40,
    scale: 'phrygian',
    bpm: 100,
    meter: 4,
    chords: SHADOW_CHORDS,
    voicing: 'open',
    motif: SHADOW,
    answer: staccatoMelody(SHADOW_ANSWER),
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'brass', vol: 0.22 },
      { role: 'bass', inst: 'cello', vol: 0.5, pattern: 'x.xx.x..' },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.ox', vol: 0.5 },
      { role: 'perc', inst: 'frame', pattern: 'oxoxoxox', vol: 0.3, from: 0.4 },
    ],
    space: 0.55,
    bright: 0.55,
    ambience: [['cave', 0.4], ['drips', 0.25]],
  },
  {
    id: 'moria',
    name: 'Drums in the Deep',
    group: 'Dungeons',
    mood: 'Moria: the Dwarf theme fallen silent and slow in vast dark halls; drums in the deep.',
    root: 38,
    scale: 'aeolian',
    bpm: 80,
    meter: 4,
    chords: stretchChords(DWARF_CHORDS.slice(0, 4), 2),
    voicing: 'open',
    motif: augmentMelody(melodyBars(DWARF, 4), 2),
    answer: augmentMelody(melodyBars(DWARF_ANSWER, 4), 2),
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'ooh', octave: 1, vol: 0.45 },
      { role: 'melody', inst: 'cello', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'horn', octave: 1, vol: 0.7, in: ['b'] },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.......', order: 'random', density: 0.6 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.....x.', vol: 0.4 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.x...', vol: 0.5, from: 0.4 },
    ],
    space: 0.95,
    bright: 0.4,
    ambience: [['cave', 0.5], ['drips', 0.35]],
  },
  {
    id: 'dol-guldur',
    name: 'The Hill of Sorcery',
    group: 'Dungeons',
    mood: 'Dol Guldur: the Shadow theme as a sorcerer’s incantation; cold ruin and creeping fear.',
    root: 47,
    scale: 'hungarianMinor',
    bpm: 72,
    meter: 4,
    chords: SHADOW_CHORDS,
    motif: SHADOW,
    answer: SHADOW_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', octave: -1, vol: 0.45 },
      { role: 'pad', inst: 'organ', vol: 0.28 },
      { role: 'pad', inst: 'choir', vol: 0.35, in: ['b', 'breath'] },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x..o..o.', order: 'random', density: 0.6 },
      { role: 'melody', inst: 'reed', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'choir', octave: 1, in: ['b'] },
      { role: 'bells', inst: 'bell', octave: 0, density: 0.15 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x', vol: 0.45, from: 0.4 },
    ],
    space: 0.8,
    bright: 0.45,
    ambience: [['whispers', 0.3], ['wind', 0.25]],
  },
  {
    id: 'water-cave',
    name: 'Ringing Waters',
    group: 'Dungeons',
    mood: 'A small water cave: the Deep theme turned pentatonic, every drop ringing.',
    root: 60,
    scale: 'pentatonic',
    bpm: 84,
    meter: 4,
    chords: [0, 3, 0, 4, 0, 3, 2, 4],
    motif: DEEP,
    answer: DEEP_ANSWER,
    layers: [
      { role: 'pad', inst: 'glass', vol: 0.35 },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'x.o.o.o.', order: 'updown', density: 0.6 },
      { role: 'melody', inst: 'celesta', octave: 1 },
    ],
    space: 0.85,
    echo: 0.4,
    bright: 0.75,
    ambience: [['drips', 0.5], ['water', 0.3]],
  },
  {
    id: 'sacred',
    name: 'The Holy Mountains',
    group: 'Dungeons',
    mood: 'The Sacred Land of Mountains: the Elven theme as a hymn in thin, bright air.',
    root: 52,
    scale: 'lydian',
    bpm: 80,
    meter: 3,
    chords: ELVEN_CHORDS,
    voicing: 'add9',
    motif: ELVEN,
    answer: ELVEN_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.3 },
      { role: 'pad', inst: 'choir', vol: 0.55 },
      { role: 'melody', inst: 'horn', octave: 0, vol: 0.75, in: ['a'] },
      { role: 'melody', inst: 'voice', octave: 1, in: ['b', 'breath'] },
      { role: 'bells', inst: 'bell', octave: 1, density: 0.25 },
    ],
    space: 0.85,
    echo: 0.25,
    bright: 0.85,
    ambience: [['wind', 0.5]],
  },
  {
    id: 'rhun',
    name: 'Riders of Rhûn',
    group: 'Dungeons',
    mood: 'The Land of Rhûn: the East theme at a gallop; strange rhythms, dust and horsemen.',
    root: 50,
    scale: 'phrygianDominant',
    bpm: 112,
    meter: 4,
    chords: EAST_CHORDS,
    motif: EAST,
    answer: EAST_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'strings', vol: 0.25 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.5, pattern: 'x.xx.xx.' },
      { role: 'melody', inst: 'lute', octave: 1, in: ['a'] },
      { role: 'melody', inst: 'reed', octave: 1, in: ['b', 'breath'] },
      { role: 'perc', inst: 'frame', pattern: 'x.ox.xo.', vol: 0.45, density: 0.9 },
      { role: 'perc', inst: 'shaker', pattern: 'oooooooo', vol: 0.25, density: 0.6, from: 0.3 },
    ],
    space: 0.4,
    bright: 0.75,
    ambience: [['wind', 0.35], ['sand', 0.2]],
  },
  {
    id: 'sandworm',
    name: 'The Sandworm’s Nest',
    group: 'Dungeons',
    mood: 'The Sandworm lair: the East theme slowed to a crawl; something vast moving beneath.',
    root: 42,
    scale: 'phrygian',
    bpm: 84,
    meter: 4,
    chords: stretchChords(EAST_CHORDS.slice(0, 4), 2),
    voicing: 'open',
    motif: augmentMelody(melodyBars(EAST, 4), 2),
    answer: augmentMelody(melodyBars(EAST_ANSWER, 4), 2),
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'strings', vol: 0.28 },
      { role: 'melody', inst: 'cello', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x..x....', vol: 0.4 },
      { role: 'perc', inst: 'shaker', pattern: 'o.o.o.o.', vol: 0.15, density: 0.5 },
    ],
    space: 0.6,
    bright: 0.5,
    ambience: [['sand', 0.4], ['rumble', 0.4]],
  },
  {
    id: 'temple',
    name: 'The Lost Temple',
    group: 'Dungeons',
    mood: 'A lost temple: the Chant as an old rite; incense, frame drums and a held breath.',
    root: 45,
    scale: 'dorian',
    bpm: 84,
    meter: 4,
    chords: CHANT_CHORDS,
    motif: CHANT,
    answer: CHANT_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.4 },
      { role: 'pad', inst: 'choir', vol: 0.45 },
      { role: 'melody', inst: 'flute', octave: 1 },
      { role: 'perc', inst: 'frame', pattern: 'x..ox.o.', vol: 0.4 },
      { role: 'perc', inst: 'gong', octave: -1, pattern: 'x...', vol: 0.3, every: 4 },
    ],
    space: 0.75,
    bright: 0.6,
    ambience: [['cave', 0.3], ['drips', 0.3]],
  },

  /* Quests */
  {
    id: 'thieves',
    name: 'Thieves in the Night',
    group: 'Quests',
    mood: 'Thieves in the night: the Hearth jig gone minor and tiptoeing; soft footfalls and quick hands.',
    root: 50,
    scale: 'dorian',
    bpm: 168,
    meter: 6,
    chords: HEARTH_CHORDS,
    motif: staccatoMelody(HEARTH),
    answer: staccatoMelody(HEARTH_ANSWER),
    layers: [
      { role: 'pad', inst: 'strings', vol: 0.25 },
      { role: 'bass', inst: 'cello', octave: -1, pattern: 'x.ox.o', vol: 0.5 },
      { role: 'melody', inst: 'lute', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'reed', octave: 1, vol: 0.8, in: ['b'] },
      { role: 'perc', inst: 'wood', pattern: 'x.ox.o', vol: 0.3, density: 0.8 },
    ],
    space: 0.35,
    bright: 0.7,
    ambience: [['crickets', 0.25]],
    floor: 0.2,
  },
  {
    id: 'nazgul',
    name: 'The Black Rider',
    group: 'Quests',
    mood: 'A Black Rider on the road: the Shadow theme over galloping hooves; a cold shriek, the urge to hide.',
    root: 40,
    scale: 'phrygian',
    bpm: 120,
    meter: 4,
    chords: SHADOW_CHORDS,
    voicing: 'open',
    motif: SHADOW,
    answer: SHADOW_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'choir', octave: 1, vol: 0.4 },
      { role: 'bass', inst: 'cello', vol: 0.5, pattern: 'x.xx.xx.' },
      { role: 'melody', inst: 'brass', octave: 1 },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.xx.xx.', vol: 0.45 },
      { role: 'bells', inst: 'glass', octave: 3, density: 0.2, from: 0.4 },
    ],
    space: 0.6,
    bright: 0.5,
    ambience: [['wind', 0.4]],
    floor: 0.35,
  },
  {
    id: 'trolls',
    name: 'The Trolls’ Glade',
    group: 'Quests',
    mood: 'The Trolls’ glade: the Dwarf theme stomped out by heavy, stupid feet.',
    root: 38,
    scale: 'locrian',
    bpm: 72,
    meter: 4,
    chords: DWARF_CHORDS,
    voicing: 'open',
    motif: DWARF,
    answer: DWARF_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.45 },
      { role: 'pad', inst: 'brass', vol: 0.25 },
      { role: 'bass', inst: 'cello', vol: 0.55, pattern: 'x...x..x' },
      { role: 'melody', inst: 'reed', octave: 0, in: ['a', 'breath'] },
      { role: 'melody', inst: 'brass', octave: 1, in: ['b'] },
      { role: 'perc', inst: 'drum', octave: -1, pattern: 'x...x..x', vol: 0.55 },
    ],
    space: 0.45,
    bright: 0.5,
    ambience: [['leaves', 0.25], ['wind', 0.2]],
    floor: 0.25,
  },
  {
    id: 'wolves',
    name: 'Wolves!',
    group: 'Quests',
    mood: 'Wolves! The Wild theme as a breathless chase through the dark.',
    root: 45,
    scale: 'aeolian',
    bpm: 192,
    meter: 6,
    chords: WILD_CHORDS,
    motif: WILD,
    answer: WILD_ANSWER,
    layers: [
      { role: 'drone', inst: 'drone', vol: 0.35 },
      { role: 'pad', inst: 'strings', vol: 0.35 },
      { role: 'bass', inst: 'cello', octave: -1, vol: 0.55, pattern: 'x.xx.x' },
      { role: 'arp', inst: 'harp', octave: 1, pattern: 'xoxoxo', order: 'up', density: 0.9, vol: 0.55 },
      { role: 'melody', inst: 'horn', octave: 1 },
      { role: 'perc', inst: 'frame', pattern: 'x.xx.x', vol: 0.45 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.....', vol: 0.45 },
    ],
    space: 0.5,
    bright: 0.6,
    ambience: [['wind', 0.3]],
    floor: 0.4,
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
    { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..x..x.', vol: 0.5 },
    { role: 'perc', inst: 'drum', octave: -1, pattern: 'x.x.x.xx', vol: 0.45, from: 0.4 },
  ];
  add(variant(t('khazad'), 'erebor', {
    name: 'The Lonely Mountain',
    group: 'Dungeons',
    mood: 'Erebor: the Dwarf theme in minor beneath the Mountain; gold, and the memory of the Dragon.',
    scale: 'aeolian',
    bpm: 84,
    layers: [
      ...t('khazad').layers.filter((l) => l.role !== 'perc'),
      { role: 'bells', inst: 'celesta', octave: 2, density: 0.25 },
      { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x...x...', vol: 0.45, from: 0.3 },
      { role: 'perc', inst: 'anvil', pattern: '......x.', vol: 0.2, density: 0.4, every: 2 },
    ],
    ambience: [['fire', 0.25], ['cave', 0.35], ['rumble', 0.15]],
  }));
  add(variant(t('bree'), 'hobbit', {
    name: 'A Hobbit’s Errand',
    group: 'Quests',
    mood: 'A hobbit errand: the Hearth jig, higher and faster; cheerful worry and muddy lanes.',
    root: 60,
    scale: 'ionian',
    bpm: 192,
  }));
  add(variant(t('barrow'), 'wight', {
    name: 'The Wight’s Grave',
    group: 'Quests',
    mood: 'The Wight’s grave: the Chant up close; cold hands in the dark.',
    scale: 'phrygian',
    floor: 0.3,
  }));
  add(variant(t('mirkwood'), 'spiders', {
    name: 'Spiders!',
    group: 'Quests',
    mood: 'Spiders of Mirkwood: webs everywhere, and they are hungry.',
    bpm: 156,
    floor: 0.3,
  }));
  add(variant(t('marsh'), 'poison', {
    name: 'Poisoned Water',
    group: 'Quests',
    mood: 'Poisoned water: the fen music in a whole-tone haze; sickly and wrong.',
    scale: 'wholeTone',
    bright: 0.4,
  }));
  add(variant(t('minas-anor'), 'narsil', {
    name: 'The Broken Sword',
    group: 'Quests',
    mood: 'The Broken Sword: an heirloom of kings waiting to be found.',
    scale: 'mixolydian',
    layers: [...t('minas-anor').layers, { role: 'bells', inst: 'celesta', octave: 2, density: 0.3 }],
  }));
  add(variant(t('gondolin'), 'eol', {
    name: 'The Dark Elf',
    group: 'Quests',
    mood: 'Eöl the Dark Elf: the Elven theme in harmonic minor; grace turned bitter and secret.',
    scale: 'harmonicMinor',
    bpm: 84,
    bright: 0.5,
    ambience: [['leaves', 0.3], ['whispers', 0.15]],
  }));
  add(variant(t('title'), 'nirnaeth', {
    name: 'Unnumbered Tears',
    group: 'Quests',
    mood: 'Nirnaeth Arnoediad: the hero’s theme in minor over battle drums; courage against hopeless odds.',
    scale: 'aeolian',
    bpm: 100,
    layers: [...t('title').layers.filter((l) => l.role !== 'perc'), ...battleDrums],
    ambience: [['wind', 0.3], ['fire', 0.15]],
    floor: 0.4,
  }));
  add(variant(t('gondolin'), 'gondolin-falls', {
    name: 'The Fall of Gondolin',
    group: 'Quests',
    mood: 'The fall of Gondolin: the Elven theme in minor as the white city burns; flight and grief.',
    scale: 'aeolian',
    bpm: 112,
    layers: [...t('gondolin').layers.filter((l) => l.role !== 'bells' && l.role !== 'perc'), ...battleDrums],
    ambience: [['fire', 0.4], ['wind', 0.2]],
    floor: 0.4,
  }));
  add(variant(t('minas-anor'), 'alliance', {
    name: 'The Last Alliance',
    group: 'Quests',
    mood: 'The Last Alliance: the hero’s fanfare as Elves and Men stand together before the Black Gate.',
    bpm: 100,
    layers: [...t('minas-anor').layers.filter((l) => l.role !== 'perc'), { role: 'pad', inst: 'choir', octave: 1, vol: 0.35 }, ...battleDrums],
    floor: 0.35,
  }));
  add(variant(t('erebor'), 'dragons', {
    name: 'Wings of Fire',
    group: 'Quests',
    mood: 'Dragons! The Dwarf theme in fiery harmonic minor; wings in the dark, heat and gold-lust.',
    scale: 'harmonicMinor',
    bpm: 108,
    floor: 0.4,
    ambience: [['fire', 0.45], ['rumble', 0.3]],
  }));
  add(variant(t('illusory'), 'haunted', {
    name: 'The Haunted House',
    group: 'Quests',
    mood: 'A haunted house: the music box in minor, playing to nobody.',
    scale: 'harmonicMinor',
    bpm: 100,
    bright: 0.6,
    ambience: [['whispers', 0.3], ['wind', 0.2]],
  }));
  add(variant(t('dol-guldur'), 'evil', {
    name: 'An Evil Place',
    group: 'Quests',
    mood: 'An evil place: the air itself is hostile.',
    floor: 0.25,
  }));
  add(variant(t('dol-guldur'), 'thrain', {
    name: 'Thráin’s Cell',
    group: 'Quests',
    mood: 'A prisoner in Dol Guldur: the Dwarf theme in chains under the Necromancer’s hill.',
    motif: DWARF,
    answer: DWARF_ANSWER,
    chords: DWARF_CHORDS,
    scale: 'harmonicMinor',
  }));
  add(variant(t('sacred'), 'apotheosis', {
    name: 'Apotheosis',
    group: 'Quests',
    mood: 'Falling toward apotheosis: the hero’s theme raised to a hymn; power beyond mortal measure.',
    meter: 4,
    bpm: 84,
    scale: 'lydian',
    chords: TALE_CHORDS,
    motif: TALE,
    answer: TALE_ANSWER,
    floor: 0.3,
  }));
  add(variant(t('ice'), 'helcaraxe', {
    name: 'The Grinding Ice',
    group: 'Dungeons',
    mood: 'The Helcaraxë: cold beyond bearing and cracking floes.',
    root: 47,
    ambience: [['wind', 0.8]],
    layers: [...t('ice').layers, { role: 'perc', inst: 'anvil', octave: 2, pattern: '....x.', vol: 0.15, density: 0.35 }],
  }));
  add(variant(t('forest'), 'old-forest', {
    name: 'The Old Forest',
    group: 'Dungeons',
    mood: 'The Old Forest: the Wild theme made merry; drowsy, ancient trees, and a song somewhere.',
    root: 53,
    scale: 'mixolydian',
    bpm: 160,
    layers: [
      ...t('forest').layers.filter((l) => l.role !== 'melody' && l.role !== 'perc'),
      { role: 'melody', inst: 'whistle', octave: 1, in: ['a', 'breath'] },
      { role: 'melody', inst: 'flute', octave: 1, in: ['b'] },
      { role: 'counter', inst: 'reed', octave: 0, vol: 0.45 },
      { role: 'perc', inst: 'frame', pattern: 'x.ox.o', vol: 0.35, density: 0.8 },
    ],
    ambience: [['leaves', 0.45], ['birds', 0.3]],
    swing: 0.08,
  }));
  return result;
}

/**
 * Average level of each theme in dBFS at the default volume (measured by
 * rendering it offline). Themes are brought most of the way to a common
 * level; a little of their natural contrast is kept.
 */
const MEASURED_DB: Readonly<Record<string, number>> = {
  title: -24.7, lament: -22.4, overworld: -28.2, bree: -28.1, gondolin: -24.1, 'minas-anor': -25.9, lorien: -27.3,
  khazad: -25.9, haven: -26.2, plains: -26.1, forest: -26.2, mountains: -27.8, marsh: -29.1, desert: -29.5, ice: -30.1,
  coast: -26.4, ashlands: -23.9, depths: -24.5, mirkwood: -27, mordor: -27.6, angband: -28.6, barrow: -28.7,
  doom: -27.7, nether: -30.9, numenor: -25.6, mandos: -29.2, 'cirith-ungol': -29, heart: -25, void: -30.3,
  'paths-dead': -27.1, illusory: -26.5, maze: -30.8, 'orc-cave': -28.3, moria: -22.8, 'dol-guldur': -28.6,
  'water-cave': -30.1, sacred: -30.4, rhun: -27.9, sandworm: -24.1, temple: -27.6, thieves: -29.3, nazgul: -26.7,
  trolls: -27.7, wolves: -25.9, erebor: -28.8, hobbit: -29, wight: -28.7, spiders: -27.2, poison: -28.4, narsil: -26.1,
  eol: -24.4, nirnaeth: -23.6, 'gondolin-falls': -22, alliance: -24.1, dragons: -27.4, haunted: -26.7, evil: -27.9,
  thrain: -28.6, apotheosis: -30.8, helcaraxe: -29.5, 'old-forest': -27.1,
};
const TARGET_DB = -27;

/** A theme's measured level in dBFS, if it has been measured. */
export function measuredLevel(id: string): number | undefined {
  return MEASURED_DB[id];
}

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
