import type { Material } from '../render/materials.ts';
import { isKnownCell, LAYER_MASK, LAYER_MONSTER, LAYER_OBJECT, type LevelSnapshot, type ObjectState } from '../render/snapshot.ts';
import { floodFill, gridDistance, type Point } from './pathfinding.ts';
import { hostilesInSight, Travel, travelGrid, Watch, type Passing, type TravelContext, type TravelStep } from './travel.ts';

const MAX_TARGETS = 500;
const MAX_RETRIES = 6;
/* Each step between a place and the anchor counts this many times a step from the hero, up to `ANCHOR_REACH` steps. */
const ANCHOR_WEIGHT = 2;
/* How far the anchor's pull reaches: once nothing is left that close, the hero becomes the new anchor. */
const ANCHOR_REACH = 24;
/* Items to collect count as this many steps nearer than unexplored ground. */
const ITEM_GREED = 10;
/* Exploring carries on from where it began when the hero is about where it last stopped. */
const ANCHOR_DRIFT = 3;

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
  /** Items worth walking over, by cell: everything for a hero who picks things up as they go, money for everyone. */
  collect?(index: number): boolean;
  /** Places that could not be reached during this exploration (a creature or a stuck door in the way). */
  avoid?: ReadonlySet<number>;
}

type StopKind = 'item' | 'frontier' | 'exit';

interface ExploreStop extends Point {
  kind: StopKind;
  /** The cell that counts as done on arrival. */
  mark: number;
  /** Beyond the anchor's reach (an edge of unexplored space or an item). */
  far?: boolean;
  /** Which way an exit leads. */
  heading?: 'down' | 'up';
}

function hasItem(snap: LevelSnapshot, i: number): boolean {
  return (snap.layer[i] & LAYER_MASK) === LAYER_OBJECT;
}

/** A known cell the eye can see past from, next to unknown space. */
function isFrontier(snap: LevelSnapshot, materials: readonly Material[], i: number): boolean {
  if (!isKnownCell(snap.info, i)) return false;
  const m = materials[snap.feat[i]];
  if (!m || !(m.door || (m.walkable && !m.blocksLight))) return false;
  const { width, height } = snap;
  const x = i % width;
  const y = (i - x) / width;
  for (let ny = y - 1; ny <= y + 1; ny++) {
    for (let nx = x - 1; nx <= x + 1; nx++) {
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && !isKnownCell(snap.info, ny * width + nx)) return true;
    }
  }
  return false;
}

/** Steps from `start` to every cell a known way reaches (-1 elsewhere). */
function reach(snap: LevelSnapshot, materials: readonly Material[], start: Point, passing: Passing): Int32Array {
  return floodFill(travelGrid(snap, materials, passing), start);
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
 * Null when nothing is left within reach. Creatures in view block the way,
 * but for those `passing` lets through (see `travelGrid`).
 */
export function nextStop(snap: LevelSnapshot, materials: readonly Material[], plan: ExplorePlan, passing: Passing = new Set()): ExploreStop | null {
  const start = snap.py * snap.width + snap.px;
  const depth = reach(snap, materials, { x: snap.px, y: snap.py }, passing);
  const anchor = plan.anchor ?? null;
  const fromAnchor = !anchor || anchor.y * snap.width + anchor.x === start ? depth : reach(snap, materials, anchor, passing);
  const anchorGap = fromAnchor[start];

  let best = -1;
  let bestKind: StopKind = 'frontier';
  let bestScore = Infinity;
  let bestAway = 0;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] <= 0 || plan.skip.has(i) || plan.avoid?.has(i)) continue;
    const item = hasItem(snap, i) && !!plan.collect?.(i);
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
  const heading = plan.heading ?? 'down';
  const exit = nearest(plan.isExit);
  if (exit >= 0) return { ...stopAt(snap, exit, 'exit'), heading };
  const isBackExit = plan.isBackExit;
  if (!isBackExit || snap.info.some((_, i) => isKnownCell(snap.info, i) && plan.isExit(i))) return null;
  const back = nearest(isBackExit);
  return back >= 0 ? { ...stopAt(snap, back, 'exit'), heading: heading === 'up' ? 'down' : 'up' } : null;
}

/** Why exploring has nowhere to go: nothing left within reach, creatures in view stand in the way, or the way to each place left failed (`plan.avoid`: a creature not yet seen, a stuck door). */
type NothingLeft = 'explored' | 'creatureInWay' | 'blocked';

/** Where exploring goes next (see `nextStop`), or why nowhere. */
export function exploreOutcome(snap: LevelSnapshot, materials: readonly Material[], plan: ExplorePlan, passing: Passing = new Set()): ExploreStop | NothingLeft {
  const stop = nextStop(snap, materials, plan, passing);
  if (stop) return stop;
  const all = { ...plan, avoid: undefined };
  if (!nextStop(snap, materials, all, 'all')) return 'explored';
  return plan.avoid?.size && nextStop(snap, materials, all, passing) ? 'blocked' : 'creatureInWay';
}

/** The message for a way on (or back) reached: which way it leads. */
function exitReason(stop: ExploreStop): 'exit' | 'exitUp' {
  return stop.heading === 'up' ? 'exitUp' : 'exit';
}

/**
 * Explores the level one step at a time, from one edge of unexplored space
 * to the next (see `nextStop`), collecting items on the way when the hero
 * picks things up (and money whatever they pick up), and choosing again as
 * soon as its goal has been seen.
 * It stops as travel does (a creature, being hurt), and once the level is
 * explored it goes to the way on. Places reached, and those behind a door
 * that will not open, join the level's skip set; other places it could not
 * reach (a creature in the way) are passed over only until it stops.
 */
export class Explore {
  private travel: Travel | null = null;
  private stop: ExploreStop | null = null;
  private targets = 0;
  private readonly watch = new Watch();
  private readonly plan: ExplorePlan;
  private readonly avoid = new Set<number>();
  /** Hostiles in view at the last step, shared by all its journeys (see `TravelOptions`). */
  private inSight: Set<number> | null = null;

  constructor(plan: ExplorePlan) {
    this.plan = { ...plan, avoid: this.avoid };
  }

  /** Where the map is filling out from now (it moves on once its surroundings are explored). */
  get anchor(): Point | null {
    return this.plan.anchor ?? null;
  }

  /** The goal still has something to show or collect. */
  private worthReaching(snap: LevelSnapshot, materials: readonly Material[]): boolean {
    const stop = this.stop;
    if (!stop) return false;
    if (stop.kind === 'frontier') return isFrontier(snap, materials, stop.mark);
    if (stop.kind === 'item') return hasItem(snap, stop.mark);
    return true;
  }

  /** Waiting to tell tome2 which door to open. */
  get answering(): boolean {
    return !!this.travel?.answering;
  }

  step(ctx: TravelContext): TravelStep {
    const { snap } = ctx;
    const alarm = this.watch.check(ctx);
    if (alarm) return { kind: 'stop', reason: alarm };
    this.inSight ??= new Set(hostilesInSight(ctx.monsters).map((m) => m.id));
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (this.travel && !this.worthReaching(snap, ctx.materials)) this.travel = null;
      if (!this.travel) {
        if (this.targets >= MAX_TARGETS) return { kind: 'stop', reason: 'limit' };
        let stop = exploreOutcome(snap, ctx.materials, this.plan, ctx.passing);
        if (typeof stop !== 'string' && stop.far && this.plan.anchor) {
          this.plan.anchor = { x: snap.px, y: snap.py };
          stop = exploreOutcome(snap, ctx.materials, this.plan, ctx.passing);
        }
        if (typeof stop === 'string') return { kind: 'stop', reason: stop };
        if (stop.kind === 'exit' && stop.x === snap.px && stop.y === snap.py) return { kind: 'stop', reason: exitReason(stop) };
        this.stop = stop;
        this.targets++;
        this.travel = new Travel(stop, ctx, { inSight: this.inSight, watch: this.watch });
      }
      const step = this.travel.step(ctx);
      if (step.kind === 'keys') return step;
      if (step.reason !== 'arrived' && step.reason !== 'unreachable' && step.reason !== 'blocked' && step.reason !== 'shut' && step.reason !== 'creatureInWay') return step;
      const stop = this.stop!;
      this.travel = null;
      const arrived = step.reason === 'arrived';
      if (stop.kind === 'exit' && arrived) return { kind: 'stop', reason: exitReason(stop) };
      if (arrived || (step.reason === 'shut' && stop.kind !== 'exit')) this.plan.skip.add(stop.mark);
      else this.avoid.add(stop.mark);
    }
    return { kind: 'stop', reason: 'blocked' };
  }
}

/**
 * What exploring knows of the level the hero is on, kept between its
 * explorations: the places it is done with, where it began and last
 * stopped, the items it has seen and the money in view.
 */
export class LevelExploration {
  /** Cells exploring is done with (`ExplorePlan.skip`). */
  readonly skip = new Set<number>();
  /** Where exploring this level began (the map fills outwards from it), and where the hero stood when it last stopped. */
  anchor: Point | null = null;
  lastStop: Point | null = null;
  /** Items seen on this level while exploring (by cell), and those first seen during the current exploration (by cell, with their names). */
  readonly seenItems = new Set<number>();
  readonly spotted = new Map<number, string>();
  /** Cells where money has been seen on this level: exploring takes it up whatever the hero picks up. */
  readonly gold = new Set<number>();
  /** Counts changes to `gold`, for what Explore would do. */
  goldVersion = 0;

  /**
   * Begins an exploration where the hero stands: it carries on from the
   * anchor when the hero is about where the last one stopped, else the map
   * fills out from here; the items in view count as seen.
   */
  begin(here: Point, objects: readonly ObjectState[], width: number): void {
    const last = this.lastStop;
    const resumed = !!last && gridDistance(last, here) <= ANCHOR_DRIFT;
    if (!this.anchor || !resumed) this.anchor = here;
    this.spotted.clear();
    for (const o of objects) this.seenItems.add(o.y * width + o.x);
  }

  /** Notes where an exploration stopped, and the anchor it had moved on to. */
  stopped(anchor: Point | null, at: Point): void {
    this.anchor = anchor;
    this.lastStop = at;
  }

  /** Items the hero stands on count as visited. */
  noteVisited(snap: LevelSnapshot): void {
    if (snap.floorObjects > 0) this.skip.add(snap.py * snap.width + snap.px);
  }

  /** Notes items that come into view while exploring, but for one underfoot. */
  noteSpotted(objects: readonly ObjectState[], snap: LevelSnapshot): void {
    const here = snap.py * snap.width + snap.px;
    for (const o of objects) {
      const cell = o.y * snap.width + o.x;
      if (cell === here || this.seenItems.has(cell)) continue;
      this.seenItems.add(cell);
      this.spotted.set(cell, o.name);
    }
  }

  /** The names of items first seen during this exploration that are still lying there. */
  spottedNames(snap: LevelSnapshot): string[] {
    return [...this.spotted].filter(([cell]) => hasItem(snap, cell)).map(([, name]) => name);
  }

  /**
   * Notes the cells in view that hold money, taking them out of the places
   * exploring is done with, and forgets those that hold something else or
   * nothing (a creature standing on money hides it).
   */
  noteGold(objects: readonly ObjectState[], snap: LevelSnapshot): void {
    const cells = objects.map((o) => o.y * snap.width + o.x);
    const gold = new Set(cells.filter((_, i) => objects[i].gold));
    let changed = false;
    for (const cell of cells) {
      if (gold.has(cell)) {
        changed ||= !this.gold.has(cell);
        this.gold.add(cell);
        this.skip.delete(cell);
      } else {
        changed ||= this.gold.delete(cell);
      }
    }
    for (const cell of this.gold) {
      const top = snap.layer[cell] & LAYER_MASK;
      if (top !== LAYER_OBJECT && top !== LAYER_MONSTER) changed ||= this.gold.delete(cell);
    }
    if (changed) this.goldVersion++;
  }
}

/* Terrain that leads on one level, by direction (stairs, the paths of flat lands; not shafts, which may skip levels). */
export const WAY_ON: Readonly<Record<'down' | 'up', RegExp>> = {
  down: /down staircase|quest down|path to the next/,
  up: /up staircase|quest up|path to the previous/,
};
