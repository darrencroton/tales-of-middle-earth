import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pinchRatio } from '../../web/src/input/gestures.ts';
import { keyDirection, nextIndex, type NavRect } from '../../web/src/ui/listnav.ts';

describe('pinch', () => {
  it('reports the spread relative to the start', () => {
    assert.equal(pinchRatio(100, 150), 1.5);
    assert.equal(pinchRatio(0, 150), 1);
  });
});

describe('list navigation', () => {
  const rect = (left: number, top: number, width = 100, height = 40): NavRect => ({ left, top, width, height });

  it('steps through a vertical list', () => {
    const list = [rect(0, 0), rect(0, 50), rect(0, 100)];
    assert.equal(nextIndex(list, 0, 'down'), 1);
    assert.equal(nextIndex(list, 2, 'down'), 2);
    assert.equal(nextIndex(list, 1, 'up'), 0);
    assert.equal(nextIndex(list, -1, 'down'), 0);
    assert.equal(nextIndex(list, -1, 'up'), 2);
    assert.equal(nextIndex(list, 1, 'last'), 2);
  });

  it('moves to the nearest item in the row below a grid', () => {
    const grid = [rect(0, 0), rect(110, 0), rect(220, 0), rect(0, 50), rect(110, 50)];
    assert.equal(nextIndex(grid, 1, 'down'), 4);
    assert.equal(nextIndex(grid, 2, 'down'), 4);
    assert.equal(nextIndex(grid, 4, 'up'), 1);
    assert.equal(nextIndex(grid, 1, 'right'), 2);
    assert.equal(nextIndex(grid, 0, 'left'), 0);
  });

  it('maps keys to directions', () => {
    assert.equal(keyDirection('ArrowDown'), 'down');
    assert.equal(keyDirection('Home'), 'first');
    assert.equal(keyDirection('a'), null);
  });
});
