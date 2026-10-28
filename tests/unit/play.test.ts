import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMAND_GROUPS, commandGroups, commandKeys, contextActions, pickupCommand, situationalActions, waitCommand } from '../../web/src/play/actions.ts';
import { findPath, type TravelGrid } from '../../web/src/play/pathfinding.ts';
import { classifyPrompt, directionDigit, isAdjacent } from '../../web/src/play/prompts.ts';
import { TargetPicker, cursorMoves } from '../../web/src/play/targeting.ts';
import { approachTarget, edgeCell, forgetUnseen, isKnown, Travel, travelGrid, type TravelContext } from '../../web/src/play/travel.ts';
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

  it('stops when the hero lands far from the last step (a new area of the land)', () => {
    const snap = level(['..........'], { x: 1, y: 0 });
    const travel = new Travel({ x: 0, y: 0 }, ctx(snap));
    assert.equal(travel.step(ctx(snap)).kind, 'keys');
    snap.px = 8;
    assert.deepEqual(travel.step(ctx(snap)), { kind: 'stop', reason: 'interrupted' });
  });

  it('turns a tap beyond the level into the nearest border cell', () => {
    assert.equal(edgeCell(10, 5, { x: 3, y: 2 }), null);
    assert.deepEqual(edgeCell(10, 5, { x: -4, y: 2 }), { x: 0, y: 2 });
    assert.deepEqual(edgeCell(10, 5, { x: 12, y: -1 }), { x: 9, y: 0 });
    assert.deepEqual(edgeCell(10, 5, { x: 5, y: 7 }), { x: 5, y: 4 });
  });

  it('tells known cells from unseen ones', () => {
    const snap = level(['............'], { x: 0, y: 0 });
    for (let x = 4; x < 12; x++) snap.info[x] = 0;
    assert.equal(isKnown(snap, { x: 9, y: 0 }), false);
    assert.equal(isKnown(snap, { x: 2, y: 0 }), true);
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
    assert.deepEqual(travel.step(ctx(snap, [monster(7, 5, 5)])), { kind: 'stop', reason: 'monster', creature: 'kobold' });
  });

  it('walks on past a newly seen sleeping creature until it wakes nearby', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap));
    const sleeper = monster(7, 2, 0, { asleep: 1 });
    assert.equal(travel.step(ctx(snap, [sleeper])).kind, 'keys');
    snap.px = 1;
    assert.deepEqual(travel.step(ctx(snap, [{ ...sleeper, asleep: 0 }])), { kind: 'stop', reason: 'monster', creature: 'kobold' });
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
    assert.deepEqual(travel.step(ctx(snap, known)), { kind: 'stop', reason: 'monster', creature: 'kobold' });
  });

  it('stops only once for the same creature while it stays in sight', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const leper = [monster(1, 2, 0)];
    const noticed = new Set<number>();
    const first = new Travel({ x: 5, y: 0 }, ctx(snap, leper), { noticed });
    assert.deepEqual(first.step(ctx(snap, leper)), { kind: 'stop', reason: 'monster', creature: 'kobold' });
    const second = new Travel({ x: 5, y: 0 }, ctx(snap, leper), { noticed });
    assert.equal(second.step(ctx(snap, leper)).kind, 'keys');
    snap.px = 1;
    const other = [...leper, monster(2, 1, 1)];
    assert.deepEqual(second.step(ctx(snap, other)), { kind: 'stop', reason: 'monster', creature: 'kobold' });
  });

  it('still stops when hurt by a creature it has noticed', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const leper = [monster(1, 2, 0)];
    const noticed = new Set([1]);
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap, leper), { noticed });
    assert.equal(travel.step(ctx(snap, leper)).kind, 'keys');
    snap.px = 1;
    assert.deepEqual(travel.step(ctx(snap, leper, 8)), { kind: 'stop', reason: 'hurt' });
  });

  it('forgets a noticed creature once it is out of sight', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const noticed = new Set([1]);
    new Travel({ x: 5, y: 0 }, ctx(snap), { noticed });
    assert.equal(noticed.size, 0);
    const back = [monster(1, 2, 0)];
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap, back), { noticed });
    assert.deepEqual(travel.step(ctx(snap, back)), { kind: 'stop', reason: 'monster', creature: 'kobold' });
  });

  it('stops again for a noticed creature that leaves sight and returns mid-journey', () => {
    const snap = level(['......'], { x: 0, y: 0 });
    const leper = [monster(1, 2, 0)];
    const noticed = new Set([1]);
    const travel = new Travel({ x: 5, y: 0 }, ctx(snap, leper), { noticed });
    assert.equal(travel.step(ctx(snap, leper)).kind, 'keys');
    snap.px = 1;
    assert.equal(travel.step(ctx(snap)).kind, 'keys');
    assert.equal(noticed.size, 0);
    snap.px = 2;
    const back = [monster(1, 3, 0)];
    assert.deepEqual(travel.step(ctx(snap, back)), { kind: 'stop', reason: 'monster', creature: 'kobold' });
  });

  it('forgets noticed creatures that are out of sight between journeys', () => {
    const noticed = new Set([1, 2]);
    forgetUnseen(noticed, [monster(2, 3, 0)]);
    assert.deepEqual([...noticed], [2]);
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

  it('offers situational actions for what is underfoot', () => {
    assert.deepEqual(situationalActions('down staircase', 0).map((a) => a.id), ['descend']);
    assert.deepEqual(situationalActions('up staircase', 2).map((a) => a.id), ['pickup', 'ascend']);
    assert.deepEqual(situationalActions('open floor', 0), []);
    const rift = situationalActions('void jumpgate', 0);
    assert.deepEqual(rift.map((a) => [a.id, a.label, !!a.primary]), [['rift', 'Enter rift', true]]);
    assert.deepEqual(rift[0].effect, { kind: 'keys', keys: [92, ...keys('>')] });
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
    assert.ok(contextActions({ ...base, mode: 'overlay', atCommand: false, prompt: 'none', screen: 'help' }).some((a) => a.id === 'pagedown'));
  });

  it('opens native views for items, looking and the level map', () => {
    const base = { mode: 'map' as const, atCommand: true, underfoot: '', floorObjects: 0, alwaysPickup: false, prompt: 'none' as const };
    const inventory = contextActions(base).find((a) => a.id === 'inventory');
    assert.deepEqual(inventory?.effect, { kind: 'native', view: 'inventory' });
    assert.deepEqual(contextActions({ ...base, looking: true }).map((a) => a.id), ['lookdone']);
    assert.deepEqual(contextActions({ ...base, overview: true }).map((a) => a.id), ['overviewdone']);
    assert.deepEqual(contextActions(base).find((a) => a.id === 'explore')?.effect, { kind: 'native', view: 'explore' });
    const fight = contextActions({ ...base, foe: '6', gear: 'light' });
    assert.deepEqual(fight.slice(0, 2).map((a) => [a.id, a.label]), [
      ['attack', 'Attack'],
      ['equip', 'Light'],
    ]);
    assert.deepEqual(fight[0].effect, { kind: 'keys', keys: [92, 59, 54] });
    const ranged = contextActions({ ...base, foeInView: true, recast: 'Manathrust', canFire: true }).map((a) => [a.id, a.label, !!a.primary]);
    assert.deepEqual(ranged.slice(0, 2), [
      ['recast', 'Manathrust', true],
      ['fire', 'Fire', false],
    ]);
    const quiet = contextActions({ ...base, recast: 'Manathrust', canFire: true });
    assert.deepEqual(quiet.filter((a) => a.id === 'recast' || a.id === 'fire').map((a) => [a.id, !!a.primary]), [['recast', false]]);
    assert.ok(quiet.some((a) => a.id === 'cast'));
    assert.deepEqual(contextActions(base).find((a) => a.id === 'cast')?.effect, { kind: 'native', view: 'magic' });
    assert.equal(contextActions({ ...base, magic: 'Powers' }).find((a) => a.id === 'cast')?.label, 'Powers');
    assert.ok(!contextActions({ ...base, magic: null }).some((a) => a.id === 'cast'));
    const crowded = contextActions({ ...base, foe: '6', gear: 'light', floorObjects: 1, underfoot: 'down staircase' });
    assert.ok(crowded.length <= 7);
    assert.deepEqual(crowded.map((a) => a.id), ['attack', 'equip', 'pickup', 'descend', 'inventory', 'commands', 'menu']);
    const busy = contextActions({ ...base, gear: 'light', underfoot: 'down staircase' }).map((a) => a.id);
    assert.deepEqual(busy, ['equip', 'descend', 'explore', 'inventory', 'cast', 'commands', 'menu']);
    const caster = contextActions({ ...base, foe: '6', foeInView: true, recast: 'Manathrust' }).map((a) => a.id);
    assert.ok(caster.length <= 7 && caster.includes('recast') && caster.includes('cast'), caster.join());
    const calm = contextActions({ ...base, foeInView: true, recast: 'Manathrust', canFire: true }).map((a) => a.id);
    assert.ok(calm.length <= 7 && calm.includes('cast') && calm.includes('recast'), calm.join());
    const sheet = COMMAND_GROUPS.flatMap((g) => g.commands);
    assert.equal(sheet.find((c) => c.label === 'Inventory')?.native, 'inventory');
    assert.equal(sheet.find((c) => c.label === 'Look')?.native, 'look');
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
