import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLowHealth, playerEvents } from '../../web/src/feel.ts';

const base = { name: 'Frodo', lev: 1, exp: 0, au: 100, chp: 20, mhp: 20, depth: 0, dungeon: 'Barrow-Downs', wild: 0 };

describe('game feel events', () => {
  it('reports nothing for the first state or a different character', () => {
    assert.deepEqual(playerEvents(null, base), []);
    assert.deepEqual(playerEvents({ ...base, name: 'Sam' }, { ...base, chp: 5 }), []);
  });

  it('reports damage as a fraction of maximum health', () => {
    assert.deepEqual(playerEvents(base, { ...base, chp: 15 }), [{ kind: 'hurt', fraction: 0.25 }]);
    assert.deepEqual(playerEvents(base, { ...base, chp: 25, mhp: 25 }), []);
  });

  it('says when blessings and sustained powers begin and fade, not ailments', () => {
    const doom = { id: 'shield', turns: 1, armour: -290, aura: 'counter' as const, dice: '1d10' };
    assert.deepEqual(playerEvents({ ...base, effects: [] }, { ...base, effects: [doom] }), [{ kind: 'blessing', ended: false, icon: '◈', names: ['Doom shield'] }]);
    assert.deepEqual(playerEvents({ ...base, effects: [doom, { id: 'blessed', turns: 1 }] }, { ...base, effects: [] }), [
      { kind: 'blessing', ended: true, icon: '◈', names: ['Doom shield', 'Blessed'] },
    ]);
    assert.deepEqual(playerEvents({ ...base, effects: [{ id: 'confused', turns: 1 }] }, { ...base, effects: [] }), []);
    assert.deepEqual(playerEvents({ ...base, effects: [doom] }, { ...base, effects: [{ ...doom, turns: 40 }] }), []);
    assert.deepEqual(playerEvents({ ...base, pray: 2 }, { ...base, pray: 1 }), []);
  });

  it('reports level-ups, gold and depth changes', () => {
    assert.deepEqual(playerEvents(base, { ...base, lev: 2, exp: 10, skillPoints: 5 }), [{ kind: 'levelup', level: 2, skillPoints: 5 }]);
    assert.deepEqual(playerEvents(base, { ...base, exp: 4 }), [{ kind: 'exp', amount: 4 }]);
    assert.deepEqual(playerEvents(base, { ...base, au: 112 }), [{ kind: 'gold', amount: 12 }]);
    assert.deepEqual(playerEvents(base, { ...base, au: 90 }), []);
    assert.deepEqual(playerEvents(base, { ...base, depth: 3 }), [{ kind: 'depth', place: 'Barrow-Downs', feet: 150, deeper: true, surface: 'land' }]);
    assert.deepEqual(playerEvents({ ...base, depth: 3 }, { ...base, area: 'Bree', inTown: true }), [
      { kind: 'depth', place: 'Bree', feet: 0, deeper: false, surface: 'town' },
    ]);
  });

  it('names the land on leaving the world map, and new areas of it', () => {
    const world = { ...base, wild: 1, area: 'World map' };
    assert.deepEqual(playerEvents(world, { ...base, area: 'Grasslands' }), [
      { kind: 'depth', place: 'Grasslands', feet: 0, deeper: false, surface: 'land' },
    ]);
    assert.deepEqual(playerEvents(base, world), [{ kind: 'depth', place: 'World map', feet: 0, deeper: false, surface: 'world' }]);
    assert.deepEqual(playerEvents({ ...base, area: 'Grasslands' }, { ...base, area: 'Bree', inTown: true }), [
      { kind: 'depth', place: 'Bree', feet: 0, deeper: false, surface: 'town' },
    ]);
    assert.deepEqual(playerEvents({ ...base, area: 'Grasslands' }, { ...base, area: 'Grasslands' }), []);
    assert.deepEqual(playerEvents(base, { ...base, area: 'Grasslands' }), []);
  });

  it('names the quest of a level arrived at, and a random quest\'s end there', () => {
    const random = { kind: 'princess' as const, foe: 'Cave orc', count: 5, slain: 0 };
    const quest = { id: 5, state: 'active' as const, title: 'Captured princess!', random };
    const onQuest = { ...base, depth: 3, quest };
    assert.deepEqual(playerEvents(base, onQuest), [{ kind: 'quest', title: 'Captured princess!', place: 'Barrow-Downs', feet: 150 }]);
    assert.deepEqual(playerEvents(onQuest, { ...onQuest, quest: { ...quest, random: { ...random, slain: 1 } } }), [{ kind: 'questProgress', slain: 1, count: 5 }]);
    const done = { ...quest, state: 'done' as const };
    assert.deepEqual(playerEvents({ ...onQuest, exp: 0 }, { ...onQuest, exp: 50, quest: done }), [
      { kind: 'exp', amount: 50 },
      { kind: 'questEnd', id: 5, title: 'Captured princess!', failed: false },
    ]);
    assert.deepEqual(playerEvents(onQuest, { ...onQuest, quest: { ...quest, state: 'failed' } }), [{ kind: 'questEnd', id: 5, title: 'Captured princess!', failed: true }]);
    /* Leaving a random quest's level only resets it; the next depth's random quest is another. */
    assert.deepEqual(playerEvents(onQuest, { ...base, depth: 4 }), [{ kind: 'depth', place: 'Barrow-Downs', feet: 200, deeper: true, surface: 'land' }]);
    assert.deepEqual(playerEvents(onQuest, { ...onQuest, depth: 8, quest: done }), [{ kind: 'depth', place: 'Barrow-Downs', feet: 400, deeper: true, surface: 'land' }]);
    assert.deepEqual(playerEvents({ ...base, depth: 2 }, { ...onQuest, quest: done }), [{ kind: 'depth', place: 'Barrow-Downs', feet: 150, deeper: true, surface: 'land' }]);
  });

  it('tells the end of a fixed quest wherever it comes', () => {
    const wolves = { id: 22, state: 'active' as const, title: 'Wolves!' };
    const necro = { id: 1, state: 'active' as const, title: 'Dol Guldur' };
    const own = { id: 22, own: 1, state: 'active' as const, title: 'Wolves!', lines: [] };
    const hunting = { ...base, depth: 15, quest: own, quests: [necro, wolves] };
    /* Still hunting, and left unfinished: nothing ends. */
    assert.deepEqual(playerEvents(hunting, { ...hunting, chp: 20 }), []);
    assert.deepEqual(playerEvents(hunting, { ...base, area: 'Lothlorien', quests: [necro, wolves] }), [
      { kind: 'depth', place: 'Lothlorien', feet: 0, deeper: false, surface: 'land' },
    ]);
    /* On its level. */
    const doneWolves = { ...wolves, state: 'done' as const };
    assert.deepEqual(playerEvents(hunting, { ...hunting, quest: { ...own, state: 'done' }, quests: [necro, doneWolves] }), [
      { kind: 'questEnd', id: 22, title: 'Wolves!', failed: false },
    ]);
    /* As the hero leaves it (Nirnaeth Arnoediad ends on its stairs; Eol, the invasion of Gondolin, the library and the old mage's quest fail there). */
    const nirnaeth = { id: 14, state: 'active' as const, title: 'Nirnaeth Arnoediad' };
    const trapped = { ...base, depth: 30, quest: { ...nirnaeth, own: 1 }, quests: [nirnaeth] };
    assert.deepEqual(playerEvents(trapped, { ...base, area: 'Grasslands', quests: [{ ...nirnaeth, state: 'done' }] }), [
      { kind: 'depth', place: 'Grasslands', feet: 0, deeper: false, surface: 'land' },
      { kind: 'questEnd', id: 14, title: 'Nirnaeth Arnoediad', failed: false },
    ]);
    assert.deepEqual(playerEvents(trapped, { ...base, area: 'Grasslands', quests: [{ ...nirnaeth, state: 'failed' }] }), [
      { kind: 'depth', place: 'Grasslands', feet: 0, deeper: false, surface: 'land' },
      { kind: 'questEnd', id: 14, title: 'Nirnaeth Arnoediad', failed: true },
    ]);
    /* Away from any quest's level: the Dark Horseman on the road, the Necromancer in Dol Guldur. */
    assert.deepEqual(playerEvents({ ...base, depth: 70, quests: [necro] }, { ...base, depth: 70, quests: [{ ...necro, state: 'done' }] }), [
      { kind: 'questEnd', id: 1, title: 'Dol Guldur', failed: false },
    ]);
    /* Gone from the hero's quests: a god's relic found, a bounty paid. */
    const god = { id: 29, state: 'active' as const, title: 'God quest' };
    assert.deepEqual(playerEvents({ ...base, depth: 4, quests: [god] }, { ...base, depth: 4, quests: [] }), [{ kind: 'questEnd', id: 29, title: 'God quest', failed: false }]);
    /* A quest taken, a reward collected, or no quests read: nothing ends. */
    assert.deepEqual(playerEvents({ ...base, quests: [] }, { ...base, quests: [wolves] }), []);
    assert.deepEqual(playerEvents({ ...base, quests: [doneWolves] }, { ...base, quests: [] }), []);
    assert.deepEqual(playerEvents({ ...base, quests: [wolves] }, base), []);
  });

  it('names a fixed quest\'s level by its quest, not the dungeon tome2 last kept', () => {
    const thieves = { id: 4, own: 1, state: 'active' as const, title: 'Thieves!', lines: ['There are thieves robbing my people!'] };
    assert.deepEqual(playerEvents({ ...base, area: 'Bree', inTown: true }, { ...base, depth: 5, quest: thieves }), [
      { kind: 'quest', title: 'Thieves!', place: '', feet: 250 },
    ]);
    assert.deepEqual(playerEvents({ ...base, depth: 5, quest: thieves }, { ...base, depth: 6, quest: { ...thieves, state: 'done' as const } }), [
      { kind: 'depth', place: 'Thieves!', feet: 300, deeper: true, surface: 'land' },
    ]);
  });

  it('flags low health', () => {
    assert.equal(isLowHealth({ chp: 5, mhp: 20 }), true);
    assert.equal(isLowHealth({ chp: 6, mhp: 20 }), false);
    assert.equal(isLowHealth({ chp: 0, mhp: 0 }), false);
  });
});
