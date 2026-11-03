import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loggedQuestText, questGroups, questLine } from '../../web/src/play/quests.ts';

const wolves = { id: 22, state: 'active' as const, title: 'Wolves!', level: 15, lines: ['There are wolves pestering my people!'] };
const thieves = { id: 4, state: 'done' as const, title: 'Thieves!', level: 5, lines: [] };
const nirnaeth = { id: 14, state: 'done' as const, title: 'Nirnaeth Arnoediad', level: 37, unclaimed: 1, lines: [] };
const eol = { id: 13, state: 'failed' as const, title: 'Eol the Dark Elf', level: 30, lines: [] };
const princess = { id: 5, state: 'done' as const, title: 'Captured princess!', depth: 3, random: { kind: 'princess' as const, foe: 'Cave orc', count: 5, slain: 5 } };
const sword = { id: 5, state: 'done' as const, title: 'Lost sword!', depth: 8, random: { kind: 'sword' as const, foe: 'Hill orc', count: 4, slain: 4 } };

describe('quest log', () => {
  it('lists quests under way, then those completed and failed: by danger level, then random quests by depth', () => {
    const groups = questGroups({ quests: [nirnaeth, wolves, eol, thieves], random: [sword, princess] });
    assert.deepEqual(groups.active.map((q) => q.title), ['Wolves!']);
    assert.deepEqual(groups.done.map((q) => q.title), ['Thieves!', 'Nirnaeth Arnoediad', 'Captured princess!', 'Lost sword!']);
    assert.deepEqual(groups.failed.map((q) => q.title), ['Eol the Dark Elf']);
  });

  it('says how dangerous a quest is, where a random one lay, and a reward still to claim', () => {
    assert.equal(questLine(wolves), 'Danger level 15');
    assert.equal(questLine(thieves), '');
    assert.equal(questLine(nirnaeth), 'Reward waiting');
    assert.equal(questLine(princess), '150 ft · 5 × Cave orc');
    assert.deepEqual(loggedQuestText(princess), ['You set free a princess held captive by 5 × Cave orc, 150 ft down.']);
    assert.deepEqual(loggedQuestText(sword), ["You won back an adventurer's sword from 4 × Hill orc, 400 ft down."]);
    assert.equal(questLine({ ...princess, random: { ...princess.random, count: 1, foe: 'Grip' } }), '150 ft · Grip');
    assert.deepEqual(loggedQuestText(wolves), []);
  });
});
