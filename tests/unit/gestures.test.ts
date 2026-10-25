import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SWIPE_MIN_DISTANCE, SWIPE_RUN_DISTANCE, swipeFromDelta } from '../../web/src/input/gestures.ts';

describe('swipeFromDelta', () => {
  it('ignores short movements', () => {
    assert.equal(swipeFromDelta(SWIPE_MIN_DISTANCE - 1, 0), null);
    assert.equal(swipeFromDelta(0, 0), null);
  });

  it('maps the eight compass directions to keypad digits', () => {
    const d = 60;
    const cases: [number, number, string][] = [
      [d, 0, '6'],
      [d, -d, '9'],
      [0, -d, '8'],
      [-d, -d, '7'],
      [-d, 0, '4'],
      [-d, d, '1'],
      [0, d, '2'],
      [d, d, '3'],
    ];
    for (const [dx, dy, digit] of cases) {
      assert.equal(swipeFromDelta(dx, dy)?.digit, digit, `dx=${dx} dy=${dy}`);
    }
  });

  it('snaps near-horizontal swipes to the nearest direction', () => {
    assert.equal(swipeFromDelta(100, 20)?.digit, '6');
    assert.equal(swipeFromDelta(-100, -30)?.digit, '4');
  });

  it('runs on long swipes', () => {
    assert.equal(swipeFromDelta(50, 0)?.run, false);
    assert.equal(swipeFromDelta(SWIPE_RUN_DISTANCE, 0)?.run, true);
  });
});
