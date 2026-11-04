import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bondName, companionOrder, companionsLine, orderRefusal, type Companion } from '../../web/src/play/companions.ts';
import { adventureDay, journal, killList, noteWhen, parseNotes, recallList, uniqueGroups, type Knowledge } from '../../web/src/play/knowledge.ts';

/* A notes file as tome2 writes it: its birth banner, dated notes (add_note) and session banners. */
const NOTES = [
  '',
  '================================================',
  'Elder the Hobbit Warrior',
  'Born on 2026-11-04 at 00:35:13',
  '================================================',
  '',
  'Turn                1   Town  : Off to see the world',
  'Turn           123456 Lev  3 U: Killed Grip, Farmer Maggot\'s dog',
  'Turn           234567 Lev 12 L: Reached level 10',
  'Turn           345678 Lev  7 U: Killed Bullroarer the Hobbit',
  'Turn           456789 Lev  9 A: Found The Phial of Galadriel',
  '',
  'Session end: 2026-11-04 at 01:00:00',
];

const race = (r: number, name: string, level: number) => ({ r, name, level, ch: 112, attr: 1 });

describe('knowledge', () => {
  it('reads the notes file: dated notes with their kind, the birth; session banners left out', () => {
    const notes = parseNotes(NOTES);
    assert.deepEqual(
      notes.map((n) => [n.kind, n.text]),
      [
        ['born', 'Elder the Hobbit Warrior is born.'],
        ['note', 'Off to see the world'],
        ['unique', "Killed Grip, Farmer Maggot's dog"],
        ['level', 'Reached level 10'],
        ['unique', 'Killed Bullroarer the Hobbit'],
        ['artifact', 'Found The Phial of Galadriel'],
      ],
    );
    assert.deepEqual([notes[1].turn, notes[1].depth, notes[3].depth], [1, 0, 12]);
    assert.equal(journal(NOTES)[0].text, 'Found The Phial of Galadriel');
  });

  it('dates a note by the day of the adventure and where it was written', () => {
    assert.equal(adventureDay(1), 1);
    assert.equal(adventureDay(10 * 11520 * 2), 3);
    assert.equal(noteWhen({ kind: 'note', text: '', turn: 1, depth: 0 }), 'Day 1 · on the surface');
    assert.equal(noteWhen({ kind: 'note', text: '', turn: 1, depth: 3 }), 'Day 1 · 150 ft');
    assert.equal(noteWhen({ kind: 'born', text: '' }), '');
  });

  it('lists uniques slain latest first, by the notes, then those at large as tome2 orders them', () => {
    const uniques = [
      { ...race(1, "Grip, Farmer Maggot's dog", 2), dead: 1 },
      { ...race(2, 'Smeagol', 3), dead: 0 },
      { ...race(3, 'Bullroarer the Hobbit', 10), dead: 1 },
      { ...race(4, 'Wormtongue, Agent of Saruman', 16), dead: 0 },
    ];
    const { slain, alive } = uniqueGroups({ uniques, notes: NOTES });
    assert.deepEqual(slain.map((u) => u.r), [3, 1]);
    assert.deepEqual(alive.map((u) => u.r), [2, 4]);
  });

  it('lists kills mightiest first and counts them; the recall dungeon comes first', () => {
    const kills: Knowledge['kills'] = [
      { ...race(1, 'Jackal', 1), count: 12, unique: 0 },
      { ...race(2, 'Cave orc', 7), count: 3, unique: 0 },
      { ...race(3, 'Bullroarer the Hobbit', 10), count: 1, unique: 1 },
    ];
    const { kills: listed, total } = killList({ kills });
    assert.deepEqual(listed.map((k) => k.r), [3, 2, 1]);
    assert.equal(total, 16);
    const recall = [
      { dungeon: 'Barrow-Downs', depth: 5, recall: 0 },
      { dungeon: 'Mirkwood', depth: 9, recall: 1 },
    ];
    assert.deepEqual(recallList({ recall }).map((d) => d.dungeon), ['Mirkwood', 'Barrow-Downs']);
  });
});

const creature = (id: number, status: number, dist: number): Companion => ({
  id,
  r: 35,
  name: 'Jackal',
  ch: 67,
  attr: 6,
  status,
  unique: 0,
  level: 1,
  hp: 8,
  maxhp: 8,
  x: 0,
  y: 0,
  dist,
  seen: 1,
  asleep: 0,
  stays: 0,
});

describe('companions', () => {
  it('lists companions, then pets, then allies, each nearest first', () => {
    const list = [creature(1, 3, 5), creature(2, 4, 9), creature(3, 2, 1), creature(4, 3, 2)];
    assert.deepEqual(companionOrder(list).map((c) => c.id), [2, 4, 1, 3]);
    assert.deepEqual(list.map(bondName), ['Pet', 'Companion', 'Ally', 'Pet']);
    assert.equal(companionsLine(list), '4 with you');
    assert.equal(companionsLine([]), 'No one with you');
  });

  it('refuses orders while the hero is confused, as tome2 does', () => {
    assert.equal(orderRefusal(true), 'You are too confused to give orders.');
    assert.equal(orderRefusal(false), null);
  });
});
