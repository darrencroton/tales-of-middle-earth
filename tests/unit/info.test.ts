import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameApi } from '../../web/src/ui/api.ts';
import { describeCell, questParagraphs } from '../../web/src/ui/info.ts';
import type { GameState, GridState, LevelSnapshot } from '../../web/src/render/snapshot.ts';

function api(hallucinating: number): GameApi {
  const snap = { width: 4, height: 1, px: 0, py: 0 };
  const state = {
    player: { status: { hallucinating } },
    monsters: [{ id: 1, name: 'Cave spider', x: 2, y: 0, hp: 5, maxhp: 5, asleep: 0, unique: 0, status: -2 }],
  };
  const grids: Record<number, GridState> = {
    0: { known: 1, view: 1, name: 'grass', objects: [] },
    1: { known: 1, view: 0, name: 'a way to the Mirkwood Forest.', objects: [{ id: 7, name: '3 Flasks of oil', ch: 33, attr: 11 }] },
    2: { known: 1, view: 1, name: 'open floor', objects: [] },
    3: { known: 0, objects: [] },
  };
  return {
    snapshot: () => snap as unknown as LevelSnapshot,
    state: () => state as unknown as GameState,
    engine: { grid: (x: number) => grids[x] },
  } as unknown as GameApi;
}

describe('describe cell', () => {
  it('names the terrain and what is there, and how it is known', () => {
    const here = describeCell(api(0), { x: 0, y: 0 })!;
    assert.deepEqual([here.title, here.note, here.player], ['Grass', 'here', true]);
    const spider = describeCell(api(0), { x: 2, y: 0 })!;
    assert.deepEqual([spider.title, spider.note, spider.monsters.length], ['Open floor', 'view', 1]);
    const remembered = describeCell(api(0), { x: 1, y: 0 })!;
    assert.deepEqual([remembered.title, remembered.note], ['Way to the Mirkwood Forest', 'remembered']);
    assert.deepEqual(remembered.objects, [{ id: 7, name: '3 Flasks of oil', ch: 33, attr: 11, x: 1, y: 0 }]);
    const unknown = describeCell(api(0), { x: 3, y: 0 })!;
    assert.deepEqual([unknown.title, unknown.note, unknown.known], ['Unexplored', 'unknown', false]);
  });

  it('hides creatures and items while hallucinating', () => {
    const cell = describeCell(api(5), { x: 2, y: 0 })!;
    assert.equal(cell.blurred, true);
    assert.equal(cell.monsters.length, 0);
    const items = describeCell(api(5), { x: 1, y: 0 })!;
    assert.deepEqual([items.blurred, items.objects.length], [true, 0]);
    assert.equal(describeCell(api(5), { x: 0, y: 0 })!.blurred, false);
  });
});

describe('quest of a level', () => {
  it('says what a random quest asks in our words, with the creatures slain', () => {
    const quest = (kind: 'princess' | 'sword', count: number, slain = 0) => ({ id: 5, state: 'active' as const, title: '', random: { kind, foe: 'Cave orc', count, slain } });
    assert.deepEqual(questParagraphs(quest('princess', 5, 2)), [
      'A princess is held captive on this level. Defeat her guards to set her free: 5 × Cave orc.',
      'Slain: 2 of 5.',
    ]);
    assert.equal(questParagraphs(quest('princess', 1))[0], 'A princess is held captive on this level by Cave orc. Defeat her captor to set her free.');
    assert.equal(questParagraphs(quest('sword', 12))[0], "An adventurer's sword was taken by creatures roaming this level. Defeat them all to win it back: 12 × Cave orc.");
  });

  it("joins a fixed quest's description, which tome2 wraps at 80 columns", () => {
    const lines = ['There are thieves robbing my people! They live in a small', 'burrow outside the city walls.'];
    assert.deepEqual(questParagraphs({ id: 4, state: 'active', title: 'Thieves!', lines }), [
      'There are thieves robbing my people! They live in a small burrow outside the city walls.',
    ]);
  });
});
