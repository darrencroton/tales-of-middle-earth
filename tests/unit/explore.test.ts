import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Explore, exploreTarget } from '../../web/src/play/explore.ts';
import { suggestedGear } from '../../web/src/play/items.ts';
import type { Material } from '../../web/src/render/materials.ts';
import { CAVE_MARK, LAYER_OBJECT, LAYER_TERRAIN, type EquipSlot, type ItemState, type LevelSnapshot } from '../../web/src/render/snapshot.ts';

const FLOOR = 1;
const WALL = 2;
const materials = [undefined, { walkable: true, door: false }, { walkable: false, door: false }] as unknown as Material[];

/** '.' known floor, '#' known wall, '?' unknown, '$' known floor with an item, '@' player. */
function level(rows: string[]): LevelSnapshot {
  const height = rows.length;
  const width = rows[0].length;
  const feat = new Uint8Array(width * height);
  const info = new Uint16Array(width * height);
  const layer = new Uint8Array(width * height);
  let px = 0;
  let py = 0;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * width + x;
      if (ch === '?') return;
      info[i] = CAVE_MARK;
      feat[i] = ch === '#' ? WALL : FLOOR;
      layer[i] = ch === '$' ? LAYER_OBJECT : LAYER_TERRAIN;
      if (ch === '@') [px, py] = [x, y];
    }),
  );
  return { width, height, px, py, feat, info, layer } as unknown as LevelSnapshot;
}

describe('explore target', () => {
  it('walks to the nearest edge of unexplored space', () => {
    const snap = level(['#######', '#@....?', '#######']);
    assert.deepEqual(exploreTarget(snap, materials, new Set()), { x: 5, y: 1 });
  });

  it('prefers a nearer item and skips visited places', () => {
    const snap = level(['#######', '#@.$..?', '#######']);
    assert.deepEqual(exploreTarget(snap, materials, new Set()), { x: 3, y: 1 });
    assert.deepEqual(exploreTarget(snap, materials, new Set([1 * 7 + 3])), { x: 5, y: 1 });
  });

  it('reports nothing when everything reachable is known', () => {
    const snap = level(['#####', '#@..#', '#####']);
    assert.equal(exploreTarget(snap, materials, new Set()), null);
  });
});

describe('explore', () => {
  it('heads for the way down once everything is explored, then stops there', () => {
    const snap = level(['######', '#@..>#', '######']);
    const exit = 1 * 6 + 4;
    const explore = new Explore(new Set(), (i) => i === exit);
    const ctx = { snap: { ...snap, atCommand: true, icky: false }, materials, monsters: [], hp: 10 };
    const step = explore.step(ctx);
    assert.equal(step.kind, 'keys');
    const there = { ...ctx, snap: { ...ctx.snap, px: 4 } };
    assert.deepEqual(explore.step(there), { kind: 'stop', reason: 'exit' });
    assert.deepEqual(new Explore(new Set(), (i) => i === exit).step(there), { kind: 'stop', reason: 'explored' });
  });
});

describe('suggested gear', () => {
  const dagger = { i: 0, name: 'a Dagger', tval: 23 } as ItemState;
  const torch = { i: 1, name: '3 Wooden Torches', tval: 39 } as ItemState;
  const ration = { i: 2, name: '5 Rations of Food', tval: 80 } as ItemState;
  const potion = { i: 3, name: 'a Potion of Cure Light Wounds', tval: 71 } as ItemState;
  const calm = { inDungeon: true, hurt: false, hungry: false };
  const armed = [{ i: 24, part: 24, name: 'a Sword', tval: 23 }] as EquipSlot[];
  const lit = [...armed, { i: 36, part: 36, name: 'a Lantern', tval: 39 }] as EquipSlot[];

  it('suggests a weapon, then a light below the town', () => {
    assert.equal(suggestedGear({ pack: [torch, dagger], equip: [] }, calm)?.kind, 'weapon');
    assert.equal(suggestedGear({ pack: [torch], equip: armed }, calm)?.kind, 'light');
    assert.equal(suggestedGear({ pack: [torch], equip: armed }, { ...calm, inDungeon: false }), null);
    assert.equal(suggestedGear({ pack: [torch], equip: lit }, calm), null);
  });

  it('suggests healing when hurt and food when hungry', () => {
    const pack = [ration, potion];
    assert.equal(suggestedGear({ pack, equip: lit }, { ...calm, hurt: true, hungry: true })?.kind, 'heal');
    assert.equal(suggestedGear({ pack, equip: lit }, { ...calm, hungry: true })?.kind, 'eat');
    assert.equal(suggestedGear({ pack: [ration], equip: lit }, { ...calm, hurt: true }), null);
  });
});
