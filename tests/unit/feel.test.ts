import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLowHealth, playerEvents } from '../../web/src/feel.ts';

const base = { name: 'Frodo', lev: 1, au: 100, chp: 20, mhp: 20, depth: 0, dungeon: 'Barrow-Downs', wild: 0 };

describe('game feel events', () => {
  it('reports nothing for the first state or a different character', () => {
    assert.deepEqual(playerEvents(null, base), []);
    assert.deepEqual(playerEvents({ ...base, name: 'Sam' }, { ...base, chp: 5 }), []);
  });

  it('reports damage as a fraction of maximum health', () => {
    assert.deepEqual(playerEvents(base, { ...base, chp: 15 }), [{ kind: 'hurt', fraction: 0.25 }]);
    assert.deepEqual(playerEvents(base, { ...base, chp: 25, mhp: 25 }), []);
  });

  it('reports level-ups, gold and depth changes', () => {
    assert.deepEqual(playerEvents(base, { ...base, lev: 2 }), [{ kind: 'levelup', level: 2 }]);
    assert.deepEqual(playerEvents(base, { ...base, au: 112 }), [{ kind: 'gold', amount: 12 }]);
    assert.deepEqual(playerEvents(base, { ...base, au: 90 }), []);
    assert.deepEqual(playerEvents(base, { ...base, depth: 3 }), [{ kind: 'depth', place: 'Barrow-Downs', feet: 150, deeper: true }]);
    assert.deepEqual(playerEvents({ ...base, depth: 3 }, base), [{ kind: 'depth', place: 'Town', feet: 0, deeper: false }]);
  });

  it('flags low health', () => {
    assert.equal(isLowHealth({ chp: 5, mhp: 20 }), true);
    assert.equal(isLowHealth({ chp: 6, mhp: 20 }), false);
    assert.equal(isLowHealth({ chp: 0, mhp: 0 }), false);
  });
});
