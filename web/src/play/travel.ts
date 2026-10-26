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
import { findPath, type Point, type TravelGrid } from './pathfinding.ts';
import { directionDigit } from './prompts.ts';

const MAX_STEPS = 400;
const DANGER_RADIUS = 2;
const BACKSLASH = 92;
const WALK = ';'.charCodeAt(0);
const OPEN = 'o'.charCodeAt(0);

export type TravelStopReason = 'arrived' | 'monster' | 'hurt' | 'blocked' | 'unreachable' | 'interrupted' | 'limit';

export type TravelStep = { kind: 'keys'; keys: number[]; path: Point[] } | { kind: 'stop'; reason: TravelStopReason };

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

function hostile(m: MonsterState): boolean {
  return isHostile(m);
}

/**
 * Walks the player towards a goal one step per engine idle, stopping in the
 * way Brogue's travel does: on arrival, when hurt, or when danger appears.
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

  constructor(goal: Point, start: TravelContext) {
    this.goal = goal;
    this.known = new Set(start.monsters.filter(hostile).map((m) => m.id));
    this.lastHp = start.hp;
  }

  step(ctx: TravelContext): TravelStep {
    const { snap } = ctx;
    const pos = { x: snap.px, y: snap.py };

    if (!snap.atCommand || snap.icky) return { kind: 'stop', reason: 'interrupted' };
    if (this.finishing || (pos.x === this.goal.x && pos.y === this.goal.y)) return { kind: 'stop', reason: 'arrived' };
    if (ctx.hp < this.lastHp) return { kind: 'stop', reason: 'hurt' };
    if (this.lastWasMove && this.lastPos && this.lastPos.x === pos.x && this.lastPos.y === pos.y) {
      return { kind: 'stop', reason: 'blocked' };
    }
    if (this.steps >= MAX_STEPS) return { kind: 'stop', reason: 'limit' };

    const goalIsMonster = ctx.monsters.some((m) => m.x === this.goal.x && m.y === this.goal.y);
    for (const m of ctx.monsters) {
      if (!hostile(m)) continue;
      if (m.x === this.goal.x && m.y === this.goal.y) continue;
      if (!this.known.has(m.id)) return { kind: 'stop', reason: 'monster' };
      if (!m.asleep && Math.max(Math.abs(m.x - pos.x), Math.abs(m.y - pos.y)) <= DANGER_RADIUS) {
        return { kind: 'stop', reason: 'monster' };
      }
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
}
