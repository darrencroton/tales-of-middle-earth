import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMAND_GROUPS, commandKeys, contextActions, situationalActions } from '../../web/src/play/actions.ts';
import { findPath, type TravelGrid } from '../../web/src/play/pathfinding.ts';
import { classifyPrompt, directionDigit, isAdjacent } from '../../web/src/play/prompts.ts';
import { TargetPicker, cursorMoves } from '../../web/src/play/targeting.ts';
import { Travel, travelGrid, type TravelContext } from '../../web/src/play/travel.ts';
import { FB_DOOR, FB_FLOOR, FB_NO_VISION, FB_NO_WALK, FB_WALL, buildMaterials } from '../../web/src/render/materials.ts';
import { CAVE_SEEN, LAYER_MONSTER, LAYER_TERRAIN, NO_EFFECT, type LevelSnapshot, type MonsterState } from '../../web/src/render/snapshot.ts';

const keys = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('prompt classification', () => {
  it('recognises tome2 prompts', () => {
    assert.equal(classifyPrompt(''), 'none');
    assert.equal(classifyPrompt('You feel hungry. -more-'), 'more');
    assert.equal(classifyPrompt('Really quit? [y/n] '), 'yesno');
    assert.equal(classifyPrompt("Direction ('*' to choose a target, Escape to cancel)? "), 'aim');
    assert.equal(classifyPrompt("Direction ('5' for target, '*' to re-target, Escape to cancel)? "), 'aim');
    assert.equal(classifyPrompt('Direction (Escape to cancel)? '), 'direction');
    assert.equal(classifyPrompt('(Inven: b-e, ESC) Wear/Wield which item?'), 'item');
    assert.equal(classifyPrompt('You see a Kobold.'), 'other');
  });
});

describe('directions', () => {
  it('maps deltas to keypad digits', () => {
    assert.equal(directionDigit(0, -1), '8');
    assert.equal(directionDigit(1, 1), '3');
    assert.equal(directionDigit(-5, 0), '4');
    assert.equal(directionDigit(0, 0), '5');
  });

  it('detects adjacency including diagonals', () => {
    assert.ok(isAdjacent(5, 5, 6, 6));
    assert.ok(!isAdjacent(5, 5, 5, 5));
    assert.ok(!isAdjacent(5, 5, 7, 5));
  });
});

function gridFrom(rows: string[]): TravelGrid {
  return {
    width: rows[0].length,
    height: rows.length,
    passable: (x, y) => rows[y][x] !== '#',
  };
}

describe('pathfinding', () => {
  it('finds the shortest 8-way path', () => {
    const path = findPath(gridFrom(['.....', '.....', '.....']), { x: 0, y: 0 }, { x: 4, y: 2 })!;
    assert.equal(path.length, 4);
    assert.deepEqual(path.at(-1), { x: 4, y: 2 });
  });

  it('routes around walls', () => {
    const grid = gridFrom(['.#...', '.#.#.', '...#.']);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    assert.ok(path);
    for (const p of path) assert.notEqual(grid.passable(p.x, p.y), false, `stepped on wall at ${p.x},${p.y}`);
  });

  it('returns null when unreachable and [] when already there', () => {
    assert.equal(findPath(gridFrom(['.#.', '.#.', '.#.']), { x: 0, y: 0 }, { x: 2, y: 2 }), null);
    assert.deepEqual(findPath(gridFrom(['..']), { x: 1, y: 0 }, { x: 1, y: 0 }), []);
  });

  it('allows an impassable goal such as a monster', () => {
    const grid = gridFrom(['..#']);
    assert.deepEqual(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 }), [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
});

const FEATURES = [
  { name: 'nothing', ch: 32, attr: 0, flags: 0 },
  { name: 'open floor', ch: 46, attr: 1, flags: FB_FLOOR },
  { name: 'granite wall', ch: 35, attr: 1, flags: FB_WALL | FB_NO_WALK | FB_NO_VISION },
  { name: 'door', ch: 43, attr: 7, flags: FB_DOOR | FB_NO_WALK | FB_NO_VISION },
];
const MATERIALS = buildMaterials(FEATURES);

function level(rows: string[], player: { x: number; y: number }): LevelSnapshot {
  const width = rows[0].length;
  const height = rows.length;
  const n = width * height;
  const feat = new Uint8Array(n);
  const layer = new Uint8Array(n).fill(LAYER_TERRAIN);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * width + x;
      feat[i] = ch === '#' ? 2 : ch === '+' ? 3 : 1;
      if (ch === 'k') layer[i] = LAYER_MONSTER;
    }),
  );
  return {
    inDungeon: true, icky: false, width, height, py: player.y, px: player.x, lightRadius: 1, depth: 1,
    wild: false, blind: false, hallucinating: false, panelRow: 0, panelCol: 0, rowMap: 1, colMap: 13,
    atCommand: true, turn: 1, floorObjects: 0,
    feat, info: new Uint16Array(n).fill(CAVE_SEEN), glyph: new Uint8Array(n), attr: new Uint8Array(n), layer,
    effect: new Uint8Array(n).fill(NO_EFFECT),
  };
}

const monster = (id: number, x: number, y: number, extra: Partial<MonsterState> = {}): MonsterState => ({
  id, name: 'kobold', ch: 107, attr: 1, x, y, hp: 5, maxhp: 5, asleep: 0, afraid: 0, unique: 0, status: -2, ...extra,
});

describe('travel', () => {
  const ctx = (snap: LevelSnapshot, monsters: MonsterState[] = [], hp = 10): TravelContext => ({ snap, materials: MATERIALS, monsters, hp });

  it('treats walls and visible monsters as blocking', () => {
    const grid = travelGrid(level(['.#k'], { x: 0, y: 0 }), MATERIALS);
    assert.equal(grid.passable(1, 0), false);
    assert.equal(grid.passable(2, 0), false);
    assert.equal(grid.passable(0, 0), true);
  });

  it('steps towards the goal and stops on arrival', () => {
    const snap = level(['.....'], { x: 0, y: 0 });
    const travel = new Travel({ x: 2, y: 0 }, ctx(snap));
    const first = travel.step(ctx(snap));
    assert.deepEqual(first.kind === 'keys' && first.keys, [92, ...keys(';6')]);
    snap.px = 2;
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'arrived' });
  });

  it('opens closed doors on the way', () => {
    const snap = level(['.+..'], { x: 0, y: 0 });
    const step = new Travel({ x: 3, y: 0 }, ctx(snap)).step(ctx(snap));
    assert.deepEqual(step.kind === 'keys' && step.keys, [92, ...keys('o6')]);
  });

  it('stops when a door stays shut after an attempt to open it', () => {
    const snap = level(['.+..'], { x: 0, y: 0 });
    const travel = new Travel({ x: 3, y: 0 }, ctx(snap));
    assert.equal(travel.step(ctx(snap)).kind, 'keys');
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'blocked' });
  });

  it('stops when hurt, blocked, or a new creature appears', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    let travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    travel.step(ctx(snap));
    assert.deepEqual(travel.step(ctx(snap, [], 8)), { kind: 'stop', reason: 'hurt' });

    travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    travel.step(ctx(snap));
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'blocked' });

    travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    assert.deepEqual(travel.step(ctx(snap, [monster(7, 5, 5)])), { kind: 'stop', reason: 'monster' });
  });

  it('ignores known distant or sleeping creatures and allies', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const known = [monster(1, 5, 0, { asleep: 1 }), monster(2, 1, 0, { status: 3 })];
    const travel = new Travel({ x: 3, y: 0 }, ctx(snap, known));
    assert.equal(travel.step(ctx(snap, known)).kind, 'keys');
  });

  it('stops when an awake hostile creature is close', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const known = [monster(1, 2, 0)];
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap, known));
    assert.deepEqual(travel.step(ctx(snap, known)), { kind: 'stop', reason: 'monster' });
  });

  it('stops when the engine is no longer waiting for a command', () => {
    const snap = level(['...'], { x: 0, y: 0 });
    const travel = new Travel({ x: 2, y: 0 }, ctx(snap));
    snap.atCommand = false;
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'interrupted' });
  });
});

describe('targeting', () => {
  it('moves a free cursor diagonally first', () => {
    assert.deepEqual(cursorMoves(2, -1), keys('96'));
    assert.deepEqual(cursorMoves(0, 0), []);
  });

  it('selects a cycled target when the cursor lands on it', () => {
    const picker = new TargetPicker({ x: 5, y: 5 }, 2);
    assert.deepEqual(picker.begin(), keys('*'));
    assert.deepEqual(picker.step({ x: 1, y: 1 }, { x: 0, y: 0 }, true), { kind: 'keys', keys: keys(' ') });
    assert.deepEqual(picker.step({ x: 5, y: 5 }, { x: 0, y: 0 }, true), { kind: 'keys', keys: keys('t') });
    assert.deepEqual(picker.step(null, { x: 0, y: 0 }, false), { kind: 'done' });
  });

  it('falls back to free targeting after cycling round', () => {
    const picker = new TargetPicker({ x: 3, y: 1 }, 1);
    picker.begin();
    assert.deepEqual(picker.step({ x: 9, y: 9 }, { x: 1, y: 1 }, true).kind, 'keys');
    const free = picker.step({ x: 9, y: 9 }, { x: 1, y: 1 }, true);
    assert.deepEqual(free, { kind: 'keys', keys: keys('p66t') });
  });

  it('fails if the targeting interface did not open', () => {
    const picker = new TargetPicker({ x: 3, y: 1 }, 0);
    picker.begin();
    assert.deepEqual(picker.step(null, { x: 0, y: 0 }, false), { kind: 'fail' });
  });
});

describe('actions', () => {
  it('prefixes commands with a keymap bypass', () => {
    assert.deepEqual(commandKeys({ command: 'R', then: '&\r' }), [92, ...keys('R&\r')]);
    for (const group of COMMAND_GROUPS) for (const c of group.commands) assert.ok(c.command.length >= 1);
  });

  it('offers situational actions for what is underfoot', () => {
    assert.deepEqual(situationalActions('down staircase', 0).map((a) => a.id), ['descend']);
    assert.deepEqual(situationalActions('up staircase', 2).map((a) => a.id), ['pickup', 'ascend']);
    assert.deepEqual(situationalActions('open floor', 0), []);
  });

  it('picks up with the key that matches the always_pickup option', () => {
    const pickup = (always: boolean) => situationalActions('open floor', 1, always)[0].effect;
    assert.deepEqual(pickup(false), { kind: 'keys', keys: [92, ...keys('g')] });
    assert.deepEqual(pickup(true), { kind: 'keys', keys: [92, ...keys(',')] });
    const sheet = COMMAND_GROUPS.flatMap((g) => g.commands).find((c) => c.pickup)!;
    assert.deepEqual(commandKeys(sheet, true), [92, ...keys(',')]);
    assert.deepEqual(commandKeys(sheet, false), [92, ...keys('g')]);
  });

  it('adapts to prompts and the command state', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false };
    assert.deepEqual(contextActions({ ...base, prompt: 'more' }).map((a) => a.id), ['continue', 'skip', 'menu']);
    assert.ok(contextActions({ ...base, prompt: 'yesno' }).some((a) => a.id === 'yes'));
    assert.ok(contextActions({ ...base, prompt: 'aim' }).some((a) => a.id === 'nearest'));
    const command = contextActions({ ...base, prompt: 'none' }).map((a) => a.id);
    assert.ok(command.includes('inventory') && command.includes('commands') && command.at(-1) === 'menu');
    assert.deepEqual(
      contextActions({ ...base, mode: 'title', atCommand: false, prompt: 'none' }).map((a) => a.id),
      ['escape', 'enter', 'keyboard', 'menu'],
    );
    assert.deepEqual(contextActions({ ...base, mode: 'overlay', atCommand: false, prompt: 'none' }).map((a) => a.id), ['escape', 'up', 'down', 'menu']);
    assert.deepEqual(contextActions({ ...base, mode: 'overlay', atCommand: false, prompt: 'none', listShown: true }).map((a) => a.id), ['escape', 'menu']);
    assert.deepEqual(contextActions({ ...base, prompt: 'yesno', cardShown: true }).map((a) => a.id), ['menu']);
    assert.ok(contextActions({ ...base, mode: 'overlay', atCommand: false, prompt: 'none', screen: 'skills' }).some((a) => a.id === 'raise'));
  });

  it('opens native views for items, looking and the level map', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const inventory = contextActions(base).find((a) => a.id === 'inventory');
    assert.deepEqual(inventory?.effect, { kind: 'native', view: 'inventory' });
    assert.deepEqual(contextActions({ ...base, looking: true }).map((a) => a.id), ['lookdone']);
    assert.deepEqual(contextActions({ ...base, overview: true }).map((a) => a.id), ['overviewdone']);
    const sheet = COMMAND_GROUPS.flatMap((g) => g.commands);
    assert.equal(sheet.find((c) => c.label === 'Inventory')?.native, 'inventory');
    assert.equal(sheet.find((c) => c.label === 'Look')?.native, 'look');
  });

  it('recognises quantity and typed-text prompts', () => {
    assert.equal(classifyPrompt('Quantity (1-6): 1'), 'quantity');
    assert.equal(classifyPrompt('Inscription: ', true), 'text');
    assert.equal(classifyPrompt('Inscription: '), 'other');
    assert.equal(classifyPrompt('Jump to level? ', true), 'other');
    assert.equal(classifyPrompt('Select a skill (a-98), @ to select by name, +/- to scroll:', true), 'item');
  });

  it('recognises yes/no prompts with extra answers', () => {
    assert.equal(classifyPrompt('Buy 2 Wooden Torches? [y/n/RET/ESC]'), 'yesno');
  });
});
