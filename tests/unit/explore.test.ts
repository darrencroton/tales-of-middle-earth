import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Explore, nextStop, type ExplorePlan } from '../../web/src/play/explore.ts';
import { decodeRuns, encodeRuns, levelKey, mergeKnown, missingCells } from '../../web/src/play/mapmemory.ts';
import { approachTarget, inferredFloor } from '../../web/src/play/travel.ts';
import { fightingStyle, suggestedGear } from '../../web/src/play/items.ts';
import type { Material } from '../../web/src/render/materials.ts';
import { CAVE_MARK, LAYER_MONSTER, LAYER_OBJECT, LAYER_TERRAIN, type EquipSlot, type ItemState, type LevelSnapshot, type MonsterState } from '../../web/src/render/snapshot.ts';

const FLOOR = 1;
const WALL = 2;
const TREE = 3;
const materials = [
  undefined,
  { walkable: true, door: false },
  { walkable: false, door: false },
  { walkable: true, door: false, blocksLight: true },
] as unknown as Material[];

/**
 * '.' known floor, '#' known wall, '?' unknown, ',' unknown floor, '$' known floor with an item,
 * '@' player, 'T' known walkable thicket, '>' '<' 'F' known floor tiles named by the test.
 */
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
      feat[i] = ch === '#' ? WALL : ch === 'T' ? TREE : FLOOR;
      if (ch === ',') return;
      info[i] = CAVE_MARK;
      layer[i] = ch === '$' ? LAYER_OBJECT : LAYER_TERRAIN;
      if (ch === '@') [px, py] = [x, y];
    }),
  );
  return { width, height, px, py, feat, info, layer } as unknown as LevelSnapshot;
}

const frontier = (snap: LevelSnapshot, extra: Partial<ExplorePlan> = {}) => {
  const stop = nextStop(snap, materials, { skip: new Set(), isExit: () => false, ...extra });
  return stop ? { x: stop.x, y: stop.y, kind: stop.kind } : null;
};

describe('explore target', () => {
  it('walks to the nearest edge of unexplored space', () => {
    const snap = level(['#######', '#@....?', '#######']);
    assert.deepEqual(frontier(snap), { x: 5, y: 1, kind: 'frontier' });
  });

  it('collects items only for a hero who picks things up, and skips visited places', () => {
    const snap = level(['#######', '#@.$..?', '#######']);
    assert.deepEqual(frontier(snap), { x: 5, y: 1, kind: 'frontier' });
    assert.deepEqual(frontier(snap, { collectItems: true }), { x: 3, y: 1, kind: 'item' });
    assert.deepEqual(frontier(snap, { collectItems: true, skip: new Set([1 * 7 + 3]) }), { x: 5, y: 1, kind: 'frontier' });
  });

  it('reports nothing when everything reachable is known', () => {
    const snap = level(['#####', '#@..#', '#####']);
    assert.equal(frontier(snap), null);
  });

  it('fills the map outwards from where exploring began', () => {
    const snap = level(['###############', '#?.........@.?#', '###############']);
    assert.deepEqual(frontier(snap), { x: 12, y: 1, kind: 'frontier' });
    assert.deepEqual(frontier(snap, { anchor: { x: 3, y: 1 } }), { x: 2, y: 1, kind: 'frontier' });
    assert.deepEqual(frontier(snap, { anchor: { x: 8, y: 1 } }), { x: 12, y: 1, kind: 'frontier' });
  });
});

describe('explore', () => {
  const plan = (exit: number, extra: Partial<ExplorePlan> = {}): ExplorePlan => ({ skip: new Set(), isExit: (i) => i === exit, ...extra });

  it('heads straight for the way on once everything is explored, then stops there', () => {
    const snap = level(['######', '#@..>#', '######']);
    const exit = 1 * 6 + 4;
    const explore = new Explore(plan(exit));
    const ctx = { snap: { ...snap, atCommand: true, icky: false }, materials, monsters: [], hp: 10 };
    const step = explore.step(ctx);
    assert.equal(step.kind, 'keys');
    const there = { ...ctx, snap: { ...ctx.snap, px: 4 } };
    assert.deepEqual(explore.step(there), { kind: 'stop', reason: 'exit' });
    assert.deepEqual(new Explore(plan(exit)).step(there), { kind: 'stop', reason: 'exit' });
    assert.deepEqual(new Explore(plan(exit, { heading: 'up' })).step(there), { kind: 'stop', reason: 'exitUp' });
  });

  it('does not count walkable thickets that hide the view as unexplored edges', () => {
    const snap = level(['#####', '#@.T?', '#####']);
    assert.equal(frontier(snap), null);
  });

  it('moves its anchor to the hero once nothing is left within reach of the old one', () => {
    const snap = level(['#' + '.'.repeat(40) + '@.?#']);
    const explore = new Explore(plan(-1, { anchor: { x: 1, y: 0 } }));
    const ctx = { snap: { ...snap, atCommand: true, icky: false, floorObjects: 0 }, materials, monsters: [], hp: 10 };
    assert.equal(explore.step(ctx).kind, 'keys');
    assert.deepEqual(explore.anchor, { x: snap.px, y: snap.py });
  });

  it('walks over items to collect them without stopping', () => {
    const snap = level(['######', '#@$..?', '######']);
    const explore = new Explore(plan(-1, { collectItems: true }));
    const ctx = (px: number, floorObjects: number) => ({ snap: { ...snap, px, atCommand: true, icky: false, floorObjects }, materials, monsters: [], hp: 10 });
    assert.equal(explore.step(ctx(1, 0)).kind, 'keys');
    assert.equal(explore.step(ctx(2, 1)).kind, 'keys');
  });

  it('goes straight to the way on past fountains and shops once the level is explored', () => {
    const snap = level(['##########', '#F.@...F>#', '##########']);
    const exit = 1 * 10 + 8;
    assert.deepEqual(nextStop(snap, materials, plan(exit)), { x: 8, y: 1, kind: 'exit', mark: exit });
  });

  it('still heads for stairs where the hero once dropped an item', () => {
    const snap = level(['######', '#@..>#', '######']);
    const exit = 1 * 6 + 4;
    assert.deepEqual(nextStop(snap, materials, plan(exit, { skip: new Set([exit]) }))?.kind, 'exit');
  });

  it('stops for a hostile first seen as it chooses a new goal', () => {
    const before = level(['#########', '#@..?????', '#########']);
    const after = level(['#########', '#.@.....?', '#########']);
    const explore = new Explore(plan(-1));
    const ctx = (snap: LevelSnapshot, monsters: MonsterState[]) => ({ snap: { ...snap, atCommand: true, icky: false, floorObjects: 0 }, materials, monsters, hp: 10 });
    assert.equal(explore.step(ctx(before, [])).kind, 'keys');
    const orc = { id: 7, name: 'Cave orc', x: 6, y: 1, status: -1, asleep: 0 } as MonsterState;
    assert.deepEqual(explore.step(ctx(after, [orc])), { kind: 'stop', reason: 'monster', creature: 'Cave orc' });
  });

  it('says when a creature is all that stands in the way', () => {
    const snap = level(['#######', '#@.$..?', '#######']);
    snap.layer[1 * 7 + 3] = LAYER_MONSTER;
    const ctx = { snap: { ...snap, atCommand: true, icky: false, floorObjects: 0 }, materials, monsters: [], hp: 10 };
    assert.deepEqual(new Explore(plan(-1)).step(ctx), { kind: 'stop', reason: 'creatureInWay' });
  });
});

describe('travel approach', () => {
  it('goes to the goal when a known way leads there', () => {
    const snap = level(['#######', '#@....#', '#######']);
    assert.deepEqual(approachTarget(snap, materials, { x: 5, y: 1 }), { point: { x: 5, y: 1 }, exact: true });
  });

  it('goes as far as the known way leads towards an unknown place', () => {
    const snap = level(['#########', '#@..????#', '#########']);
    assert.deepEqual(approachTarget(snap, materials, { x: 7, y: 1 }), { point: { x: 3, y: 1 }, exact: false });
  });

  it('stops beside a wall instead of walking into it', () => {
    const snap = level(['#######', '#@...##', '#######']);
    assert.deepEqual(approachTarget(snap, materials, { x: 5, y: 1 }), { point: { x: 4, y: 1 }, exact: false });
  });

  it('has nowhere to go when nothing known gets closer', () => {
    const snap = level(['####', '#@#?', '####']);
    assert.equal(approachTarget(snap, materials, { x: 3, y: 1 }), null);
  });

  it('follows a mapped corridor whose floor was never seen', () => {
    const snap = level(['#######', '#@,,,.#', '#######']);
    assert.equal(inferredFloor(snap, materials, 3, 1), true);
    assert.deepEqual(approachTarget(snap, materials, { x: 5, y: 1 }), { point: { x: 5, y: 1 }, exact: true });
    const open = level(['???????', '#@,,,.#', '???????']);
    assert.equal(inferredFloor(open, materials, 3, 1), false);
  });
});

describe('map memory', () => {
  it('round-trips run-length masks', () => {
    const mask = new Uint8Array([0, 0, 1, 1, 1, 0, 1, 0, 0, 0]);
    assert.deepEqual(decodeRuns(encodeRuns(mask), mask.length), mask);
    assert.deepEqual(decodeRuns(encodeRuns(new Uint8Array(5).fill(1)), 5), new Uint8Array(5).fill(1));
    assert.equal(decodeRuns(encodeRuns(mask), mask.length + 1), null);
    assert.equal(decodeRuns('zz,x', 4), null);
  });

  it('merges remembered grids and finds those forgotten', () => {
    const mask = new Uint8Array(4);
    const info = new Uint16Array([CAVE_MARK, 0, CAVE_MARK, 0]);
    assert.equal(mergeKnown(mask, info), true);
    assert.equal(mergeKnown(mask, info), false);
    assert.deepEqual(missingCells(mask, new Uint16Array([0, 0, CAVE_MARK, 0])), [0]);
  });

  it('keys levels and areas of the land', () => {
    assert.equal(levelKey({ dungeon: 4, depth: 3, wild: 0 }), 'level:4:3');
    assert.equal(levelKey({ dungeon: 0, depth: 0, wild: 0, wx: 12, wy: 40 }), 'land:12,40');
    assert.equal(levelKey({ dungeon: 0, depth: 0, wild: 1, wx: 12, wy: 40 }), null);
    assert.equal(levelKey({ dungeon: 4, depth: 3, wild: 0, quest: 2 }), null);
  });
});

describe('explore stops when hurt', () => {
  it('keeps watching health across targets', () => {
    const snap = level(['#########', '#@.$....?', '#########']);
    const explore = new Explore({ skip: new Set(), isExit: () => false });
    const ctx = (px: number, hp: number) => ({ snap: { ...snap, px, atCommand: true, icky: false, floorObjects: 0 }, materials, monsters: [], hp });
    assert.equal(explore.step(ctx(1, 10)).kind, 'keys');
    assert.equal(explore.step(ctx(2, 10)).kind, 'keys');
    assert.deepEqual(explore.step(ctx(3, 9)), { kind: 'stop', reason: 'hurt' });
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
    assert.equal(suggestedGear({ pack: [torch, dagger], equip: [] }, { ...calm, wieldsWeapons: false })?.kind, 'light');
  });

  it('tells fighters, casters and those who do both apart', () => {
    const skill = (name: string, value: number, mod: number) => ({ name, value, mod });
    const warrior = [skill('Combat', 2000, 800), skill('Weaponmastery', 1000, 850)];
    const sorceror = [skill('Magic', 1000, 1000), skill('Sorcery', 1000, 700)];
    const mage = [skill('Combat', 1000, 200), skill('Weaponmastery', 700, 500), skill('Magic', 1000, 900)];
    const paladin = [skill('Combat', 1000, 900), skill('Prayer', 1000, 900)];
    const monk = [skill('Combat', 1000, 800), skill('Barehand-combat', 1000, 900), skill('Mindcraft', 1000, 500)];
    assert.deepEqual(fightingStyle(warrior), { weapons: true, magic: false });
    assert.deepEqual(fightingStyle(sorceror), { weapons: false, magic: true });
    assert.deepEqual(fightingStyle(mage), { weapons: false, magic: true });
    assert.deepEqual(fightingStyle(paladin), { weapons: true, magic: true });
    assert.deepEqual(fightingStyle(monk), { weapons: false, magic: true });
    assert.deepEqual(fightingStyle([]), { weapons: true, magic: true });
  });

  it('suggests healing when hurt and food when hungry', () => {
    const pack = [ration, potion];
    assert.equal(suggestedGear({ pack, equip: lit }, { ...calm, hurt: true, hungry: true })?.kind, 'heal');
    assert.equal(suggestedGear({ pack, equip: lit }, { ...calm, hungry: true })?.kind, 'eat');
    assert.equal(suggestedGear({ pack: [ration], equip: lit }, { ...calm, hurt: true }), null);
  });
});
