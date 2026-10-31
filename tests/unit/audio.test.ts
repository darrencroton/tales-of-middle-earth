import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  barStretch,
  Composer,
  fitRange,
  pickVoicing,
  pivotChord,
  planPiece,
  quarterTempo,
  RANGES,
  secondsPerBar,
  sombreness,
  transitionKind,
} from '../../web/src/audio/composer.ts';
import {
  attemptOutcome,
  launcherKind,
  spellTone,
  weaponKind,
  danger,
  doorCues,
  doorKinds,
  elementFromColour,
  freshMessages,
  intentCue,
  messageCues,
  newThreats,
  outcomeCue,
  playerCues,
} from '../../web/src/audio/cues.ts';
import { sceneFor, sceneKey, themeFor, type Place } from '../../web/src/audio/places.ts';
import { measuredLevel, PERCUSSION, THEME_LIST, themeById, themeGain } from '../../web/src/audio/themes.ts';
import {
  augmentMelody,
  chordDegrees,
  degreeToMidi,
  invertMelody,
  melodyBars,
  melodyBeats,
  padBars,
  parseMelody,
  Rng,
  SCALES,
  staccatoMelody,
  stretchChords,
  transposeMelody,
} from '../../web/src/audio/theory.ts';
import type { MonsterState } from '../../web/src/render/snapshot.ts';

const place = (patch: Partial<Place> = {}): Place => ({
  ready: 1,
  dungeon: 0,
  dungeonName: 'Wilderness',
  depth: 0,
  maxDepth: 0,
  wild: 0,
  town: 0,
  townDestroyed: 0,
  quest: 0,
  levelQuest: 0,
  levelName: '',
  terrain: 'grass',
  terrainIdx: 6,
  night: 0,
  stage: 0,
  lev: 1,
  ...patch,
});

const monster = (patch: Partial<MonsterState>): MonsterState => ({
  id: 1,
  name: 'Orc',
  ch: 111,
  attr: 7,
  y: 5,
  x: 5,
  hp: 10,
  maxhp: 10,
  asleep: 0,
  afraid: 0,
  unique: 0,
  status: -1,
  level: 5,
  ...patch,
});

describe('music theory', () => {
  it('maps scale degrees across octaves', () => {
    const dorian = SCALES.dorian;
    assert.equal(degreeToMidi(50, dorian, 0), 50);
    assert.equal(degreeToMidi(50, dorian, 5), 59);
    assert.equal(degreeToMidi(50, dorian, 7), 62);
    assert.equal(degreeToMidi(50, dorian, -1), 48);
    assert.equal(degreeToMidi(50, dorian, 2, 1), 54);
  });

  it('builds chords from stacked thirds', () => {
    assert.deepEqual(chordDegrees(3), [3, 5, 7]);
    assert.deepEqual(chordDegrees(0, 'open'), [0, 4]);
    assert.deepEqual(chordDegrees(1, 'add9'), [1, 3, 5, 9]);
  });

  it('parses melody notation', () => {
    const notes = parseMelody('0*2 2 | 4b*.5 r*1.5 7#');
    assert.deepEqual(
      notes.map((n) => [n.degree, n.accidental, n.beats]),
      [
        [0, 0, 2],
        [2, 0, 1],
        [4, -1, 0.5],
        [null, 0, 1.5],
        [7, 1, 1],
      ],
    );
    assert.equal(melodyBeats(notes), 6);
    assert.throws(() => parseMelody('0 x'));
  });

  it('transforms melodies', () => {
    assert.equal(transposeMelody('0 2*2 | r 4#*.5', 2), '2 4*2 | r 6#*0.5');
    assert.equal(invertMelody('4 5', 4), '4 3');
    assert.equal(augmentMelody('0 1*.5 | 2', 2), '0*2 1 2*2');
    assert.equal(staccatoMelody('0*2 1*.5'), '0 r 1*0.5');
    assert.equal(melodyBars('0 | 1 | 2 | 3', 2, 1), '1 | 2');
    assert.deepEqual(stretchChords([0, 4], 2), [0, 0, 4, 4]);
    assert.equal(padBars('0 1*2 | 2*4', 5), '0 1*2 r*2 | 2*4 r');
  });

  it('repeats a random sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const values = Array.from({ length: 5 }, () => a.next());
    assert.deepEqual(values, Array.from({ length: 5 }, () => b.next()));
    assert.ok(values.every((v) => v >= 0 && v < 1));
  });
});

describe('themes', () => {
  it('have unique ids and well-formed phrases', () => {
    const ids = new Set<string>();
    for (const theme of THEME_LIST) {
      assert.ok(!ids.has(theme.id), `duplicate ${theme.id}`);
      ids.add(theme.id);
      const bars = theme.chords.length * theme.meter;
      assert.ok(melodyBeats(parseMelody(theme.motif)) <= bars, `${theme.id} motif is longer than its progression`);
      if (theme.answer) assert.ok(melodyBeats(parseMelody(theme.answer)) <= bars, `${theme.id} answer is longer than its progression`);
      for (const text of [theme.motif, theme.answer ?? '']) {
        if (!text.includes('|')) continue;
        text.split('|').forEach((bar, i) => assert.equal(melodyBeats(parseMelody(bar)), theme.meter, `${theme.id} bar ${i + 1} fills its metre`));
      }
      assert.ok(theme.name.length > 2, `${theme.id} has a name`);
      assert.ok(quarterTempo(theme) >= 40 && quarterTempo(theme) <= 160, `${theme.id} tempo`);
      assert.ok((theme.rubato ?? 0) >= 0 && (theme.rubato ?? 0) <= 0.3, `${theme.id} rubato`);
      for (const layer of theme.layers) if (layer.delay !== undefined) assert.equal(layer.role, 'melody', `${theme.id} delays only melodies`);
      assert.ok(theme.layers.some((l) => l.role === 'pad' || l.role === 'drone'), `${theme.id} has a bed`);
      assert.ok(theme.layers.some((l) => l.role === 'melody'), `${theme.id} has a melody`);
      assert.ok(theme.mood.length > 10, `${theme.id} describes its mood`);
      for (const layer of theme.layers) {
        if (layer.role === 'perc') assert.ok(PERCUSSION.has(layer.inst), `${theme.id} perc layer uses ${layer.inst}`);
        else assert.ok(!PERCUSSION.has(layer.inst), `${theme.id} ${layer.role} uses ${layer.inst}`);
      }
    }
  });

  it('spread their tempi widely', () => {
    const tempi = THEME_LIST.map(quarterTempo).sort((a, b) => a - b);
    assert.ok(tempi[0] <= 50 && tempi[tempi.length - 1] >= 140, 'from a crawl to a gallop');
    const quartile = (q: number) => tempi[Math.floor((tempi.length - 1) * q)];
    assert.ok(quartile(0.75) - quartile(0.25) >= 30, 'the middle half is not bunched together');
  });

  it('cover every place the game maps to', () => {
    const scenes: Partial<Place>[] = [
      { wild: 1 },
      ...[1, 2, 3, 4, 5].map((town) => ({ town })),
      ...['grass', 'forest', 'mountain', 'swamp', 'desert', 'glacier', 'deep water', 'Mordor', 'Gondolin'].map((terrain) => ({ terrain })),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 99].map((dungeon) => ({ dungeon, depth: 3 })),
      ...Array.from({ length: 29 }, (_, i) => ({ quest: i + 1, depth: 2 })),
    ];
    for (const patch of scenes) {
      const scene = sceneFor('game', place(patch));
      assert.ok(THEME_LIST.some((t) => t.id === scene.base), `no theme ${scene.base} for ${JSON.stringify(patch)}`);
    }
  });
});

describe('places', () => {
  it('chooses music by view, town, terrain, dungeon and quest', () => {
    assert.equal(sceneFor('title', null).base, 'title');
    assert.equal(sceneFor('gameover', place()).base, 'lament');
    assert.equal(sceneFor('game', place({ wild: 1 })).base, 'overworld');
    assert.equal(sceneFor('game', place({ town: 1 })).base, 'bree');
    assert.equal(sceneFor('game', place({ town: 4 })).base, 'lorien');
    assert.equal(sceneFor('game', place({ terrain: 'forest' })).base, 'forest');
    assert.equal(sceneFor('game', place({ terrain: 'high mountain' })).base, 'mountains');
    assert.equal(sceneFor('game', place({ dungeon: 22, depth: 5 })).base, 'moria');
    assert.equal(sceneFor('game', place({ dungeon: 99, depth: 5 })).base, 'depths');
    assert.equal(sceneFor('game', place({ dungeon: 4, depth: 3, quest: 9 })).base, 'wight');
    assert.equal(sceneFor('game', place({ dungeon: 4, depth: 3, levelQuest: 5 })).base, 'captive');
    assert.equal(sceneFor('game', place({ dungeon: 18, depth: 30, levelQuest: 6 })).base, 'hobbit');
    assert.equal(sceneFor('game', place({ dungeon: 22, depth: 5, town: 7 })).base, 'haven');
  });

  it('marks ruined towns, night, and the last level of a dungeon', () => {
    assert.equal(sceneFor('game', place({ town: 2, townDestroyed: 1 })).ruined, true);
    assert.equal(sceneFor('game', place({ town: 1, night: 1 })).night, true);
    assert.equal(sceneFor('game', place({ dungeon: 23, depth: 4, night: 1 })).night, false);
    assert.equal(sceneFor('game', place({ dungeon: 23, depth: 20, maxDepth: 20 })).climax, true);
  });

  it('adapts themes to the story, time and ruin', () => {
    const overworld = (stage: number) => themeFor(sceneFor('game', place({ wild: 1, stage })));
    assert.equal(overworld(0).scale, 'dorian');
    assert.equal(overworld(1).scale, 'aeolian');
    assert.equal(overworld(2).scale, 'ionian');
    assert.equal(overworld(3).scale, 'lydian');
    const bree = themeFor(sceneFor('game', place({ town: 1 })));
    const breeNight = themeFor(sceneFor('game', place({ town: 1, night: 1 })));
    assert.ok(breeNight.bpm < bree.bpm);
    assert.ok(breeNight.ambience.some(([kind]) => kind === 'crickets'));
    assert.ok(!breeNight.ambience.some(([kind]) => kind === 'birds'));
    assert.ok(!breeNight.layers.some((l) => l.inst === 'whistle'));
    const ruin = themeFor(sceneFor('game', place({ town: 2, townDestroyed: 1 })));
    assert.equal(ruin.scale, 'aeolian');
    assert.ok(!ruin.layers.some((l) => l.role === 'perc'));
    const boss = themeFor(sceneFor('game', place({ dungeon: 23, depth: 20, maxDepth: 20 })));
    assert.ok((boss.floor ?? 0) >= 0.5);
  });

  it('changes the scene key only when the music should change', () => {
    const a = sceneKey(sceneFor('game', place({ dungeon: 22, depth: 3 })));
    assert.equal(a, sceneKey(sceneFor('game', place({ dungeon: 22, depth: 4 }))));
    assert.notEqual(a, sceneKey(sceneFor('game', place({ dungeon: 22, depth: 13 }))));
    assert.notEqual(a, sceneKey(sceneFor('game', place({ dungeon: 23, depth: 3 }))));
  });
});

describe('composer', () => {
  it('plans pieces that state the motif and fit the progression', () => {
    for (const theme of THEME_LIST) {
      const piece = planPiece(theme, new Rng(7));
      assert.equal(piece[0].kind, (theme.intro ?? 1) > 0 ? 'intro' : 'a');
      assert.ok(piece.some((s) => s.kind === 'a'));
      assert.ok(piece.every((s) => s.bars > 0));
      assert.ok(piece.every((s) => s.kind !== 'outro'), `${theme.id} ends without an outro`);
      const repeat = planPiece(theme, new Rng(7), false);
      assert.equal(repeat[0].kind, 'a', `${theme.id} repeats straight into the motif`);
    }
  });

  it('starts the title theme on its melody', () => {
    const title = themeById('title');
    const composer = new Composer(title, 3);
    const first = composer.plan(true)[0];
    assert.equal(first.kind, 'a');
    const notes = composer.bar(first, 0, 0, 0).filter((n) => n.role === 'melody');
    assert.ok(notes.some((n) => n.at === 0), 'melody on the first beat');
    assert.ok(notes.every((n) => n.beats <= 2), 'no long held notes in the call');
  });

  it('echoes the motif in breath sections', () => {
    const theme = themeById('bree');
    const composer = new Composer(theme, 3);
    const breath = { kind: 'breath' as const, bars: 4, variation: 0 };
    const melody = (bar: number) => composer.bar(breath, bar, bar, 0).filter((n) => n.role === 'melody');
    assert.ok(melody(0).length > 0);
    assert.equal(melody(1).length, 0);
  });

  it('leads into a new key through a fitting pivot chord', () => {
    const bree = themeById('bree');
    const mordor = themeById('mordor');
    const ice = themeById('ice');
    const road = themeById('overworld');
    const wolves = themeById('wolves');
    assert.equal(transitionKind(wolves), 'dominant');
    const toWolves = pivotChord(bree, wolves);
    assert.equal(toWolves.kind, 'dominant');
    const pcs = toWolves.chord.map((m) => (m - wolves.root + 120) % 12).sort((a, b) => a - b);
    assert.deepEqual(pcs, [5, 7, 11], 'a light V7: root, leading tone and seventh');
    assert.equal(pivotChord(mordor, bree).kind, 'plagal');
    const dreamy = pivotChord(road, ice);
    assert.equal(dreamy.kind, 'common');
    assert.ok(dreamy.chord.some((m) => m % 12 === road.root % 12), 'keeps the old tonic as a common tone');
    assert.equal(pivotChord(bree, themeById('lorien')).kind, 'plagal', 'no common tone: falls back to IV');
    for (const theme of THEME_LIST) {
      const pivot = pivotChord(themeById('title'), theme);
      assert.ok(pivot.chord.length >= 3 && pivot.bass >= 36 && pivot.bass <= 52, `${theme.id} pivot`);
      assert.ok(pivot.weight > 0 && pivot.weight <= 1, `${theme.id} pivot weight`);
    }
  });

  it('keeps transitions into and out of sombre places subtle', () => {
    const barrow = themeById('barrow');
    const bree = themeById('bree');
    assert.ok(sombreness(barrow) > sombreness(themeById('depths')));
    assert.ok(sombreness(themeById('depths')) > sombreness(bree));
    const intoGrave = pivotChord(bree, barrow);
    assert.equal(intoGrave.kind, 'veiled');
    const pcs = intoGrave.chord.map((m) => (m - barrow.root + 120) % 12).sort((a, b) => a - b);
    assert.deepEqual(pcs, [0, 2, 7], 'a suspended fifth without a leading tone');
    assert.equal(pivotChord(barrow, themeById('wolves')).kind, 'veiled', 'leaving a sombre place is just as quiet');
    assert.equal(pivotChord(bree, themeById('depths')).kind, 'minorPlagal');
    const depthsPcs = pivotChord(bree, themeById('depths')).chord.map((m) => (m - themeById('depths').root + 120) % 12).sort((a, b) => a - b);
    assert.deepEqual(depthsPcs, [0, 5, 8], 'iv into a dark key');
    assert.ok(intoGrave.weight < pivotChord(bree, themeById('plains')).weight, 'sombre pivots are quieter');
    assert.ok(pivotChord(barrow, bree).weight < pivotChord(themeById('plains'), bree).weight, 'so is the way out');
  });

  it('broadens breaths and the end of a piece with rubato', () => {
    const a = { kind: 'a' as const, bars: 8, variation: 0 };
    const breath = { kind: 'breath' as const, bars: 4, variation: 0 };
    assert.equal(barStretch({}, breath, 0, false), 1);
    assert.equal(barStretch({ rubato: 0.2 }, a, 3, false), 1);
    assert.ok(Math.abs(barStretch({ rubato: 0.2 }, breath, 0, false) - 1.2) < 1e-9);
    assert.ok(barStretch({ rubato: 0.2 }, a, 7, true) > barStretch({ rubato: 0.2 }, breath, 0, false));
    assert.equal(barStretch({ rubato: 0.2 }, a, 6, true), 1);
  });

  it('plays a delayed melody as a canon', () => {
    const base = themeById('mandos');
    const theme = { ...base, layers: [{ role: 'melody' as const, inst: 'choir' as const, octave: 1 }, { role: 'melody' as const, inst: 'ooh' as const, octave: 1, delay: 2 }] };
    const composer = new Composer(theme, 7);
    const section = { kind: 'a' as const, bars: 8, variation: 0 };
    const notes = composer.bar(section, 0, 0, 0);
    const lead = notes.filter((n) => n.inst === 'choir');
    const echo = notes.filter((n) => n.inst === 'ooh');
    assert.ok(lead.length > 0 && echo.length > 0);
    assert.equal(echo[0].at, 2);
    assert.equal(echo[0].midi % 12, lead[0].midi % 12);
  });

  it('writes playable notes for every theme at every intensity', () => {
    for (const theme of THEME_LIST) {
      const composer = new Composer(theme, 1234);
      let bar = 0;
      let notes = 0;
      for (const intensity of [0, 0.5, 1]) {
        for (const section of composer.plan()) {
          for (let b = 0; b < section.bars; b++) {
            for (const note of composer.bar(section, b, bar++, intensity)) {
              notes++;
              assert.ok(Number.isFinite(note.midi) && note.midi > 12 && note.midi < 110, `${theme.id} pitch ${note.midi}`);
              assert.ok(note.at >= 0 && note.at < theme.meter + 0.5, `${theme.id} timing ${note.at}`);
              assert.ok(note.beats > 0 && note.vel > 0 && note.vel <= 1, `${theme.id} note shape`);
              if (!PERCUSSION.has(note.inst)) {
                const [low, high] = RANGES[note.inst];
                assert.ok(note.midi >= low - 12 && note.midi <= high, `${theme.id} ${note.inst} range ${note.midi}`);
              }
            }
          }
        }
      }
      assert.ok(notes > 20, `${theme.id} plays`);
    }
  });

  it('is reproducible for a seed', () => {
    const theme = themeById('bree');
    const run = () => {
      const composer = new Composer(theme, 99);
      const piece = composer.plan();
      return piece.flatMap((section) => Array.from({ length: section.bars }, (_, b) => composer.bar(section, b, b, 0.2)));
    };
    assert.deepEqual(run(), run());
  });

  it('keeps strong melody notes off semitone clashes with the chord', () => {
    for (const theme of THEME_LIST) {
      const composer = new Composer(theme, 5);
      const scale = SCALES[theme.scale];
      const section = { kind: 'a' as const, bars: theme.chords.length, variation: 0 };
      for (let b = 0; b < section.bars; b++) {
        const pcs = composer.corePcs(composer.chordAt(section, b));
        for (const note of composer.bar(section, b, b, 0)) {
          if (note.role !== 'melody' || note.at !== 0) continue;
          const pc = note.midi % 12;
          const clash = pcs.some((c) => [1, 11].includes(Math.abs(c - pc) % 12));
          if (scale.length === 7) assert.ok(!clash, `${theme.id} bar ${b} melody clashes with its chord`);
        }
      }
    }
  });

  it('voices chords near the previous voicing', () => {
    const first = pickVoicing([2, 5, 9], [], 57);
    assert.equal(first.length, 3);
    const next = pickVoicing([0, 4, 7], first, 57);
    const moved = next.reduce((sum, m, i) => sum + Math.abs(m - (first[i] ?? m)), 0);
    assert.ok(moved <= 6, `voices moved ${moved} semitones`);
  });

  it('fits notes into instrument ranges and times bars', () => {
    assert.equal(fitRange(40, 'flute'), 64);
    assert.equal(fitRange(100, 'cello'), 64);
    assert.equal(secondsPerBar({ bpm: 60, meter: 4 }), 4);
  });
});

describe('sound cues', () => {
  const msgs = (texts: string[]) => texts.map((text) => ({ text, color: 1 }));

  it('finds new messages, including a repeated one', () => {
    const prev = { messageTotal: 10, messages: msgs(['You hit the orc.', 'older']) };
    assert.deepEqual(freshMessages(prev, { messageTotal: 12, messages: msgs(['You miss the orc.', 'The orc hits you.', 'You hit the orc.']) }), [
      'The orc hits you.',
      'You miss the orc.',
    ]);
    assert.deepEqual(freshMessages(prev, { messageTotal: 10, messages: msgs(['You hit the orc. (x2)', 'older']) }), ['You hit the orc.']);
    assert.deepEqual(freshMessages(null, prev), []);
  });

  it('hears combat, doors and discoveries in messages', () => {
    const ids = (text: string) => messageCues(text).map((c) => c.id);
    assert.deepEqual(ids('You hit the cave spider.'), ['hit']);
    assert.deepEqual(ids('It was a great hit!'), ['crit']);
    assert.deepEqual(ids('You miss Grip, Farmer Maggot\'s Dog.'), ['miss']);
    assert.deepEqual(ids('You have slain the cave spider.'), ['kill']);
    assert.deepEqual(ids('The jackal bites you.'), ['bite']);
    assert.deepEqual(ids('The wolf misses you.'), ['parry']);
    assert.deepEqual(ids('The cave orc hits you.'), ['hurt']);
    assert.deepEqual(ids('The kobold dies.'), ['kill']);
    assert.deepEqual(ids('The baby red dragon breathes fire.'), ['breath']);
    assert.equal(messageCues('The baby blue dragon breathes lightning.')[0].element, 'lightning');
    assert.deepEqual(ids('You hear a door burst open!'), ['distant-door']);
    assert.deepEqual(ids('You failed to pick the lock.'), ['door-locked']);
    assert.deepEqual(ids('You have found a secret door.'), ['secret']);
    assert.deepEqual(ids('You have a Flask of oil (c).'), ['pickup']);
    assert.deepEqual(ids('You have no more Flasks of oil (c).'), []);
    assert.deepEqual(ids('You feel much better.'), ['heal']);
    assert.deepEqual(ids('You die.'), ['death']);
    assert.deepEqual(ids('You see nothing there.'), []);
  });

  it('maps commands to the sound of doing them', () => {
    assert.equal(intentCue('q')?.id, 'quaff');
    assert.equal(intentCue('E')?.id, 'eat');
    assert.equal(intentCue('w')?.id, 'wield');
    assert.equal(intentCue('8'), null);
  });

  it('names the weapon, launcher and spell school behind a sound', () => {
    assert.equal(weaponKind(23), 'blade');
    assert.equal(weaponKind(24), 'axe');
    assert.equal(weaponKind(21), 'blunt');
    assert.equal(weaponKind(22), 'polearm');
    assert.equal(weaponKind(undefined), 'unarmed');
    assert.equal(launcherKind(19, 2), 'sling');
    assert.equal(launcherKind(19, 13), 'bow');
    assert.equal(launcherKind(19, 24), 'crossbow');
    assert.equal(launcherKind(15, 2), null);
    assert.equal(launcherKind(undefined, undefined), null);
    assert.equal(spellTone('Mana'), 'arcane');
    assert.equal(spellTone('Fire'), 'fire');
    assert.equal(spellTone('Water'), 'frost');
    assert.equal(spellTone('Air'), 'storm');
    assert.equal(spellTone('Udun'), 'shadow');
    assert.equal(spellTone('Nature'), 'nature');
    assert.equal(spellTone('Eru Iluvatar'), 'holy');
    assert.equal(spellTone('Music'), 'song');
    assert.equal(spellTone('Conveyance'), 'arcane');
  });

  it('tells a command that worked from one that failed or was refused', () => {
    assert.equal(outcomeCue('m', true, ['You cast it.'])?.id, 'cast');
    assert.equal(outcomeCue('m', true, ['You failed to get the spell off!'])?.id, 'fizzle');
    assert.equal(outcomeCue('a', true, ['You failed to use the wand properly.'])?.id, 'fizzle');
    assert.equal(outcomeCue('m', false, ['You cannot see!'])?.id, 'deny');
    assert.equal(outcomeCue('m', false, []), null);
    assert.equal(outcomeCue('m', false, ['Cancelled.']), null);
    assert.equal(outcomeCue('8', false, ['There is a wall in the way.']), null);
    assert.deepEqual(attemptOutcome(false, ['You do not have enough mana to use this power.']), { kind: 'refused', message: 'You do not have enough mana to use this power.' });
    assert.deepEqual(attemptOutcome(true, ['You failed to concentrate hard enough!']), { kind: 'failed', message: 'You failed to concentrate hard enough!' });
    assert.equal(attemptOutcome(true, ['The orc dies.']), null);
  });

  it('hears changes in the player', () => {
    const base = { name: 'Frodo', lev: 1, au: 100, chp: 20, mhp: 20, depth: 1, dungeon: 'Mirkwood', wild: 0, food: 5000, status: {} as Record<string, number> };
    const ids = (next: Partial<typeof base>, heard: string[] = [], store = false) =>
      playerCues(base, { ...base, ...next }, new Set(heard as never[]), store).map((c) => c.id);
    assert.deepEqual(ids({ depth: 2 }), ['stairs-down']);
    assert.deepEqual(ids({ depth: 0 }), ['stairs-up']);
    assert.deepEqual(ids({ wild: 1 }), ['travel']);
    assert.deepEqual(ids({ lev: 2 }), ['levelup']);
    assert.deepEqual(ids({ chp: 15 }), ['hurt']);
    assert.deepEqual(ids({ chp: 15 }, ['hurt']), []);
    assert.deepEqual(ids({ au: 150 }), ['gold']);
    assert.deepEqual(ids({ au: 50 }, [], true), ['buy']);
    assert.deepEqual(ids({ status: { poisoned: 5 } }), ['poisoned']);
    assert.deepEqual(playerCues({ ...base, status: { poisoned: 3 } }, base, new Set(), false).map((c) => c.id), ['cured']);
    assert.deepEqual(playerCues(null, base, new Set(), false), []);
  });

  it('hears doors opening and closing nearby', () => {
    const kinds = doorKinds(
      [
        { name: 'floor', flags: 0 },
        { name: 'open door', flags: 32 },
        { name: 'broken door', flags: 32 },
        { name: 'door', flags: 33 },
      ],
      32,
      1,
    );
    const before = new Uint8Array([3, 0, 0, 0, 3, 0, 0, 0, 1]);
    const after = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3]);
    const cues = doorCues(before, after, 3, 0, 0, kinds);
    assert.deepEqual(
      cues.map((c) => [c.id, c.distance]),
      [
        ['door-open', 0],
        ['door-bash', 0],
        ['door-close', 2],
      ],
    );
    assert.deepEqual(doorCues(before, after, 3, 0, 0, kinds, 1).length, 2);
  });

  it('rates danger by toughness, distance and health', () => {
    const player = { lev: 10, chp: 50, mhp: 50 };
    assert.equal(danger(player, [], 5, 5), 0);
    const weakFar = danger(player, [monster({ level: 2, x: 15 })], 5, 5);
    const toughNear = danger(player, [monster({ level: 30, x: 6 })], 5, 5);
    assert.ok(toughNear > weakFar);
    assert.ok(danger({ ...player, chp: 10 }, [monster({ level: 30, x: 6 })], 5, 5) > toughNear);
    assert.equal(danger(player, [monster({ status: 1, level: 50 })], 5, 5), 0);
  });

  it('announces uniques and much stronger foes once', () => {
    const prev = [monster({ id: 1 })];
    const next = [monster({ id: 1 }), monster({ id: 2, unique: 1 }), monster({ id: 3, level: 30 }), monster({ id: 4, level: 2 }), monster({ id: 5, unique: 1, level: 2 })];
    const found = newThreats(prev, next, 5, new Set());
    assert.deepEqual(
      found.unique.map((m) => m.id),
      [2],
    );
    assert.deepEqual(
      found.strong.map((m) => m.id),
      [3],
    );
    assert.equal(newThreats(prev, next, 5, new Set([2, 3])).unique.length, 0);
  });

  it('guesses a bolt’s element from its colour', () => {
    assert.equal(elementFromColour(4), 'fire');
    assert.equal(elementFromColour(11), 'lightning');
    assert.equal(elementFromColour(5), 'poison');
    assert.equal(elementFromColour(10), 'magic');
  });
});

describe('theme loudness', () => {
  it('has a measured level for every theme', () => {
    for (const theme of THEME_LIST) {
      const gain = themeGain(theme.id);
      assert.ok(gain >= 0.5 && gain <= 2, `${theme.id} gain ${gain}`);
      assert.notEqual(measuredLevel(theme.id), undefined, `${theme.id} has no measured level`);
    }
  });
});
