import type { Material } from '../render/materials.ts';
import { CAVE_MARK, CAVE_SEEN, isHostile, LAYER_MASK, LAYER_OBJECT, type LevelSnapshot } from '../render/snapshot.ts';
import type { Point } from './pathfinding.ts';
import { Travel, travelGrid, type TravelContext, type TravelStep } from './travel.ts';

const MAX_TARGETS = 500;
const MAX_RETRIES = 6;
/* Exploring only stops for awake creatures right next to the player (and new ones). */
const EXPLORE_DANGER_RADIUS = 1;
/* Each step between a place and the anchor counts this many times a step from the hero, up to `ANCHOR_REACH` steps. */
const ANCHOR_WEIGHT = 2;
/* How far the anchor's pull reaches: once nothing is left that close, the hero becomes the new anchor. */
const ANCHOR_REACH = 24;
/* Items to collect count as this many steps nearer than unexplored ground. */
const ITEM_GREED = 10;

export interface ExplorePlan {
  /** Cells exploring is done with (visited or out of reach); kept between explorations of a level. */
  skip: Set<number>;
  /** The way on, where exploring ends once nothing else is left. */
  isExit(index: number): boolean;
  /** The way back, taken instead where the level has no known way on (the bottom of a dungeon). */
  isBackExit?(index: number): boolean;
  /** Which way the way on leads, for the message at the end. */
  heading?: 'down' | 'up';
  /** Where exploring began: the map fills outwards from here. */
  anchor?: Point | null;
  /** Walk over items not yet stood on (the hero picks things up as they go). */
  collectItems?: boolean;
  /** Places that could not be reached during this exploration (a creature or a stuck door in the way). */
  avoid?: ReadonlySet<number>;
}

export type StopKind = 'item' | 'frontier' | 'exit';

export interface ExploreStop extends Point {
  kind: StopKind;
  /** The cell that counts as done on arrival. */
  mark: number;
  /** Beyond the anchor's reach (an edge of unexplored space or an item). */
  far?: boolean;
  /** A way back, as the level has no known way on. */
  back?: boolean;
}

function known(snap: LevelSnapshot, i: number): boolean {
  return (snap.info[i] & (CAVE_MARK | CAVE_SEEN)) !== 0;
}

function hasItem(snap: LevelSnapshot, i: number): boolean {
  return (snap.layer[i] & LAYER_MASK) === LAYER_OBJECT;
}

/** A known cell the eye can see past from, next to unknown space. */
export function isFrontier(snap: LevelSnapshot, materials: readonly Material[], i: number): boolean {
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

/** Steps from `start` to every cell a known way reaches (-1 elsewhere). */
function reach(snap: LevelSnapshot, materials: readonly Material[], start: number, throughCreatures: boolean): Int32Array {
  const { width, height } = snap;
  const grid = travelGrid(snap, materials, throughCreatures);
  const depth = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  depth[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
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
  return depth;
}

function stopAt(snap: LevelSnapshot, cell: number, kind: StopKind, mark = cell): ExploreStop {
  const x = cell % snap.width;
  return { x, y: (cell - x) / snap.width, kind, mark };
}

/**
 * Where exploring goes next. First the edges of unexplored space (and items
 * to collect), filling the map outwards from the anchor: a place scores its
 * steps from the hero plus `ANCHOR_WEIGHT` times its steps from the anchor
 * (counting at most `ANCHOR_REACH`), so the rooms and side passages near
 * where exploring began are seen before the far end of a corridor. Once
 * none are left, the nearest way on (which may be where the hero stands),
 * or the nearest way back on a level with no known way on.
 * Null when nothing is left within reach. With `throughCreatures`
 * creatures in view do not block the way.
 */
export function nextStop(snap: LevelSnapshot, materials: readonly Material[], plan: ExplorePlan, throughCreatures = false): ExploreStop | null {
  const { width } = snap;
  const start = snap.py * width + snap.px;
  const depth = reach(snap, materials, start, throughCreatures);
  const anchor = plan.anchor ? plan.anchor.y * width + plan.anchor.x : start;
  const fromAnchor = anchor === start ? depth : reach(snap, materials, anchor, throughCreatures);
  const anchorGap = fromAnchor[start];

  let best = -1;
  let bestKind: StopKind = 'frontier';
  let bestScore = Infinity;
  let bestAway = 0;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] <= 0 || plan.skip.has(i) || plan.avoid?.has(i)) continue;
    const item = !!plan.collectItems && hasItem(snap, i);
    if (!item && !isFrontier(snap, materials, i)) continue;
    const away = anchorGap < 0 ? 0 : Math.min(ANCHOR_REACH, fromAnchor[i] >= 0 ? fromAnchor[i] : depth[i] + anchorGap);
    const score = depth[i] + ANCHOR_WEIGHT * away - (item ? ITEM_GREED : 0);
    if (score < bestScore || (score === bestScore && depth[i] < depth[best])) {
      best = i;
      bestKind = item ? 'item' : 'frontier';
      bestScore = score;
      bestAway = away;
    }
  }
  if (best >= 0) return { ...stopAt(snap, best, bestKind), far: bestAway >= ANCHOR_REACH };

  const nearest = (isExit: (i: number) => boolean) => {
    let exit = -1;
    for (let i = 0; i < depth.length; i++) {
      if (depth[i] < 0 || plan.avoid?.has(i) || !isExit(i)) continue;
      if (exit < 0 || depth[i] < depth[exit]) exit = i;
    }
    return exit;
  };
  const exit = nearest(plan.isExit);
  if (exit >= 0) return stopAt(snap, exit, 'exit');
  const isBackExit = plan.isBackExit;
  if (!isBackExit || snap.info.some((info, i) => (info & (CAVE_MARK | CAVE_SEEN)) !== 0 && plan.isExit(i))) return null;
  const back = nearest(isBackExit);
  return back >= 0 ? { ...stopAt(snap, back, 'exit'), back: true } : null;
}

/**
 * Explores the level one step at a time, from one edge of unexplored space
 * to the next (see `nextStop`), collecting items on the way when the hero
 * picks things up, and choosing again as soon as its goal has been seen.
 * It stops as travel does (a creature, being hurt), and once the level is
 * explored it goes to the way on. Places reached, and those behind a door
 * that will not open, join the level's skip set; other places it could not
 * reach (a creature in the way) are passed over only until it stops.
 */
export class Explore {
  private travel: Travel | null = null;
  private stop: ExploreStop | null = null;
  private targets = 0;
  private lastHp: number | null = null;
  private readonly plan: ExplorePlan;
  private readonly noticed: Set<number>;
  private readonly avoid = new Set<number>();
  /** Hostiles in view when exploring began, shared by all its journeys (see `TravelOptions`). */
  private known: Set<number> | null = null;

  /** `noticed` is shared with travel (see `TravelOptions`). */
  constructor(plan: ExplorePlan, noticed: Set<number> = new Set()) {
    this.plan = { ...plan, avoid: this.avoid };
    this.noticed = noticed;
  }

  /** Where the map is filling out from now (it moves on once its surroundings are explored). */
  get anchor(): Point | null {
    return this.plan.anchor ?? null;
  }

  /** The message for a way on (or back) reached: which way it leads. */
  private exitReason(stop: ExploreStop): 'exit' | 'exitUp' {
    return (this.plan.heading === 'up') !== !!stop.back ? 'exitUp' : 'exit';
  }

  /** The goal still has something to show or collect. */
  private worthReaching(snap: LevelSnapshot, materials: readonly Material[]): boolean {
    const stop = this.stop;
    if (!stop) return false;
    if (stop.kind === 'frontier') return isFrontier(snap, materials, stop.mark);
    if (stop.kind === 'item') return hasItem(snap, stop.mark);
    return true;
  }

  /** Why no place is left: none at all, creatures in view stand in the way, or the way to one failed (a creature not yet seen, a stuck door). */
  private whyNothingLeft(snap: LevelSnapshot, materials: readonly Material[]): 'explored' | 'creatureInWay' | 'blocked' {
    const all = { ...this.plan, avoid: undefined };
    if (!nextStop(snap, materials, all, true)) return 'explored';
    return nextStop(snap, materials, all) ? 'blocked' : 'creatureInWay';
  }

  step(ctx: TravelContext): TravelStep {
    if (this.lastHp !== null && ctx.hp < this.lastHp) return { kind: 'stop', reason: 'hurt' };
    this.lastHp = ctx.hp;
    const { snap } = ctx;
    this.known ??= new Set(ctx.monsters.filter(isHostile).map((m) => m.id));
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (this.travel && !this.worthReaching(snap, ctx.materials)) this.travel = null;
      if (!this.travel) {
        if (this.targets >= MAX_TARGETS) return { kind: 'stop', reason: 'limit' };
        let stop = nextStop(snap, ctx.materials, this.plan);
        if (stop?.far && this.plan.anchor) {
          this.plan.anchor = { x: snap.px, y: snap.py };
          stop = nextStop(snap, ctx.materials, this.plan);
        }
        if (!stop) return { kind: 'stop', reason: this.whyNothingLeft(snap, ctx.materials) };
        if (stop.kind === 'exit' && stop.x === snap.px && stop.y === snap.py) return { kind: 'stop', reason: this.exitReason(stop) };
        this.stop = stop;
        this.targets++;
        this.travel = new Travel(stop, ctx, { dangerRadius: EXPLORE_DANGER_RADIUS, noticed: this.noticed, known: this.known });
      }
      const step = this.travel.step(ctx);
      if (step.kind === 'keys') return step;
      if (step.reason !== 'arrived' && step.reason !== 'unreachable' && step.reason !== 'blocked' && step.reason !== 'shut') return step;
      const stop = this.stop!;
      this.travel = null;
      const arrived = step.reason === 'arrived';
      if (stop.kind === 'exit' && arrived) return { kind: 'stop', reason: this.exitReason(stop) };
      if (arrived || (step.reason === 'shut' && stop.kind !== 'exit')) this.plan.skip.add(stop.mark);
      else this.avoid.add(stop.mark);
    }
    return { kind: 'stop', reason: 'blocked' };
  }
}

/* Terrain that leads on, by direction (stairs, shafts, the paths of flat lands). */
export const WAY_ON: Readonly<Record<'down' | 'up', RegExp>> = {
  down: /down staircase|shaft down|quest down|path to the next/,
  up: /up staircase|shaft up|quest up|path to the previous/,
};
