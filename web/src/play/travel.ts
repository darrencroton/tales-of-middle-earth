import type { Material } from '../render/materials.ts';
import {
  CAVE_MARK,
  CAVE_SEEN,
  LAYER_MASK,
  LAYER_MONSTER,
  isAlly,
  isHostile,
  isNeutral,
  type LevelSnapshot,
  type MonsterState,
} from '../render/snapshot.ts';
import { KEY_BACKSLASH as BACKSLASH } from '../input/keys.ts';
import { titleName } from '../ui/api.ts';
import { findPath, type Point, type TravelGrid } from './pathfinding.ts';
import { directionDigit, isAdjacent, type PromptKind } from './prompts.ts';

const MAX_STEPS = 400;
/* Visits to one cell that end a journey as going round in circles. */
const MAX_VISITS = 3;
const WALK = ';'.charCodeAt(0);
const OPEN = 'o'.charCodeAt(0);

export type TravelStopReason =
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
  | 'closest'
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
  /** Cells of companions the hero can push past (`pushPast`). */
  passing?: ReadonlySet<number>;
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
  closest: 'This is as far as you know the way.',
  creatureInWay: 'A creature stands in the way.',
};

/** Steps a walk that stops short of an unknown place takes before it says so. */
export const FAR_WALK_STEPS = 10;

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
  if (step.reason === 'arrived' && ctx.approximate) return !ctx.exploring && ctx.walked >= FAR_WALK_STEPS ? STOP_MESSAGES.closest : null;
  return STOP_MESSAGES[step.reason];
}

function isKnownIndex(snap: LevelSnapshot, i: number): boolean {
  return (snap.info[i] & (CAVE_MARK | CAVE_SEEN)) !== 0;
}

/** A known cell the player cannot walk through (a wall, a tree, a mountain). */
function knownBarrier(snap: LevelSnapshot, materials: readonly Material[], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= snap.width || y >= snap.height) return true;
  const i = y * snap.width + x;
  if (!isKnownIndex(snap, i)) return false;
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

/** Creatures a way may lead through: those at these cells (companions the hero pushes past), or all of them ('all', to ask whether creatures alone stand in the way). */
export type Passing = ReadonlySet<number> | 'all';

const NOBODY: ReadonlySet<number> = new Set();

/** Walkable cells the player knows of; creatures in view block, but for those `passing` lets through. */
export function travelGrid(snap: LevelSnapshot, materials: readonly Material[], passing: Passing = NOBODY): TravelGrid {
  return {
    width: snap.width,
    height: snap.height,
    passable(x, y) {
      const i = y * snap.width + x;
      if (passing !== 'all' && !passing.has(i) && (snap.layer[i] & LAYER_MASK) === LAYER_MONSTER) return false;
      if (!isKnownIndex(snap, i)) return inferredFloor(snap, materials, x, y);
      const m = materials[snap.feat[i]];
      return !!m && (m.walkable || m.door);
    },
    penalty(x, y) {
      const i = y * snap.width + x;
      if (!isKnownIndex(snap, i)) return 0.5;
      const m = materials[snap.feat[i]];
      return m && m.door && !m.walkable ? 2 : 0;
    },
  };
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
  const enterable = inside && isKnownIndex(snap, goalIndex) && !!goalMat && (goalMat.walkable || goalMat.door);

  const depth = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  depth[start] = 0;
  queue[tail++] = start;
  const distance = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    return Math.max(Math.abs(goal.x - x), Math.abs(goal.y - y)) + 0.001 * Math.hypot(goal.x - x, goal.y - y);
  };
  let best = start;
  let bestDistance = distance(start);

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    if (enterable && Math.max(Math.abs(goal.x - x), Math.abs(goal.y - y)) <= 1) return { point: goal, exact: true };
    const d = distance(i);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let nx = x - 1; nx <= x + 1; nx++) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (depth[next] >= 0 || !grid.passable(nx, ny)) continue;
        depth[next] = depth[i] + 1;
        queue[tail++] = next;
      }
    }
  }
  if (best === start) return null;
  return { point: { x: best % width, y: Math.floor(best / width) }, exact: best === goalIndex };
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
  return (snap.info[point.y * snap.width + point.x] & (CAVE_MARK | CAVE_SEEN)) !== 0;
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
  | { kind: 'none' };

/**
 * Where a tap on the map takes the hero: travel to a place they have seen,
 * one step to a neighbouring cell, and one step towards anywhere unseen,
 * blank screen beyond the level included. A tap on a neutral creature beside
 * the hero talks to it, where a step would only stop short of it (after
 * Pixel Dungeon, whose townsfolk answer a tap).
 */
export function goAction(
  snap: LevelSnapshot,
  materials: readonly Material[],
  point: Point,
  monsters: readonly MonsterState[] = [],
): Extract<TapAction, { kind: 'travel' | 'step' | 'talk' | 'none' }> {
  const known = isKnown(snap, point);
  const near = isAdjacent(snap.px, snap.py, point.x, point.y);
  if (known && !near) return { kind: 'travel', cell: point };
  if (near && monsters.some((m) => m.x === point.x && m.y === point.y && isNeutral(m))) {
    return { kind: 'talk', digit: directionDigit(point.x - snap.px, point.y - snap.py) ?? '5' };
  }
  const step = known ? point : stepTowards(snap, materials, point);
  return step ? { kind: 'step', cell: step } : { kind: 'none' };
}

/**
 * What a tap on a map cell does for the question tome2 is asking: choose a
 * direction or target, interrupt a rest or run, wait in place, or go there.
 */
export function tapAction(snap: LevelSnapshot, materials: readonly Material[], cell: Point, prompt: PromptKind, monsters: readonly MonsterState[] = []): TapAction {
  const near = isAdjacent(snap.px, snap.py, cell.x, cell.y);
  const direction = (): TapAction => ({ kind: 'direction', digit: directionDigit(cell.x - snap.px, cell.y - snap.py) ?? '5' });
  if (prompt === 'direction') return near ? direction() : { kind: 'none' };
  if (prompt === 'aim') return near ? direction() : { kind: 'target', cell };
  /* Resting, running or repeating: a tap interrupts it. */
  if (!snap.atCommand) return prompt === 'none' ? { kind: 'interrupt' } : { kind: 'none' };
  if (cell.x === snap.px && cell.y === snap.py) return { kind: 'wait' };
  return goAction(snap, materials, cell, monsters);
}

/** What keeps the hero from pushing past a companion: tome2 makes them stop, or strike, while confused, stunned or seeing things. */
export interface Steadiness {
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
    if (!isAlly(m) || (!onFloor && Math.max(Math.abs(m.x - snap.px), Math.abs(m.y - snap.py)) <= 1)) continue;
    cells.add(m.y * snap.width + m.x);
  }
  return cells;
}

/** Hostile creatures in the hero's line of sight (not those only sensed, by telepathy or detection). */
export function hostilesInSight(monsters: readonly MonsterState[]): MonsterState[] {
  return monsters.filter((m) => isHostile(m) && !!m.view);
}

/** Whether gold carried has dropped since the last step (a thief's touch does no harm to health). */
export function robbed(gold: number | undefined, lastGold: number | undefined): boolean {
  return gold !== undefined && lastGold !== undefined && gold < lastGold;
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
}

/** Whether the light carried has just gone out below the town. */
export function lightWentOut(snap: Pick<LevelSnapshot, 'depth' | 'lightRadius'>, lastLight: number | null): boolean {
  return snap.depth > 0 && lastLight !== null && lastLight > 0 && snap.lightRadius <= 0;
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
  readonly goal: Point;
  private readonly inSight: Set<number>;
  private readonly single: boolean;
  private lastHp: number;
  private lastLight: number;
  private lastGold: number | undefined;
  private lastPos: Point | null = null;
  private lastWasMove = false;
  private lastDoor: Point | null = null;
  private steps = 0;
  private finishing = false;
  private readonly visits = new Map<number, number>();

  /** Steps taken so far. */
  get walked(): number {
    return this.steps;
  }

  /** Only the one step (see `TravelOptions`). */
  get oneStep(): boolean {
    return this.single;
  }

  constructor(goal: Point, start: TravelContext, options: TravelOptions = {}) {
    this.goal = goal;
    this.inSight = options.inSight ?? new Set(hostilesInSight(start.monsters).map((m) => m.id));
    this.single = !!options.oneStep;
    this.lastHp = start.hp;
    this.lastGold = start.gold;
    this.lastLight = start.snap.lightRadius;
  }

  step(ctx: TravelContext): TravelStep {
    const { snap } = ctx;
    const pos = { x: snap.px, y: snap.py };

    if (!snap.atCommand || snap.icky) return { kind: 'stop', reason: 'interrupted' };
    if (this.finishing || (pos.x === this.goal.x && pos.y === this.goal.y)) return { kind: 'stop', reason: 'arrived' };
    if (this.single && this.steps > 0) return { kind: 'stop', reason: 'interrupted' };
    if (ctx.hp < this.lastHp) return { kind: 'stop', reason: 'hurt' };
    if (robbed(ctx.gold, this.lastGold)) return { kind: 'stop', reason: 'robbed' };
    if (lightWentOut(snap, this.lastLight)) return { kind: 'stop', reason: 'dark' };
    if (this.lastPos && Math.max(Math.abs(this.lastPos.x - pos.x), Math.abs(this.lastPos.y - pos.y)) > 1) {
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

    const goalIsMonster = ctx.monsters.some((m) => m.x === this.goal.x && m.y === this.goal.y);
    const hostiles = hostilesInSight(ctx.monsters);
    const arrival = hostiles.find((m) => !this.inSight.has(m.id) && (m.x !== this.goal.x || m.y !== this.goal.y));
    this.inSight.clear();
    for (const m of hostiles) this.inSight.add(m.id);
    if (arrival && !this.single) return { kind: 'stop', reason: 'monster', creature: arrival.name, asleep: !!arrival.asleep };

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
    this.lastHp = ctx.hp;
    this.lastGold = ctx.gold;
    this.lastLight = snap.lightRadius;
    this.lastPos = pos;

    if (closedDoor) {
      this.lastWasMove = false;
      this.lastDoor = next;
      return { kind: 'keys', keys: [BACKSLASH, OPEN, digit], path };
    }

    this.lastWasMove = true;
    this.lastDoor = null;
    if (goalIsMonster && path.length === 1) this.finishing = true;
    return { kind: 'keys', keys: [BACKSLASH, WALK, digit], path };
  }

}
