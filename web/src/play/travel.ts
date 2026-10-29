import type { Material } from '../render/materials.ts';
import {
  CAVE_MARK,
  CAVE_SEEN,
  LAYER_MASK,
  LAYER_MONSTER,
  isHostile,
  type LevelSnapshot,
  type MonsterState,
} from '../render/snapshot.ts';
import { KEY_BACKSLASH as BACKSLASH } from '../input/keys.ts';
import { findPath, type Point, type TravelGrid } from './pathfinding.ts';
import { directionDigit } from './prompts.ts';

const MAX_STEPS = 400;
/* Visits to one cell that end a journey as going round in circles. */
const MAX_VISITS = 3;
const DANGER_RADIUS = 2;
const WALK = ';'.charCodeAt(0);
const OPEN = 'o'.charCodeAt(0);

export type TravelStopReason =
  | 'arrived'
  | 'monster'
  | 'hurt'
  | 'blocked'
  | 'shut'
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
    };

export interface TravelContext {
  snap: LevelSnapshot;
  materials: readonly Material[];
  monsters: readonly MonsterState[];
  hp: number;
}

export const STOP_MESSAGES: Record<TravelStopReason, string | null> = {
  arrived: null,
  monster: 'You stop: a creature is near.',
  hurt: 'You stop: you are hurt.',
  blocked: 'You stop: the way is blocked.',
  shut: 'You stop: the door will not open.',
  unreachable: 'You know no way there yet.',
  interrupted: null,
  limit: 'You stop to get your bearings.',
  explored: 'Nothing left to explore within reach.',
  exit: 'Explored. The way down is here.',
  exitUp: 'Explored. The way up is here.',
  closest: 'This is as far as you know the way.',
  creatureInWay: 'A creature stands in the way.',
};

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

/** Walkable cells the player knows of; visible monsters block (except at the goal) unless `throughCreatures`. */
export function travelGrid(snap: LevelSnapshot, materials: readonly Material[], throughCreatures = false): TravelGrid {
  return {
    width: snap.width,
    height: snap.height,
    passable(x, y) {
      const i = y * snap.width + x;
      if (!throughCreatures && (snap.layer[i] & LAYER_MASK) === LAYER_MONSTER) return false;
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
export function approachTarget(snap: LevelSnapshot, materials: readonly Material[], goal: Point): Approach | null {
  const { width, height } = snap;
  const grid = travelGrid(snap, materials);
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
 * The border cell nearest a point outside the level, for walking off the
 * edge of an area of the land into the next; null for a point inside.
 */
export function edgeCell(width: number, height: number, point: Point): Point | null {
  if (point.x >= 0 && point.y >= 0 && point.x < width && point.y < height) return null;
  return { x: Math.max(0, Math.min(width - 1, point.x)), y: Math.max(0, Math.min(height - 1, point.y)) };
}

/** Whether the player has seen or remembers a cell. */
export function isKnown(snap: LevelSnapshot, point: Point): boolean {
  if (point.x < 0 || point.y < 0 || point.x >= snap.width || point.y >= snap.height) return false;
  return (snap.info[point.y * snap.width + point.x] & (CAVE_MARK | CAVE_SEEN)) !== 0;
}

/** Forgets noticed creatures that are no longer in sight. */
export function forgetUnseen(noticed: Set<number>, monsters: readonly MonsterState[]): void {
  if (noticed.size === 0) return;
  const inSight = new Set(monsters.map((m) => m.id));
  for (const id of noticed) if (!inSight.has(id)) noticed.delete(id);
}

export interface TravelOptions {
  /** Awake hostile creatures this close stop travel. */
  dangerRadius?: number;
  /**
   * Creatures that have already stopped travel once, shared between
   * journeys; one that drops out of sight is forgotten.
   */
  noticed?: Set<number>;
  /**
   * Hostile creatures already in view when travel began (others stop it on
   * sight); shared between journeys, so one first seen between them still does.
   */
  known?: Set<number>;
}

/**
 * Walks the player towards a goal one step per engine idle, stopping in the
 * way Brogue's travel does: on arrival, when hurt, or when danger appears
 * (a new awake hostile creature, or a known one awake and close). Each
 * creature stops travel only once while it stays in sight. It also stops
 * when the way keeps changing under it and the hero comes back to where
 * they have already been twice.
 */
export class Travel {
  readonly goal: Point;
  private readonly known: Set<number>;
  private lastHp: number;
  private lastPos: Point | null = null;
  private lastWasMove = false;
  private lastDoor: Point | null = null;
  private steps = 0;
  private finishing = false;
  private readonly visits = new Map<number, number>();

  private readonly dangerRadius: number;
  private readonly noticed: Set<number>;

  constructor(goal: Point, start: TravelContext, options: TravelOptions = {}) {
    this.goal = goal;
    this.dangerRadius = options.dangerRadius ?? DANGER_RADIUS;
    this.noticed = options.noticed ?? new Set();
    forgetUnseen(this.noticed, start.monsters);
    this.known = options.known ?? new Set(start.monsters.filter(isHostile).map((m) => m.id));
    this.lastHp = start.hp;
  }

  step(ctx: TravelContext): TravelStep {
    const { snap } = ctx;
    const pos = { x: snap.px, y: snap.py };
    forgetUnseen(this.noticed, ctx.monsters);

    if (!snap.atCommand || snap.icky) return { kind: 'stop', reason: 'interrupted' };
    if (this.finishing || (pos.x === this.goal.x && pos.y === this.goal.y)) return { kind: 'stop', reason: 'arrived' };
    if (ctx.hp < this.lastHp) return { kind: 'stop', reason: 'hurt' };
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
    for (const m of ctx.monsters) {
      if (!isHostile(m) || this.noticed.has(m.id)) continue;
      if (m.x === this.goal.x && m.y === this.goal.y) continue;
      if (!this.known.has(m.id)) {
        if (!m.asleep) return this.notice(m);
        this.known.add(m.id);
      }
      if (!m.asleep && Math.max(Math.abs(m.x - pos.x), Math.abs(m.y - pos.y)) <= this.dangerRadius) return this.notice(m);
    }

    const path = findPath(travelGrid(snap, ctx.materials), pos, this.goal);
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

  private notice(m: MonsterState): TravelStep {
    this.noticed.add(m.id);
    return { kind: 'stop', reason: 'monster', creature: m.name };
  }
}
