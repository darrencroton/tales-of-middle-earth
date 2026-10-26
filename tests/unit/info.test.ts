import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameApi } from '../../web/src/ui/api.ts';
import { describeCell } from '../../web/src/ui/info.ts';
import { CAVE_MARK, type GameState, type LevelSnapshot } from '../../web/src/render/snapshot.ts';

function api(hallucinating: number): GameApi {
  const snap = { width: 3, height: 1, px: 0, py: 0, info: new Uint16Array([CAVE_MARK, CAVE_MARK, CAVE_MARK]), feat: new Uint8Array([1, 1, 1]) };
  const state = {
    player: { status: { hallucinating } },
    monsters: [{ id: 1, name: 'Cave spider', x: 2, y: 0, hp: 5, maxhp: 5, asleep: 0, unique: 0, status: -2 }],
    objects: [],
  };
  return {
    snapshot: () => snap as unknown as LevelSnapshot,
    state: () => state as unknown as GameState,
    features: () => [{ name: 'nothing' }, { name: 'open floor' }],
  } as unknown as GameApi;
}

describe('describe cell', () => {
  it('names what is there', () => {
    const cell = describeCell(api(0), { x: 2, y: 0 })!;
    assert.equal(cell.text, 'You see a Cave spider (awake, unhurt) on open floor.');
    assert.equal(cell.monsters.length, 1);
  });

  it('hides creatures and items while hallucinating', () => {
    const cell = describeCell(api(5), { x: 2, y: 0 })!;
    assert.equal(cell.text, 'You cannot make out what is there.');
    assert.equal(cell.monsters.length, 0);
    assert.equal(describeCell(api(5), { x: 1, y: 0 })!.text, 'You see an open floor.');
  });
});
