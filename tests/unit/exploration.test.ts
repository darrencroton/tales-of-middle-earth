import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LevelExploration } from '../../web/src/play/explore.ts';
import { LAYER_MONSTER, LAYER_OBJECT, type ObjectState } from '../../web/src/render/snapshot.ts';
import { snapshot } from './fixtures.ts';

function object(x: number, y: number, over: Partial<ObjectState> = {}): ObjectState {
  return { id: 1, name: 'a Dagger', ch: 124, attr: 1, x, y, ...over };
}

/** A 20×20 level with an object drawn at each of `cells`. */
function level(cells: readonly number[] = [], over: Parameters<typeof snapshot>[2] = {}) {
  const snap = snapshot(20, 20, over);
  for (const cell of cells) snap.layer[cell] = LAYER_OBJECT;
  return snap;
}

describe('level exploration', () => {
  it('keeps the anchor when exploring begins about where it last stopped', () => {
    const explore = new LevelExploration();
    explore.begin({ x: 1, y: 1 }, [], 20);
    assert.deepEqual(explore.anchor, { x: 1, y: 1 });
    explore.stopped({ x: 5, y: 5 }, { x: 10, y: 10 });
    explore.begin({ x: 12, y: 11 }, [], 20);
    assert.deepEqual(explore.anchor, { x: 5, y: 5 });
    explore.begin({ x: 14, y: 10 }, [], 20);
    assert.deepEqual(explore.anchor, { x: 14, y: 10 });
  });

  it('counts the items in view as seen when exploring begins, and forgets those spotted before', () => {
    const explore = new LevelExploration();
    explore.spotted.set(99, 'a Torch');
    explore.begin({ x: 0, y: 0 }, [object(3, 2), object(4, 2)], 20);
    assert.deepEqual([...explore.seenItems], [43, 44]);
    assert.equal(explore.spotted.size, 0);
  });

  it('spots new items, but not one underfoot or one already seen', () => {
    const explore = new LevelExploration();
    explore.seenItems.add(44);
    explore.noteSpotted([object(0, 0), object(3, 2, { name: 'a Ring' }), object(4, 2)], level([], { px: 0, py: 0 }));
    assert.deepEqual([...explore.spotted], [[43, 'a Ring']]);
  });

  it('names only the spotted items still lying there', () => {
    const explore = new LevelExploration();
    explore.spotted.set(43, 'a Ring');
    explore.spotted.set(44, 'a Dagger');
    assert.deepEqual(explore.spottedNames(level([44])), ['a Dagger']);
  });

  it('notes money in view, takes it out of the places done with and counts each change', () => {
    const explore = new LevelExploration();
    explore.skip.add(43);
    const snap = level([43, 44]);
    explore.noteGold([object(3, 2, { gold: 50 }), object(4, 2)], snap);
    assert.deepEqual([...explore.gold], [43]);
    assert.equal(explore.skip.has(43), false);
    assert.equal(explore.goldVersion, 1);
    explore.noteGold([object(3, 2, { gold: 50 })], snap);
    assert.equal(explore.goldVersion, 1);
    snap.layer[43] = LAYER_MONSTER;
    explore.noteGold([], snap);
    assert.deepEqual([...explore.gold], [43]);
    explore.noteGold([object(3, 2)], snap);
    assert.deepEqual([...explore.gold], []);
    assert.equal(explore.goldVersion, 2);
    explore.gold.add(43);
    snap.layer[43] = 0;
    explore.noteGold([], snap);
    assert.deepEqual([...explore.gold], []);
  });

  it('counts where the hero stands as visited only when something lies there', () => {
    const explore = new LevelExploration();
    explore.noteVisited(level([], { px: 2, py: 1 }));
    assert.equal(explore.skip.size, 0);
    explore.noteVisited(level([], { px: 2, py: 1, floorObjects: 1 }));
    assert.deepEqual([...explore.skip], [22]);
  });
});
