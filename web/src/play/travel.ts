import type { Material } from '../render/materials.ts';
import {
  CAVE_MARK,
  isKnownCell,
  LAYER_MASK,
  LAYER_MONSTER,
  isAlly,
  isHostile,
  isNeutral,
  type LevelSnapshot,
  type MonsterState,
} from '../render/snapshot.ts';
import { KEY_BACKSLASH as BACKSLASH } from '../input/keys.ts';
import { findPath, floodFill, gridDistance, type Point, type TravelGrid } from './pathfinding.ts';
import { directionDigit, isAdjacent, type PromptKind } from './prompts.ts';
import { titleName } from './text.ts';

const MAX_STEPS = 400;
/* Visits to one cell that end a journey as going round in circles. */
const MAX_VISITS = 3;
const WALK = ';'.charCodeAt(0);
const OPEN = 'o'.charCodeAt(0);

type TravelStopReason =
  | 'arrived'
  | 'monster'
  | 'hurt'
  | 'blocked'
  | 'shut'
  | 'dark'
  | 'robbed'
  | 'unreachable'
  | 'interrupted'
  | 'limit'
  | 'explored'
  | 'exit'
  | 'exitUp'
  | 'creatureInWay';

export type TravelStep =
  | { kind: 'keys'; keys: number[]; path: Point[] }
  | {
      kind: 'stop';
      reason: TravelStopReason;
      /** The creature that stopped travel. */
      creature?: string;
      /** It was asleep. */
      asleep?: boolean;
    };

export interface TravelContext {
  snap: LevelSnapshot;
  materials: readonly Material[];
  monsters: readonly MonsterState[];
  hp: number;
  /** Gold carried, to stop when a thief takes some. */
  gold?: number;
  /** Cells of creatures the way may lead through: companions the hero pushes past (`pushPast`) and creatures not in sight (`outOfSight`). */
  passing?: ReadonlySet<number>;
  /** What tome2 is asking, if anything. */
  prompt?: PromptKind;
}

export const STOP_MESSAGES: Record<TravelStopReason, string | null> = {
  arrived: null,
  monster: 'You stop: a creature is in sight.',
  hurt: 'You stop: you are hurt.',
  blocked: 'You stop: the way is blocked.',
  shut: 'You stop: the door will not open.',
  dark: 'You stop: your light has gone out.',
  robbed: 'You stop: your purse is lighter.',
  unreachable: 'You know no way there yet.',
  interrupted: null,
  limit: 'You stop to get your bearings.',
  explored: 'Nothing left to explore within reach.',
  exit: 'Explored. The way down is here.',
  exitUp: 'Explored. The way up is here.',
  creatureInWay: 'A creature stands in the way.',
};

/** Steps a walk that stops short of an unknown place takes before it says so. */
export const FAR_WALK_STEPS = 10;
const FAR_WALK_MESSAGE = 'This is as far as you know the way.';

/** What the stop message depends on besides the step itself. */
export interface StopContext {
  /** The changing button offers to light the way. */
  light: boolean;
  /** The journey is exploring, not travel. */
  exploring: boolean;
  /** Steps travel has walked. */
  walked: number;
  /** Travel ends short of the place tapped. */
  approximate: boolean;
  depth: number;
  lightRadius: number;
}

/** What to tell the player when travel or exploring stops. */
export function stopMessage(step: Extract<TravelStep, { kind: 'stop' }>, ctx: StopContext): string | null {
  if (step.reason === 'explored' && ctx.exploring && ctx.depth > 0 && ctx.lightRadius <= 0) {
    return ctx.light ? 'It is too dark to explore. Tap Light to light your way.' : 'It is too dark to explore further without a light.';
  }
  if (step.reason === 'dark' && ctx.light) return 'Your light has gone out. Tap Light to light your way again.';
  if (step.creature) return `You stop: ${titleName(step.creature)} in sight${step.asleep ? ', asleep' : ''}.`;
  if (step.reason === 'arrived' && ctx.approximate) return !ctx.exploring && ctx.walked >= FAR_WALK_STEPS ? FAR_WALK_MESSAGE : null;
  return STOP_MESSAGES[step.reason];
}

/** A known cell the player cannot walk through (a wall, a tree, a mountain). */
function knownBarrier(snap: LevelSnapshot, materials: readonly Material[], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= snap.width || y >= snap.height) return true;
  const i = y * snap.width + x;
  if (!isKnownCell(snap.info, i)) return false;
  const m = materials[snap.feat[i]];
  return !m || (!m.walkable && !m.door);
}

/**
 * An unseen floor between two known walls, as magic mapping leaves a
 * corridor: the walls are drawn, the floor between them is not.
 */
export function inferredFloor(snap: LevelSnapshot, materials: readonly Material[], x: number, y: number): boolean {
  const m = materials[snap.feat[y * snap.width + x]];
  if (!m || !m.walkable || m.door || m.blocksLight) return false;
  const barrier = (dx: number, dy: number) => knownBarrier(snap, materials, x + dx, y + dy);
  return (barrier(0, -1) && barrier(0, 1)) || (barrier(-1, 0) && barrier(1, 0));
}

/** Creatures a way may lead through: those at these cells (companions the hero pushes past, creatures not in sight), or all of them ('all', to ask whether creatures alone stand in the way). */
export type Passing = ReadonlySet<number> | 'all';

const NOBODY: ReadonlySet<number> = new Set();

/* Extra steps a cell walkable only by the hero's ability (a tree for a tree walker) costs travel, so a known path is taken unless the shortcut saves a long way round. */
const SHORTCUT_COST = 4;

/** Walkable cells the player knows of; creatures in view block, but for those `passing` lets through. */
export function travelGrid(snap: LevelSnapshot, materials: readonly Material[], passing: Passing = NOBODY): TravelGrid {
  return {
    width: snap.width,
    height: snap.height,
    passable(x, y) {
      const i = y * snap.width + x;
      if (passing !== 'all' && !passing.has(i) && (snap.layer[i] & LAYER_MASK) === LAYER_MONSTER) return false;
      if (!isKnownCell(snap.info, i)) return inferredFloor(snap, materials, x, y);
      const m = materials[snap.feat[i]];
      return !!m && (m.walkable || m.door);
    },
    penalty(x, y) {
      const i = y * snap.width + x;
      if (!isKnownCell(snap.info, i)) return 0.5;
      const m = materials[snap.feat[i]];
      return m?.shortcut ? SHORTCUT_COST : m && m.door && !m.walkable ? 2 : 0;
    },
  };
}

/* tome2's FEAT_RUBBLE: the rubble a digger clears (the town's pile is a permanent feature of its own). */
const FEAT_RUBBLE = 0x31;

/** What a tap on terrain too hard for the hero's digger says. */
export const TOO_HARD = 'Too hard for your digger. More → Tunnel tries anyway.';

/**
 * The digging skill a cell needs (tome2's skill_req_1pct), when the hero can
 * dig into it (do_cmd_tunnel_test): remembered terrain tome2 tunnels through
 * that the hero cannot walk onto, with no creature shown on it, inside the
 * level's edge (the land's border shows the next area's terrain); else null.
 */
export function digNeeded(snap: LevelSnapshot, materials: readonly Material[], point: Point): number | null {
  if (point.x <= 0 || point.y <= 0 || point.x >= snap.width - 1 || point.y >= snap.height - 1) return null;
  const i = point.y * snap.width + point.x;
  const m = materials[snap.feat[i]];
  if (m?.dig === undefined || m.walkable || !(snap.info[i] & CAVE_MARK) || (snap.layer[i] & LAYER_MASK) === LAYER_MONSTER) return null;
  return m.dig;
}

/** Direction digits of the rubble beside the hero that they can dig into. */
export function rubbleBeside(snap: LevelSnapshot, materials: readonly Material[]): string[] {
  const digits: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const point = { x: snap.px + dx, y: snap.py + dy };
      if ((dx || dy) && digNeeded(snap, materials, point) !== null && snap.feat[point.y * snap.width + point.x] === FEAT_RUBBLE) digits.push(directionDigit(dx, dy)!);
    }
  }
  return digits;
}

export interface Approach {
  point: Point;
  /** The goal itself; false when it is only the nearest place a known way reaches. */
  exact: boolean;
}

/**
 * Where to walk for a tap on `goal`: the goal itself when a known way leads
 * there (a creature or a closed door there included), otherwise the reachable
 * cell nearest to it, as far as the known way goes. Null when nowhere
 * reachable is closer to the goal than the player already is.
 */
export function approachTarget(snap: LevelSnapshot, materials: readonly Material[], goal: Point, passing: Passing = NOBODY): Approach | null {
  const { width, height } = snap;
  const grid = travelGrid(snap, materials, passing);
  const start = snap.py * width + snap.px;
  const goalIndex = goal.y * width + goal.x;
  const inside = goal.x >= 0 && goal.y >= 0 && goal.x < width && goal.y < height;
  const goalMat = inside ? materials[snap.feat[goalIndex]] : undefined;
  const enterable = inside && isKnownCell(snap.info, goalIndex) && !!goalMat && (goalMat.walkable || goalMat.door);

  const cell = (i: number): Point => ({ x: i % width, y: Math.floor(i / width) });
  const distance = (p: Point) => gridDistance(goal, p) + 0.001 * Math.hypot(goal.x - p.x, goal.y - p.y);
  let best = start;
  let bestDistance = distance(cell(start));
  let exact = false;
  floodFill(grid, cell(start), (i) => {
    const p = cell(i);
    if (enterable && gridDistance(goal, p) <= 1) return (exact = true);
    const d = distance(p);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  if (exact) return { point: goal, exact: true };
  if (best === start) return null;
  return { point: cell(best), exact: best === goalIndex };
}

/**
 * The cell for one step towards a place the hero has not seen: the
 * neighbour in its direction, or when that is a known wall (or off the
 * level), the one up to 45° either side nearer that direction. Null when
 * all three are walled.
 */
export function stepTowards(snap: LevelSnapshot, materials: readonly Material[], point: Point): Point | null {
  const dx = point.x - snap.px;
  const dy = point.y - snap.py;
  if (dx === 0 && dy === 0) return null;
  const angle = Math.atan2(dy, dx);
  const eighth = Math.PI / 4;
  const octant = Math.round(angle / eighth);
  const tries = [octant, octant - 1, octant + 1].sort((a, b) => Math.abs(angle - a * eighth) - Math.abs(angle - b * eighth));
  for (const o of tries) {
    const x = snap.px + Math.round(Math.cos(o * eighth));
    const y = snap.py + Math.round(Math.sin(o * eighth));
    if (!knownBarrier(snap, materials, x, y)) return { x, y };
  }
  return null;
}

/** Whether the player has seen or remembers a cell. */
export function isKnown(snap: LevelSnapshot, point: Point): boolean {
  if (point.x < 0 || point.y < 0 || point.x >= snap.width || point.y >= snap.height) return false;
  return isKnownCell(snap.info, point.y * snap.width + point.x);
}

/** What a tap on the map does. */
export type TapAction =
  | { kind: 'direction'; digit: string }
  | { kind: 'target'; cell: Point }
  | { kind: 'interrupt' }
  | { kind: 'wait' }
  | { kind: 'travel'; cell: Point }
  | { kind: 'step'; cell: Point }
  | { kind: 'talk'; digit: string }
  | { kind: 'dig'; digit: string }
  | { kind: 'steer'; digit: string }
  | { kind: 'refuse'; why: string }
  | { kind: 'none' };

/** What a tap on the map can do besides walking. */
export interface TapContext {
  /** Creatures on the level, for talking to a neutral one beside the hero. */
  monsters?: readonly MonsterState[];
  /** The hero's digging skill, while they can dig. */
  dig?: number;
  /** Where the creature the hero controls stands (null out of sight); given only while they control one. */
  steered?: Point | null;
}

/**
 * Where a tap on the map takes the hero: travel to a place they have seen,
 * one step to a neighbouring cell, and one step towards anywhere unseen,
 * blank screen beyond the level included. A tap on a neutral creature beside
 * the hero talks to it, where a step would only stop short of it (after
 * Pixel Dungeon, whose townsfolk answer a tap); a tap on a wall, vein, rubble
 * or tree beside a hero who can dig digs into it, where a step would only
 * bump it, when their skill gets through it at 1% a turn or better, and
 * otherwise says it is too hard (after NetHack's autodig).
 */
export function goAction(
  snap: LevelSnapshot,
  materials: readonly Material[],
  point: Point,
  { monsters = [], dig }: TapContext = {},
): Extract<TapAction, { kind: 'travel' | 'step' | 'talk' | 'dig' | 'refuse' | 'none' }> {
  const known = isKnown(snap, point);
  const near = isAdjacent(snap.px, snap.py, point.x, point.y);
  if (known && !near) return { kind: 'travel', cell: point };
  const digit = directionDigit(point.x - snap.px, point.y - snap.py) ?? '5';
  if (near && monsters.some((m) => m.x === point.x && m.y === point.y && isNeutral(m))) return { kind: 'talk', digit };
  const needed = near && dig !== undefined ? digNeeded(snap, materials, point) : null;
  if (needed !== null) return dig! >= needed ? { kind: 'dig', digit } : { kind: 'refuse', why: TOO_HARD };
  const step = known ? point : stepTowards(snap, materials, point);
  return step ? { kind: 'step', cell: step } : { kind: 'none' };
}

/**
 * What a tap does while the hero controls another creature (`steered`, where
 * it stands, or null out of sight): one step of the creature towards the
 * place tapped, as tome2 moves it with the walking keys.
 */
function steerAction(steered: Point | null, cell: Point): TapAction {
  if (!steered) return { kind: 'refuse', why: 'The creature you control is out of sight.' };
  const digit = directionDigit(cell.x - steered.x, cell.y - steered.y);
  return digit && digit !== '5' ? { kind: 'steer', digit } : { kind: 'none' };
}

/**
 * What a tap on a map cell does for the question tome2 is asking: choose a
 * direction or target, interrupt a rest or run, steer the creature the hero
 * controls, wait in place, or go there.
 */
export function tapAction(snap: LevelSnapshot, materials: readonly Material[], cell: Point, prompt: PromptKind, context: TapContext = {}): TapAction {
  const { steered } = context;
  const near = isAdjacent(snap.px, snap.py, cell.x, cell.y);
  const direction = (): TapAction => ({ kind: 'direction', digit: directionDigit(cell.x - snap.px, cell.y - snap.py) ?? '5' });
  if (prompt === 'direction') return near ? direction() : { kind: 'none' };
  if (prompt === 'aim') return near ? direction() : { kind: 'target', cell };
  /* Resting, running or repeating: a tap interrupts it. */
  if (!snap.atCommand) return prompt === 'none' ? { kind: 'interrupt' } : { kind: 'none' };
  if (steered !== undefined) return steerAction(steered, cell);
  if (cell.x === snap.px && cell.y === snap.py) return { kind: 'wait' };
  return goAction(snap, materials, cell, context);
}

/** What keeps the hero from pushing past a companion: tome2 makes them stop, or strike, while confused, stunned or seeing things. */
interface Steadiness {
  confused: boolean;
  stunned: boolean;
  hallucinating: boolean;
  /** Stormbringer sometimes strikes whoever is in the way. */
  stormbringer: boolean;
}

/**
 * Cells of the companions the hero can walk through: tome2 swaps places with
 * a creature fighting for the hero that they can see (move_player's "You
 * push past"), unless the hero is unsteady; and only from floor, so a hero
 * on stairs or in a doorway cannot push past one beside them.
 */
export function pushPast(snap: LevelSnapshot, materials: readonly Material[], monsters: readonly MonsterState[], hero: Steadiness): Set<number> {
  const cells = new Set<number>();
  if (hero.confused || hero.stunned || hero.hallucinating || hero.stormbringer) return cells;
  const onFloor = !!materials[snap.feat[snap.py * snap.width + snap.px]]?.floor;
  for (const m of monsters) {
    if (!isAlly(m) || (!onFloor && gridDistance(m, { x: snap.px, y: snap.py }) <= 1)) continue;
    cells.add(m.y * snap.width + m.x);
  }
  return cells;
}

/**
 * Cells of creatures shown on the map but not in the hero's line of sight:
 * tome2 shows creatures up to 20 grids away (MAX_SIGHT) but its line of
 * sight reaches 18 (MAX_RANGE), and telepathy shows some behind walls. The
 * way is planned through them, as each step plans it again: one that comes
 * into sight stops travel or blocks the way then, so a creature at the edge
 * of sight cannot turn a journey back and forth as the hero steps in and out
 * of its view.
 */
export function outOfSight(snap: LevelSnapshot, monsters: readonly MonsterState[]): Set<number> {
  return new Set(monsters.filter((m) => !m.view).map((m) => m.y * snap.width + m.x));
}

/** Hostile creatures in the hero's line of sight (not those only sensed, by telepathy or detection). */
export function hostilesInSight(monsters: readonly MonsterState[]): MonsterState[] {
  return monsters.filter((m) => isHostile(m) && !!m.view);
}

/**
 * What stops a journey wherever it goes: the hero hurt, robbed (gold drops:
 * a thief's touch does no harm to health), or their light gone out below the
 * town. Each check compares with the last one, or with `start` at first.
 */
export class Watch {
  private hp: number | null = null;
  private gold: number | undefined;
  private light: number | null = null;

  constructor(start?: TravelContext) {
    if (start) this.note(start);
  }

  /** What has happened since the last check, if anything; the check then counts as the last. */
  check(ctx: TravelContext): 'hurt' | 'robbed' | 'dark' | null {
    const { hp, gold, light } = this;
    this.note(ctx);
    if (hp !== null && ctx.hp < hp) return 'hurt';
    if (ctx.gold !== undefined && gold !== undefined && ctx.gold < gold) return 'robbed';
    if (ctx.snap.depth > 0 && light !== null && light > 0 && ctx.snap.lightRadius <= 0) return 'dark';
    return null;
  }

  private note(ctx: TravelContext): void {
    this.hp = ctx.hp;
    this.gold = ctx.gold;
    this.light = ctx.snap.lightRadius;
  }
}

export interface TravelOptions {
  /**
   * Hostile creatures in sight at the last step (at first, those in sight
   * when travel began); shared between journeys, so one that comes into
   * sight between them still stops the next.
   */
  inSight?: Set<number>;
  /** Only the one step to a neighbouring cell (a tap beside the hero): no stops on the way, and nothing to say after. */
  oneStep?: boolean;
  /** The watch kept by an exploration over all its journeys (else one of the journey's own). */
  watch?: Watch;
}

/**
 * Walks the player towards a goal one step per engine idle, stopping on
 * arrival, when hurt or robbed, when the light goes out, or when a hostile creature
 * comes into sight, asleep or awake (creatures already in sight do not
 * stop it). It also stops when the way keeps changing under it and the
 * hero comes back to where they have already been twice. A one-step
 * journey (`oneStep`) just takes that step.
 */
export class Travel {
  private readonly goal: Point;
  private readonly inSight: Set<number>;
  private readonly single: boolean;
  private readonly watch: Watch;
  private lastPos: Point | null = null;
  private lastWasMove = false;
  private lastDoor: Point | null = null;
  /* The direction of a door being opened, given once tome2 asks which door (it does not when only one is beside the hero). */
  private doorAnswer: { digit: number; path: Point[] } | null = null;
  private steps = 0;
  private finishing = false;
  /* The journey is to a creature (a tap on it): the creature at the goal neither stops it nor stands in its way. */
  private readonly quarry: boolean;
  private readonly visits = new Map<number, number>();

  /** Steps taken so far. */
  get walked(): number {
    return this.steps;
  }

  /** Only the one step (see `TravelOptions`). */
  get oneStep(): boolean {
    return this.single;
  }

  /** Waiting to tell tome2 which door to open. */
  get answering(): boolean {
    return this.doorAnswer !== null;
  }

  constructor(goal: Point, start: TravelContext, options: TravelOptions = {}) {
    this.goal = goal;
    this.inSight = options.inSight ?? new Set(hostilesInSight(start.monsters).map((m) => m.id));
    this.single = !!options.oneStep;
    this.watch = options.watch ?? new Watch(start);
    this.quarry = start.monsters.some((m) => m.x === goal.x && m.y === goal.y);
  }

  step(ctx: TravelContext): TravelStep {
    const { snap } = ctx;
    const pos = { x: snap.px, y: snap.py };

    const door = this.doorAnswer;
    this.doorAnswer = null;
    if (door && ctx.prompt === 'direction') return { kind: 'keys', keys: [door.digit], path: door.path };
    if (!snap.atCommand || snap.icky) return { kind: 'stop', reason: 'interrupted' };
    if (this.finishing || (pos.x === this.goal.x && pos.y === this.goal.y)) return { kind: 'stop', reason: 'arrived' };
    if (this.single && this.steps > 0) return { kind: 'stop', reason: 'interrupted' };
    const alarm = this.watch.check(ctx);
    if (alarm) return { kind: 'stop', reason: alarm };
    if (this.lastPos && gridDistance(this.lastPos, pos) > 1) {
      /* A new area of the land, or a teleport: the goal no longer means the same place. */
      return { kind: 'stop', reason: 'interrupted' };
    }
    if (this.lastWasMove && this.lastPos && this.lastPos.x === pos.x && this.lastPos.y === pos.y) {
      return { kind: 'stop', reason: 'blocked' };
    }
    if (!this.lastPos || this.lastPos.x !== pos.x || this.lastPos.y !== pos.y) {
      const here = pos.y * snap.width + pos.x;
      const visits = (this.visits.get(here) ?? 0) + 1;
      if (visits >= MAX_VISITS) return { kind: 'stop', reason: 'blocked' };
      this.visits.set(here, visits);
    }
    if (this.steps >= MAX_STEPS) return { kind: 'stop', reason: 'limit' };

    const atGoal = ctx.monsters.find((m) => m.x === this.goal.x && m.y === this.goal.y);
    const hostiles = hostilesInSight(ctx.monsters);
    const arrival = hostiles.find((m) => !this.inSight.has(m.id) && !(this.quarry && m === atGoal));
    this.inSight.clear();
    for (const m of hostiles) this.inSight.add(m.id);
    if (arrival && !this.single) return { kind: 'stop', reason: 'monster', creature: arrival.name, asleep: !!arrival.asleep };
    if (atGoal?.view && !this.quarry) return { kind: 'stop', reason: 'creatureInWay' };

    const path = findPath(travelGrid(snap, ctx.materials, ctx.passing), pos, this.goal);
    if (!path || path.length === 0) return { kind: 'stop', reason: 'unreachable' };

    const next = path[0];
    const digit = directionDigit(next.x - pos.x, next.y - pos.y)!.charCodeAt(0);
    const mat = ctx.materials[snap.feat[next.y * snap.width + next.x]];
    const closedDoor = !!mat && mat.door && !mat.walkable;
    const retryingDoor =
      closedDoor &&
      this.lastDoor?.x === next.x &&
      this.lastDoor.y === next.y &&
      this.lastPos?.x === pos.x &&
      this.lastPos.y === pos.y;
    if (retryingDoor) return { kind: 'stop', reason: 'shut' };

    this.steps++;
    this.lastPos = pos;

    if (closedDoor) {
      this.lastWasMove = false;
      this.lastDoor = next;
      this.doorAnswer = { digit, path };
      /* tome2 repeats `o` on a locked door (always_repeat); walking into it would try once. */
      return { kind: 'keys', keys: [BACKSLASH, OPEN], path };
    }

    this.lastWasMove = true;
    this.lastDoor = null;
    if (this.quarry && atGoal && path.length === 1) this.finishing = true;
    return { kind: 'keys', keys: [BACKSLASH, WALK, digit], path };
  }
}
