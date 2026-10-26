import type { Material } from '../render/materials.ts';
import { CAVE_MARK, CAVE_SEEN, LAYER_MASK, LAYER_OBJECT, type LevelSnapshot } from '../render/snapshot.ts';
import type { Point } from './pathfinding.ts';
import { Travel, travelGrid, type TravelContext, type TravelStep } from './travel.ts';

const MAX_TARGETS = 200;
const MAX_RETRIES = 6;
/* Exploring only stops for awake creatures right next to the player (and new ones). */
const EXPLORE_DANGER_RADIUS = 1;

/** Nearest known, reachable cell (other than the player's) that `match` accepts. */
export function nearestReachable(snap: LevelSnapshot, materials: readonly Material[], match: (index: number) => boolean): Point | null {
  const { width, height } = snap;
  const grid = travelGrid(snap, materials);
  const start = snap.py * width + snap.px;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    if (i !== start && match(i)) return { x, y };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] || !grid.passable(nx, ny)) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return null;
}

/**
 * Nearest reachable place worth walking to: an item lying on the floor, or
 * a known floor cell next to unexplored space. `skip` holds cell indices
 * already visited or found unreachable.
 */
export function exploreTarget(snap: LevelSnapshot, materials: readonly Material[], skip: ReadonlySet<number>): Point | null {
  const { width, height } = snap;
  const known = (x: number, y: number) => (snap.info[y * width + x] & (CAVE_MARK | CAVE_SEEN)) !== 0;
  return nearestReachable(snap, materials, (i) => {
    if (skip.has(i)) return false;
    if ((snap.layer[i] & LAYER_MASK) === LAYER_OBJECT) return true;
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !known(nx, ny)) return true;
      }
    }
    return false;
  });
}

/**
 * Explores the level one step at a time: travels to the nearest item or
 * unexplored edge, then the next, stopping as travel does (a creature, being
 * hurt) or when nothing reachable is left.
 */
export class Explore {
  private travel: Travel | null = null;
  private target: Point | null = null;
  private targetIsItem = false;
  private readonly skip: Set<number>;
  private targets = 0;

  private readonly isExit: (index: number) => boolean;
  private headingForExit = false;

  /**
   * `skip` persists between explorations of the same level; `isExit` marks
   * the way down, which exploring heads for once nothing else is left.
   */
  constructor(skip: Set<number>, isExit: (index: number) => boolean = () => false) {
    this.skip = skip;
    this.isExit = isExit;
  }

  step(ctx: TravelContext): TravelStep {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (!this.travel) {
        if (this.targets >= MAX_TARGETS) return { kind: 'stop', reason: 'limit' };
        this.target = exploreTarget(ctx.snap, ctx.materials, this.skip);
        if (!this.target) {
          if (this.headingForExit || this.isExit(ctx.snap.py * ctx.snap.width + ctx.snap.px)) return { kind: 'stop', reason: 'explored' };
          this.target = nearestReachable(ctx.snap, ctx.materials, this.isExit);
          if (!this.target) return { kind: 'stop', reason: 'explored' };
          this.headingForExit = true;
        }
        this.targetIsItem = (ctx.snap.layer[this.target.y * ctx.snap.width + this.target.x] & LAYER_MASK) === LAYER_OBJECT;
        this.targets++;
        this.travel = new Travel(this.target, ctx, EXPLORE_DANGER_RADIUS);
      }
      const step = this.travel.step(ctx);
      if (step.kind === 'keys') return step;
      if (step.reason !== 'arrived' && step.reason !== 'unreachable') return step;
      if (this.headingForExit) return { kind: 'stop', reason: step.reason === 'arrived' ? 'exit' : 'explored' };
      if (this.target) this.skip.add(this.target.y * ctx.snap.width + this.target.x);
      this.travel = null;
      if (step.reason === 'arrived' && this.targetIsItem && ctx.snap.floorObjects > 0) return { kind: 'stop', reason: 'item' };
    }
    return { kind: 'stop', reason: 'blocked' };
  }
}
