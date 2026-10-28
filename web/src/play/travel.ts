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
const DANGER_RADIUS = 2;
const WALK = ';'.charCodeAt(0);
const OPEN = 'o'.charCodeAt(0);

export type TravelStopReason = 'arrived' | 'monster' | 'hurt' | 'blocked' | 'unreachable' | 'interrupted' | 'limit' | 'explored' | 'item' | 'exit';

export type TravelStep =
  | { kind: 'keys'; keys: number[]; path: Point[] }
  | { kind: 'stop'; reason: TravelStopReason; /** The creature that stopped travel. */ creature?: string };

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
  unreachable: 'There is no known way there.',
  interrupted: null,
  limit: 'You stop to get your bearings.',
  explored: 'Nothing left to explore within reach.',
  item: 'You found something.',
  exit: 'Explored. The way down is here.',
};

/** Walkable, known cells; visible monsters block except at the goal. */
export function travelGrid(snap: LevelSnapshot, materials: readonly Material[]): TravelGrid {
  return {
    width: snap.width,
    height: snap.height,
    passable(x, y) {
      const i = y * snap.width + x;
      if (!(snap.info[i] & (CAVE_MARK | CAVE_SEEN))) return false;
      if ((snap.layer[i] & LAYER_MASK) === LAYER_MONSTER) return false;
      const m = materials[snap.feat[i]];
      return !!m && (m.walkable || m.door);
    },
    penalty(x, y) {
      const m = materials[snap.feat[y * snap.width + x]];
      return m && m.door && !m.walkable ? 2 : 0;
    },
  };
}

/**
 * The border cell nearest a point outside the level, for walking off the
 * edge of an area of the land into the next; null for a point inside.
 */
export function edgeCell(width: number, height: number, point: Point): Point | null {
  if (point.x >= 0 && point.y >= 0 && point.x < width && point.y < height) return null;
  return { x: Math.max(0, Math.min(width - 1, point.x)), y: Math.max(0, Math.min(height - 1, point.y)) };
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
}

/**
 * Walks the player towards a goal one step per engine idle, stopping in the
 * way Brogue's travel does: on arrival, when hurt, or when danger appears
 * (a new awake hostile creature, or a known one awake and close). Each
 * creature stops travel only once while it stays in sight.
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

  private readonly dangerRadius: number;
  private readonly noticed: Set<number>;

  constructor(goal: Point, start: TravelContext, options: TravelOptions = {}) {
    this.goal = goal;
    this.dangerRadius = options.dangerRadius ?? DANGER_RADIUS;
    this.noticed = options.noticed ?? new Set();
    forgetUnseen(this.noticed, start.monsters);
    this.known = new Set(start.monsters.filter(isHostile).map((m) => m.id));
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
    if (retryingDoor) return { kind: 'stop', reason: 'blocked' };

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
