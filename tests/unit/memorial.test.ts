import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bareName, buildMemorial, dayOf, entryKey, findKiller, lastWords, memorialKey, skillValue } from '../../web/src/play/memorial.ts';
import type { MonsterState, PlayerState } from '../../web/src/render/snapshot.ts';

const monster = (id: number, name: string, x: number, y: number): MonsterState => ({
  id, name, ch: 112, attr: 2, x, y, hp: 10, maxhp: 10, asleep: 0, afraid: 0, unique: 0, status: -1, level: 12,
});

const player: PlayerState = {
  name: 'Hurin', race: 'Human', cls: 'Warrior', title: 'Swordsman', lev: 20, exp: 9000, au: 450, chp: -3, mhp: 180, csp: 0, msp: 0, csane: 50, msane: 50,
  speed: 0, food: 5000, depth: 30, dungeon: 'Angband', wild: 0, alwaysPickup: 0, dead: 1, diedFrom: 'a Cave troll', status: {},
};

describe('memorial', () => {
  it('matches the killer by name, ignoring the article, nearest first', () => {
    assert.equal(bareName('a Cave troll'), 'cave troll');
    assert.equal(bareName("Grip, Farmer Maggot's Dog"), "grip, farmer maggot's dog");
    const far = monster(1, 'Cave troll', 10, 10);
    const near = monster(2, 'Cave troll', 5, 6);
    assert.equal(findKiller('a Cave troll', [far, near, monster(3, 'Orc', 5, 5)], 5, 5), near);
    assert.equal(findKiller('starvation', [far], 5, 5), null);
    assert.equal(findKiller('', [far], 5, 5), null);
  });

  it('keeps the last messages oldest first, without blank lines', () => {
    const messages = [
      { text: 'You die.', color: 1 },
      { text: '   ', color: 1 },
      { text: 'The Cave troll hits you.', color: 4 },
      { text: 'You hit the Cave troll.', color: 1 },
    ];
    assert.deepEqual(lastWords(messages, ['#000', '#fff', '', '', '#f00'], 2), [
      { text: 'The Cave troll hits you.', colour: '#f00' },
      { text: 'You die.', colour: '#fff' },
    ]);
  });

  it('formats days, skills and keys', () => {
    assert.equal(dayOf(0), 1);
    assert.equal(dayOf(115200 * 3 + 5), 4);
    assert.equal(skillValue(12345), '12.345');
    assert.equal(skillValue(1000), '1.000');
    assert.equal(skillValue(-500), '−0.500');
    assert.equal(memorialKey({ name: 'Hurin', turn: 900 }), entryKey({ name: 'Hurin', turns: 900 }));
  });

  it('gathers the hero, their gear and their foe', () => {
    const troll = monster(7, 'Cave troll', 4, 5);
    const memorial = buildMemorial({
      player,
      character: {
        ready: 1, stats: [{ name: 'STR', use: ' 18/50', top: '18/50', drained: 0 }], god: 'Tulkas', exp: 9000, maxExp: 9000, nextExp: 10000,
        toHit: 12, toDam: 15, ac: 40, toAc: 10, blows: 3, shots: 1, infra: 20, maxDepth: 30, turn: 900,
        skills: [{ name: 'Combat', value: 5000 }, { name: 'Sword-mastery', value: 20000 }], abilities: ['Precision'],
      },
      inventory: {
        ready: 1, weight: 100, limit: 1000,
        pack: [{ i: 0, name: 'a Potion of Cure Light Wounds', tval: 71, number: 1, weight: 4, ch: 33, attr: 3, wear: 0, activate: 0, ins: '' }],
        equip: [
          { i: 24, part: 24, name: 'a Long Sword (2d5)', ch: 124, attr: 1, tval: 23, number: 1, weight: 130, wear: 1, activate: 0, ins: '' },
          { i: 25, part: 24, empty: 1 },
        ],
        floor: [],
      },
      messages: [{ text: 'You die.', color: 1 }],
      monsters: [troll],
      px: 4,
      py: 4,
      turn: 900,
      place: 'Angband',
      palette: ['#000', '#fff', '#0f0', '#00f'],
      slotName: (part) => (part === 24 ? 'Weapon' : 'Slot'),
      describe: (i) => [`About item ${i}.`],
      recall: (m) => [{ text: `${m.name} recall`, colour: '' }],
      now: new Date(Date.UTC(2026, 9, 28)),
    });
    assert.equal(memorial.feet, 1500);
    assert.equal(memorial.cause, 'a Cave troll');
    assert.deepEqual(memorial.stats, [{ name: 'STR', value: '18/50' }]);
    assert.deepEqual(memorial.skills.map((s) => s.name), ['Sword-mastery', 'Combat']);
    assert.deepEqual(memorial.equipment, [{ name: 'a Long Sword (2d5)', slot: 'Weapon', ch: 124, colour: '#fff', text: ['About item 24.'] }]);
    assert.equal(memorial.pack.length, 1);
    assert.equal(memorial.foe?.name, 'Cave troll');
    assert.deepEqual(memorial.foe?.recall, [{ text: 'Cave troll recall', colour: '' }]);
    assert.equal(memorial.date, '2026-10-28T00:00:00.000Z');
  });
});
