import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMAND_GROUPS, commandGroups, commandKeys, contextActions, contextualAction, pickupCommand, speedAction, transitionUnderfoot, waitCommand } from '../../web/src/play/actions.ts';
import { findPath, type TravelGrid } from '../../web/src/play/pathfinding.ts';
import { classifyPrompt, directionDigit, isAdjacent } from '../../web/src/play/prompts.ts';
import { TargetPicker, cursorMoves } from '../../web/src/play/targeting.ts';
import { approachTarget, FAR_WALK_STEPS, goAction, isKnown, pushPast, stepTowards, STOP_MESSAGES, stopMessage, tapAction, Travel, travelGrid, type StopContext, type TravelContext } from '../../web/src/play/travel.ts';
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

describe('staying still', () => {
  it('waits without picking up, whichever way always_pickup is set', () => {
    assert.equal(waitCommand(false), ',');
    assert.equal(waitCommand(true), 'g');
    assert.notEqual(waitCommand(false), pickupCommand(false));
    assert.notEqual(waitCommand(true), pickupCommand(true));
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
    atCommand: true, turn: 1, floorObjects: 0, heroActing: false,
    feat, info: new Uint16Array(n).fill(CAVE_SEEN), glyph: new Uint8Array(n), attr: new Uint8Array(n), layer,
    effect: new Uint8Array(n).fill(NO_EFFECT),
  };
}

const monster = (id: number, x: number, y: number, extra: Partial<MonsterState> = {}): MonsterState => ({
  id, name: 'kobold', ch: 107, attr: 1, x, y, hp: 5, maxhp: 5, asleep: 0, afraid: 0, unique: 0, status: -2, view: 1, target: 1, ...extra,
});

describe('travel', () => {
  const ctx = (snap: LevelSnapshot, monsters: MonsterState[] = [], hp = 10): TravelContext => ({ snap, materials: MATERIALS, monsters, hp });

  it('treats walls and visible monsters as blocking', () => {
    const grid = travelGrid(level(['.#k'], { x: 0, y: 0 }), MATERIALS);
    assert.equal(grid.passable(1, 0), false);
    assert.equal(grid.passable(2, 0), false);
    assert.equal(grid.passable(0, 0), true);
  });

  it('stops when the way keeps changing and the hero goes round in circles', () => {
    const snap = level(['......'], { x: 2, y: 0 });
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    const at = (x: number) => travel.step(ctx({ ...snap, px: x }));
    for (const x of [2, 3, 2, 3]) assert.equal(at(x).kind, 'keys');
    assert.deepEqual(at(2), { kind: 'stop', reason: 'blocked' });
  });

  it('steps towards the goal and stops on arrival', () => {
    const snap = level(['.....'], { x: 0, y: 0 });
    const travel = new Travel({ x: 2, y: 0 }, ctx(snap));
    const first = travel.step(ctx(snap));
    assert.deepEqual(first.kind === 'keys' && first.keys, [92, ...keys(';6')]);
    assert.equal(travel.walked, 1);
    snap.px = 2;
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'arrived' });
  });

  it('stops when the hero lands far from the last step (a new area of the land)', () => {
    const snap = level(['..........'], { x: 1, y: 0 });
    const travel = new Travel({ x: 0, y: 0 }, ctx(snap));
    assert.equal(travel.step(ctx(snap)).kind, 'keys');
    snap.px = 8;
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'interrupted' });
  });

  it('takes one step towards an unseen tap, round a known wall within 45°', () => {
    const open = level(['.....', '.....', '.....'], { x: 2, y: 1 });
    assert.deepEqual(stepTowards(open, MATERIALS, { x: 9, y: 1 }), { x: 3, y: 1 });
    assert.deepEqual(stepTowards(open, MATERIALS, { x: 9, y: 4 }), { x: 3, y: 2 });
    assert.deepEqual(stepTowards(open, MATERIALS, { x: 2, y: -6 }), { x: 2, y: 0 });
    const walled = level(['.....', '...#.', '.....'], { x: 2, y: 1 });
    assert.deepEqual(stepTowards(walled, MATERIALS, { x: 9, y: 2 }), { x: 3, y: 2 });
    const boxed = level(['...#', '..##', '...#'], { x: 2, y: 1 });
    assert.equal(stepTowards(boxed, MATERIALS, { x: 9, y: 1 }), null);
  });

  it('steps along the edge of the level towards a tap beyond it', () => {
    const edge = level(['...', '...'], { x: 2, y: 0 });
    assert.deepEqual(stepTowards(edge, MATERIALS, { x: 6, y: 3 }), { x: 2, y: 1 });
    assert.equal(stepTowards(level(['...'], { x: 2, y: 0 }), MATERIALS, { x: 6, y: 0 }), null);
  });

  it('takes a one-step journey without stopping or a word after it', () => {
    const snap = level(['...'], { x: 0, y: 0 });
    const travel = new Travel({ x: 1, y: 0 }, ctx(snap), { oneStep: true });
    assert.equal(travel.step(ctx(snap, [monster(9, 2, 0)])).kind, 'keys');
    assert.deepEqual(travel.step(ctx(snap, [monster(9, 2, 0)])), { kind: 'stop', reason: 'interrupted' });
  });

  it('tells known cells from unseen ones', () => {
    const snap = level(['............'], { x: 0, y: 0 });
    for (let x = 4; x < 12; x++) snap.info[x] = 0;
    assert.equal(isKnown(snap, { x: 9, y: 0 }), false);
    assert.equal(isKnown(snap, { x: 2, y: 0 }), true);
  });

  it('decides a tap by the question tome2 asks', () => {
    const snap = level(['.....', '.....', '.....'], { x: 2, y: 1 });
    const tap = (x: number, y: number, prompt: Parameters<typeof tapAction>[3]) => tapAction(snap, MATERIALS, { x, y }, prompt);
    assert.deepEqual(tap(3, 0, 'direction'), { kind: 'direction', digit: '9' });
    assert.deepEqual(tap(0, 0, 'direction'), { kind: 'none' });
    assert.deepEqual(tap(1, 1, 'aim'), { kind: 'direction', digit: '4' });
    assert.deepEqual(tap(0, 0, 'aim'), { kind: 'target', cell: { x: 0, y: 0 } });
    snap.atCommand = false;
    assert.deepEqual(tap(0, 0, 'none'), { kind: 'interrupt' });
    assert.deepEqual(tap(0, 0, 'other'), { kind: 'none' });
    snap.atCommand = true;
    assert.deepEqual(tap(2, 1, 'none'), { kind: 'wait' });
  });

  it('travels to a known place, steps to a neighbour and towards the unseen', () => {
    const snap = level(['............'], { x: 0, y: 0 });
    for (let x = 4; x < 12; x++) snap.info[x] = 0;
    assert.deepEqual(goAction(snap, MATERIALS, { x: 3, y: 0 }), { kind: 'travel', cell: { x: 3, y: 0 } });
    assert.deepEqual(goAction(snap, MATERIALS, { x: 1, y: 0 }), { kind: 'step', cell: { x: 1, y: 0 } });
    assert.deepEqual(goAction(snap, MATERIALS, { x: 9, y: 0 }), { kind: 'step', cell: { x: 1, y: 0 } });
    assert.deepEqual(goAction(snap, MATERIALS, { x: -5, y: 0 }), { kind: 'none' });
    assert.deepEqual(tapAction(snap, MATERIALS, { x: 3, y: 0 }, 'none'), { kind: 'travel', cell: { x: 3, y: 0 } });
  });

  it('words why a journey stopped', () => {
    const base: StopContext = { light: false, exploring: false, walked: 0, approximate: false, depth: 1, lightRadius: 1 };
    const stop = (reason: Parameters<typeof stopMessage>[0]['reason'], extra = {}) => ({ kind: 'stop' as const, reason, ...extra });
    assert.equal(stopMessage(stop('hurt'), base), STOP_MESSAGES.hurt);
    assert.equal(stopMessage(stop('monster', { creature: 'the Cave spider', asleep: true }), base), 'You stop: Cave spider in sight, asleep.');
    assert.match(stopMessage(stop('explored'), { ...base, exploring: true, lightRadius: 0 }) ?? '', /too dark to explore further/);
    assert.match(stopMessage(stop('explored'), { ...base, exploring: true, lightRadius: 0, light: true }) ?? '', /Tap Light/);
    assert.equal(stopMessage(stop('explored'), { ...base, exploring: true, depth: 0, lightRadius: 0 }), STOP_MESSAGES.explored);
    assert.match(stopMessage(stop('dark'), { ...base, light: true }) ?? '', /Tap Light to light your way again/);
    assert.equal(stopMessage(stop('dark'), base), STOP_MESSAGES.dark);
  });

  it('says a walk ended short of the place only after a long enough walk', () => {
    const arrived = { kind: 'stop' as const, reason: 'arrived' as const };
    const short: StopContext = { light: false, exploring: false, walked: FAR_WALK_STEPS - 1, approximate: true, depth: 1, lightRadius: 1 };
    assert.equal(stopMessage(arrived, short), null);
    assert.equal(stopMessage(arrived, { ...short, walked: FAR_WALK_STEPS }), STOP_MESSAGES.closest);
    assert.equal(stopMessage(arrived, { ...short, walked: FAR_WALK_STEPS, approximate: false }), null);
  });

  it('walks round a corner as near as the known way leads to an unseen tap', () => {
    const snap = level(['....#', '###.#', '###..'], { x: 0, y: 0 });
    assert.deepEqual(approachTarget(snap, MATERIALS, { x: 9, y: 9 }), { point: { x: 4, y: 2 }, exact: false });
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
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'shut' });
  });

  it('stops when hurt, blocked, the light goes out, or a creature comes into view', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    let travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    travel.step(ctx(snap));
    assert.deepEqual(travel.step(ctx(snap, [], 8)), { kind: 'stop', reason: 'hurt' });

    travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    travel.step(ctx(snap));
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'blocked' });

    travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    travel.step(ctx(snap));
    assert.deepEqual(travel.step(ctx({ ...snap, px: 1, lightRadius: 0 })), { kind: 'stop', reason: 'dark' });

    travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    assert.deepEqual(travel.step(ctx(snap, [monster(7, 5, 5)])), { kind: 'stop', reason: 'monster', creature: 'kobold', asleep: false });
  });

  it('stops for a sleeping creature that comes into view too', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    assert.deepEqual(travel.step(ctx(snap, [monster(7, 4, 0, { asleep: 1 })])), { kind: 'stop', reason: 'monster', creature: 'kobold', asleep: true });
  });

  it('ignores creatures already in sight, however close, and allies', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const known = [monster(1, 5, 0, { asleep: 1 }), monster(2, 1, 0, { status: 3 }), monster(3, 1, 1)];
    const travel = new Travel({ x: 3, y: 0 }, ctx(snap, known));
    assert.equal(travel.step(ctx(snap, known)).kind, 'keys');
    snap.px = 1;
    assert.equal(travel.step(ctx(snap, known.map((m) => ({ ...m, asleep: 0 })))).kind, 'keys');
  });

  it('stops once for a creature coming into sight, and not again while it stays', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const leper = [monster(1, 4, 0)];
    const first = new Travel({ x: 5, y: 0 }, ctx(snap));
    assert.deepEqual(first.step(ctx(snap, leper)), { kind: 'stop', reason: 'monster', creature: 'kobold', asleep: false });
    const second = new Travel({ x: 5, y: 0 }, ctx(snap, leper));
    assert.equal(second.step(ctx(snap, leper)).kind, 'keys');
    snap.px = 1;
    const other = [...leper, monster(2, 1, 1)];
    assert.deepEqual(second.step(ctx(snap, other)), { kind: 'stop', reason: 'monster', creature: 'kobold', asleep: false });
  });

  it('still stops when hurt by a creature in sight', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const leper = [monster(1, 2, 0)];
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap, leper));
    assert.equal(travel.step(ctx(snap, leper)).kind, 'keys');
    snap.px = 1;
    assert.deepEqual(travel.step(ctx(snap, leper, 8)), { kind: 'stop', reason: 'hurt' });
  });

  it('does not stop for a creature only sensed, out of line of sight', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    assert.equal(travel.step(ctx(snap, [monster(1, 4, 0, { view: 0, target: 0 })])).kind, 'keys');
  });

  it('stops when a thief takes gold, though health is untouched', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const travel = new Travel({ x: 5, y: 0 }, { ...ctx(snap), gold: 100 });
    assert.equal(travel.step({ ...ctx(snap), gold: 100 }).kind, 'keys');
    assert.deepEqual(travel.step({ ...ctx({ ...snap, px: 1 }), gold: 60 }), { kind: 'stop', reason: 'robbed' });
  });

  it('stops again for a creature that leaves sight and comes back mid-journey', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const leper = [monster(1, 2, 0)];
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap, leper));
    assert.equal(travel.step(ctx(snap, leper)).kind, 'keys');
    snap.px = 1;
    assert.equal(travel.step(ctx(snap)).kind, 'keys');
    snap.px = 2;
    assert.deepEqual(travel.step(ctx(snap, [monster(1, 3, 0)])), { kind: 'stop', reason: 'monster', creature: 'kobold', asleep: false });
  });

  it('walks through a companion in a corridor, pushing past it as tome2 does', () => {
    const snap = level(['..k..'], { x: 0, y: 0 });
    const friend = [monster(1, 2, 0, { status: 3, name: 'dog' })];
    const steady = { confused: false, stunned: false, hallucinating: false, stormbringer: false };
    const passing = pushPast(snap, MATERIALS, friend, steady);
    assert.deepEqual([...passing], [2]);
    assert.equal(travelGrid(snap, MATERIALS, passing).passable(2, 0), true);
    const travel = new Travel({ x: 4, y: 0 }, { ...ctx(snap, friend), passing });
    assert.equal(travel.step({ ...ctx(snap, friend), passing }).kind, 'keys');
    assert.equal(new Travel({ x: 4, y: 0 }, ctx(snap, friend)).step(ctx(snap, friend)).kind, 'stop');
  });

  it('does not push past a hostile or neutral creature, nor while unsteady or off the floor', () => {
    const snap = level(['..k..'], { x: 0, y: 0 });
    const steady = { confused: false, stunned: false, hallucinating: false, stormbringer: false };
    assert.equal(pushPast(snap, MATERIALS, [monster(1, 2, 0)], steady).size, 0);
    assert.equal(pushPast(snap, MATERIALS, [monster(1, 2, 0, { status: 0 })], steady).size, 0);
    const friend = [monster(1, 2, 0, { status: 4 })];
    assert.equal(pushPast(snap, MATERIALS, friend, { ...steady, confused: true }).size, 0);
    assert.equal(pushPast(snap, MATERIALS, friend, { ...steady, stormbringer: true }).size, 0);
    const doorway = level(['+k...'], { x: 0, y: 0 });
    assert.equal(pushPast(doorway, MATERIALS, [monster(1, 1, 0, { status: 4 })], steady).size, 0);
    assert.equal(pushPast(doorway, MATERIALS, [monster(1, 3, 0, { status: 4 })], steady).size, 1);
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
    for (const group of COMMAND_GROUPS) for (const c of group.commands) assert.ok(c.command.length >= 1 || c.native);
  });

  it('names the transition underfoot and the command that takes it', () => {
    assert.deepEqual(transitionUnderfoot('down staircase'), { id: 'descend', label: 'Descend', icon: '>', command: '>' });
    assert.equal(transitionUnderfoot('path to the previous area')?.id, 'ascend');
    assert.equal(transitionUnderfoot('path to the next area')?.command, '>');
    assert.equal(transitionUnderfoot('void jumpgate')?.label, 'Enter rift');
    assert.equal(transitionUnderfoot('quest entrance')?.id, 'enter');
    assert.equal(transitionUnderfoot('quest exit')?.command, '<');
    assert.equal(transitionUnderfoot('open floor'), null);
  });

  it('picks up with the key that matches the always_pickup option', () => {
    const pickup = (always: boolean) => contextualAction({ mode: 'map', prompt: 'none', atCommand: true, underfoot: 'open floor', floorObjects: 1, alwaysPickup: always }).effect;
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
    assert.deepEqual(contextActions({ ...base, mode: 'overlay', atCommand: false, prompt: 'none', screen: 'file' }).map((a) => [a.id, a.label]), [
      ['escape', 'Done'],
      ['menu', 'Menu'],
    ]);
    assert.deepEqual(contextActions({ ...base, mode: 'overlay', atCommand: false, prompt: 'none', screen: 'file' })[0].effect, { kind: 'native', view: 'closeFile' });
  });

  it('opens native views for items, looking and the level map', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    assert.deepEqual(contextActions(base).find((a) => a.id === 'inventory')?.effect, { kind: 'native', view: 'inventory' });
    assert.deepEqual(contextActions({ ...base, looking: true }).map((a) => a.id), ['lookdone']);
    assert.deepEqual(contextActions({ ...base, overview: true }).map((a) => a.id), ['overviewdone']);
    assert.deepEqual(contextActions(base).find((a) => a.id === 'explore')?.effect, { kind: 'native', view: 'explore' });
    const sheet = COMMAND_GROUPS.flatMap((g) => g.commands);
    assert.equal(sheet.find((c) => c.label === 'Inventory')?.native, 'inventory');
    assert.equal(sheet.find((c) => c.label === 'Look')?.native, 'look');
  });

  it('keeps one changing button first and the hero\'s own buttons in their places', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const ids = (ctx: Partial<Parameters<typeof contextActions>[0]>) => contextActions({ ...base, ...ctx }).map((a) => a.id);
    const mage = { quick: { label: 'Manathrust' }, magic: 'Cast' };
    const layout = ids(mage).slice(1);
    assert.deepEqual(layout, ['recast', 'cast', 'inventory', 'rest', 'commands', 'menu']);
    for (const changing of [{ foe: '6' }, { floorObjects: 2 }, { underfoot: 'down staircase' }, { gear: 'light' as const }, { exploreNext: 'down' as const }]) {
      assert.deepEqual(ids({ ...mage, ...changing }).slice(1), layout);
    }
    const unavailable = contextActions({ ...base, ...mage, quick: { label: 'Manathrust', unavailable: 'No target in sight.' } }).find((a) => a.id === 'recast');
    assert.deepEqual([unavailable?.label, unavailable?.unavailable], ['Manathrust', 'No target in sight.']);
    assert.deepEqual(ids({}), ['explore', 'inventory', 'rest', 'commands', 'menu']);
    assert.deepEqual(ids({ fire: {} }), ['explore', 'fire', 'inventory', 'rest', 'commands', 'menu']);
    const ranger = ids({ ...mage, fire: { unavailable: 'Your quiver is empty.' } });
    assert.deepEqual(ranger, ['explore', 'recast', 'cast', 'fire', 'inventory', 'commands', 'menu']);
    assert.equal(contextActions({ ...base, magic: 'Powers' }).find((a) => a.id === 'cast')?.label, 'Powers');
  });

  it('puts the most pressing thing first, else Explore named for what it will do', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const first = (ctx: Partial<Parameters<typeof contextualAction>[0]>) => {
      const a = contextualAction({ ...base, ...ctx });
      return [a.id, a.label];
    };
    assert.deepEqual(first({}), ['explore', 'Explore']);
    assert.deepEqual(first({ exploreNext: 'down' }), ['explore', 'Way down']);
    assert.deepEqual(first({ exploreNext: 'up' }), ['explore', 'Way up']);
    assert.deepEqual(first({ exploreNext: 'worldMap' }), ['explore', 'World map']);
    assert.deepEqual(first({ gear: 'light' }), ['equip', 'Light']);
    assert.deepEqual(first({ gear: 'light', underfoot: 'fountain' }), ['drink', 'Drink']);
    assert.deepEqual(first({ gear: 'light', floorObjects: 1 }), ['pickup', 'Pick up']);
    assert.deepEqual(first({ floorObjects: 1, foe: '6' }), ['attack', 'Attack']);
    assert.deepEqual(contextualAction({ ...base, foe: '6' }).effect, { kind: 'keys', keys: [92, 59, 54] });
    assert.deepEqual(first({ foe: '6', underfoot: 'down staircase' }), ['descend', 'Descend']);
    assert.deepEqual(contextualAction({ ...base, underfoot: 'up staircase' }).effect, { kind: 'keys', keys: [92, ...keys('<')] });
    assert.deepEqual(first({ underfoot: 'void jumpgate' }), ['rift', 'Enter rift']);
  });

  it('is always the stair underfoot, whatever else applies', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: 'up staircase', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const first = (ctx: Partial<Parameters<typeof contextualAction>[0]>) => contextualAction({ ...base, ...ctx }).label;
    for (const exploreNext of ['explore', 'down', 'up', 'none', 'worldMap'] as const) assert.equal(first({ exploreNext }), 'Ascend');
    assert.equal(first({ foe: '6', floorObjects: 1, gear: 'light' }), 'Ascend');
    assert.equal(first({ underfoot: 'down staircase', exploreNext: 'up' }), 'Descend');
    assert.equal(first({ underfoot: 'down staircase', exploreNext: 'worldMap' }), 'Descend');
    assert.equal(first({ underfoot: 'path to the next area', exploreNext: 'here' }), 'Descend');
    assert.equal(first({ underfoot: 'open floor', exploreNext: 'down' }), 'Way down');
  });

  it('is the way into a building the hero stands at, over Explore or the world map', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: 'building', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const shop = contextualAction({ ...base, entrance: 'Enter shop', exploreNext: 'worldMap', foe: '6' });
    assert.equal(shop.label, 'Enter shop');
    assert.deepEqual(shop.effect, { kind: 'keys', keys: [92, ...keys('_')] });
    assert.equal(contextualAction({ ...base, underfoot: 'open floor', exploreNext: 'worldMap' }).label, 'World map');
  });

  it('shows Stop, Speed and Menu while exploring, between steps too; Speed leaves it running', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const exploring = contextActions({ ...base, exploring: 'normal' });
    assert.deepEqual(exploring.map((a) => [a.id, a.label]), [
      ['stop', 'Stop'],
      ['pace', 'Speed'],
      ['menu', 'Menu'],
    ]);
    assert.equal(exploring[1].continues, true);
    assert.deepEqual(contextActions({ ...base, atCommand: false, exploring: 'relaxed' }).map((a) => a.id), ['stop', 'pace', 'menu']);
    assert.equal(speedAction('relaxed').label, 'Speed');
    assert.notEqual(speedAction('relaxed').icon, speedAction('normal').icon);
  });

  it('names the way to and from the world map on the surface', () => {
    const labels = (where: Parameters<typeof commandGroups>[0]) => commandGroups(where).flatMap((g) => g.commands.map((c) => c.label));
    assert.ok(labels('dungeon').includes('Go up') && labels('dungeon').includes('Go down'));
    assert.ok(labels('land').includes('World map') && labels('land').includes('Go down') && !labels('land').includes('Go up'));
    assert.ok(labels('worldMap').includes('Walk here') && !labels('worldMap').includes('Go up') && !labels('worldMap').includes('Go down'));

    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const map = contextActions({ ...base, worldMap: true });
    assert.equal(map.find((a) => a.id === 'walkhere')?.primary, true);
    assert.deepEqual(map.find((a) => a.id === 'walkhere')?.effect, { kind: 'keys', keys: [92, ...keys('>')] });
    assert.ok(!map.some((a) => a.id === 'explore'));
    assert.ok(contextActions(base).some((a) => a.id === 'explore') && !contextActions(base).some((a) => a.id === 'dungeon'));
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
