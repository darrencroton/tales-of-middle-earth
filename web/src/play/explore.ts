import type { Material } from '../render/materials.ts';
import { CAVE_MARK, CAVE_SEEN, LAYER_MASK, LAYER_OBJECT, type LevelSnapshot } from '../render/snapshot.ts';
import type { Point } from './pathfinding.ts';
import { Travel, travelGrid, type TravelContext, type TravelStep } from './travel.ts';

const MAX_TARGETS = 200;
const MAX_RETRIES = 6;
/* Exploring only stops for awake creatures right next to the player (and new ones). */
const EXPLORE_DANGER_RADIUS = 1;

export interface ExplorePlan {
  /** Cells exploring is done with (visited or out of reach); kept between explorations of a level. */
  skip: Set<number>;
  /** The way on, where exploring ends once nothing else is left. */
  isExit(index: number): boolean;
  /** Places worth a visit once the level is explored: shops, fountains, altars, gates. */
  isLandmark?(index: number): boolean;
  /** Landmarks visited from a cell beside them (stepping onto a shop door goes inside). */
  besideLandmark?(index: number): boolean;
  /** Which way the way on leads, for the message at the end. */
  heading?: 'down' | 'up';
}

export type StopKind = 'item' | 'frontier' | 'landmark' | 'exit';

export interface ExploreStop extends Point {
  kind: StopKind;
  /** The cell that counts as done on arrival (the landmark itself when visited from beside it). */
  mark: number;
}

function known(snap: LevelSnapshot, i: number): boolean {
  return (snap.info[i] & (CAVE_MARK | CAVE_SEEN)) !== 0;
}

/** A known cell the eye can see past from, next to unknown space. */
function isFrontier(snap: LevelSnapshot, materials: readonly Material[], i: number): boolean {
  if (!known(snap, i)) return false;
  const m = materials[snap.feat[i]];
  if (!m || !(m.door || (m.walkable && !m.blocksLight))) return false;
  const { width, height } = snap;
  const x = i % width;
  const y = (i - x) / width;
  for (let ny = y - 1; ny <= y + 1; ny++) {
    for (let nx = x - 1; nx <= x + 1; nx++) {
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && !known(snap, ny * width + nx)) return true;
    }
  }
  return false;
}

/** Steps from the player to every cell a known way reaches (-1 elsewhere), in breadth-first order. */
function reach(snap: LevelSnapshot, materials: readonly Material[], throughCreatures: boolean): { depth: Int32Array; order: Int32Array; count: number } {
  const { width, height } = snap;
  const grid = travelGrid(snap, materials, throughCreatures);
  const depth = new Int32Array(width * height).fill(-1);
  const order = new Int32Array(width * height);
  const start = snap.py * width + snap.px;
  let head = 0;
  let tail = 0;
  depth[start] = 0;
  order[tail++] = start;
  while (head < tail) {
    const i = order[head++];
    const x = i % width;
    const y = (i - x) / width;
    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let nx = x - 1; nx <= x + 1; nx++) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (depth[next] >= 0 || !grid.passable(nx, ny)) continue;
        depth[next] = depth[i] + 1;
        order[tail++] = next;
      }
    }
  }
  return { depth, order, count: tail };
}

function stopAt(snap: LevelSnapshot, cell: number, kind: StopKind, mark = cell): ExploreStop {
  const x = cell % snap.width;
  return { x, y: (cell - x) / snap.width, kind, mark };
}

/**
 * Where exploring goes next: the nearest item lying about or edge of
 * unexplored space; once there are none, the nearest landmark not yet
 * visited; and last the nearest way on (which may be where the player
 * stands). Null when nothing is left within reach. With `throughCreatures`
 * creatures in view do not block the way.
 */
export function nextStop(snap: LevelSnapshot, materials: readonly Material[], plan: ExplorePlan, throughCreatures = false): ExploreStop | null {
  const { width } = snap;
  const start = snap.py * width + snap.px;
  const { depth, order, count } = reach(snap, materials, throughCreatures);

  for (let k = 1; k < count; k++) {
    const i = order[k];
    if (plan.skip.has(i)) continue;
    if ((snap.layer[i] & LAYER_MASK) === LAYER_OBJECT) return stopAt(snap, i, 'item');
    if (isFrontier(snap, materials, i)) return stopAt(snap, i, 'frontier');
  }

  if (plan.isLandmark) {
    let best: ExploreStop | null = null;
    let bestDepth = Infinity;
    for (let i = 0; i < depth.length; i++) {
      if (plan.skip.has(i) || !known(snap, i) || !plan.isLandmark(i)) continue;
      const beside = plan.besideLandmark?.(i) ?? false;
      let cell = !beside && depth[i] >= 0 ? i : -1;
      if (cell < 0) {
        const x = i % width;
        const y = (i - x) / width;
        for (let ny = y - 1; ny <= y + 1; ny++) {
          for (let nx = x - 1; nx <= x + 1; nx++) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= snap.height || (nx === x && ny === y)) continue;
            const n = ny * width + nx;
            if (depth[n] >= 0 && (cell < 0 || depth[n] < depth[cell])) cell = n;
          }
        }
      }
      if (cell < 0 || cell === start || depth[cell] >= bestDepth) continue;
      best = stopAt(snap, cell, 'landmark', i);
      bestDepth = depth[cell];
    }
    if (best) return best;
  }

  let exit = -1;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] < 0 || plan.skip.has(i) || !plan.isExit(i)) continue;
    if (exit < 0 || depth[i] < depth[exit]) exit = i;
  }
  return exit >= 0 ? stopAt(snap, exit, 'exit') : null;
}

/** Nearest item or edge of unexplored space, ignoring landmarks and the way on. */
export function exploreTarget(snap: LevelSnapshot, materials: readonly Material[], skip: ReadonlySet<number>): Point | null {
  const stop = nextStop(snap, materials, { skip: skip as Set<number>, isExit: () => false });
  return stop ? { x: stop.x, y: stop.y } : null;
}

/**
 * Explores the level one step at a time: travels to the nearest item or
 * unexplored edge, then the next, stopping as travel does (a creature, being
 * hurt) or at an item. With the level explored it tours the landmarks one
 * stop at a time and ends at the way on.
 */
export class Explore {
  private travel: Travel | null = null;
  private stop: ExploreStop | null = null;
  private targets = 0;
  private lastHp: number | null = null;
  private readonly plan: ExplorePlan;
  private readonly noticed: Set<number>;

  /** `noticed` is shared with travel (see `TravelOptions`). */
  constructor(plan: ExplorePlan, noticed: Set<number> = new Set()) {
    this.plan = plan;
    this.noticed = noticed;
  }

  private get exitReason(): 'exit' | 'exitUp' {
    return this.plan.heading === 'up' ? 'exitUp' : 'exit';
  }

  step(ctx: TravelContext): TravelStep {
    if (this.lastHp !== null && ctx.hp < this.lastHp) return { kind: 'stop', reason: 'hurt' };
    this.lastHp = ctx.hp;
    const { snap } = ctx;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (!this.travel) {
        if (this.targets >= MAX_TARGETS) return { kind: 'stop', reason: 'limit' };
        const stop = nextStop(snap, ctx.materials, this.plan);
        if (!stop) {
          const blocked = nextStop(snap, ctx.materials, this.plan, true);
          return { kind: 'stop', reason: blocked ? 'creatureInWay' : 'explored' };
        }
        if (stop.kind === 'exit' && stop.x === snap.px && stop.y === snap.py) return { kind: 'stop', reason: this.exitReason };
        this.stop = stop;
        this.targets++;
        this.travel = new Travel(stop, ctx, { dangerRadius: EXPLORE_DANGER_RADIUS, noticed: this.noticed });
      }
      const step = this.travel.step(ctx);
      if (step.kind === 'keys') return step;
      if (step.reason !== 'arrived' && step.reason !== 'unreachable' && step.reason !== 'blocked') return step;
      const stop = this.stop!;
      this.travel = null;
      const arrived = step.reason === 'arrived';
      if (stop.kind === 'exit') {
        if (arrived) return { kind: 'stop', reason: this.exitReason };
        this.plan.skip.add(stop.mark);
        continue;
      }
      this.plan.skip.add(stop.mark);
      if (!arrived) continue;
      if (stop.kind === 'item' && snap.floorObjects > 0) return { kind: 'stop', reason: 'item' };
      if (stop.kind === 'landmark') return { kind: 'stop', reason: 'landmark', place: stop.mark };
    }
    return { kind: 'stop', reason: 'blocked' };
  }
}

/* Terrain that leads on, by direction (stairs, shafts, the paths of flat lands). */
export const WAY_ON: Readonly<Record<'down' | 'up', RegExp>> = {
  down: /down staircase|shaft down|quest down|path to the next/,
  up: /up staircase|shaft up|quest up|path to the previous/,
};

const LANDMARK = /fountain|altar|jumpgate|^building$|quest entrance|straight road startpoint/;
const BESIDE = /^building$/;

/** Terrain worth a visit once a level is explored. */
export function isLandmarkFeature(name: string): boolean {
  return LANDMARK.test(name.toLowerCase());
}

/** Landmarks visited from beside them: stepping onto a shop door goes inside. */
export function isBesideFeature(name: string): boolean {
  return BESIDE.test(name.toLowerCase());
}

/** How a landmark is named when exploring reaches it. */
export function landmarkName(name: string): string {
  const lower = name.toLowerCase();
  if (BESIDE.test(lower)) return 'a shop door';
  if (/straight road/.test(lower)) return 'the start of the Straight Road';
  if (/^altar of/.test(lower)) return `the ${name}`;
  return `${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${/^[A-Z][a-z]+ [A-Z]/.test(name) ? name : lower}`;
}
