import type { Engine } from '../engine.ts';
import { KEY_BACKSLASH as BACKSLASH } from '../input/keys.ts';
import type { MapPoint, MapRenderer } from '../render/map.ts';
import type { FeatureInfo, Material } from '../render/materials.ts';
import type { GameState, LevelSnapshot } from '../render/snapshot.ts';
import type { TerminalBuffer } from '../terminal.ts';
import { transitionUnderfoot, type ExploreNext, type ExplorePace } from './actions.ts';
import { Explore, exploreOutcome, nextStop, WAY_ON, type ExplorePlan } from './explore.ts';
import type { LevelState } from './heromemory.ts';
import { INVEN_WIELD } from './items.ts';
import type { Heading } from './mapmemory.ts';
import { classifyPrompt, isAdjacent } from './prompts.ts';
import { TargetPicker } from './targeting.ts';
import { approachTarget, outOfSight, pushPast, stopMessage, STOP_MESSAGES, Travel, type TravelContext, type TravelStep } from './travel.ts';

const TRAVEL_STEP_MS = 45;
const RELAXED_STEP_MS = 120;

export interface JourneyDeps {
  engine: Engine;
  buffer: TerminalBuffer;
  map: MapRenderer;
  snapshot(): LevelSnapshot | null;
  state(): GameState | null;
  materials(): readonly Material[];
  level(): LevelState;
  heading(): Heading;
  alwaysPickup(): boolean;
  pace(): ExplorePace;
  animating(): boolean;
  /** Where tome2's cursor is on the map, if it shows one there. */
  cursorCell(): MapPoint | null;
  /** Refuses a journey of the hero's own while they control another creature (true when refused). */
  held(): boolean;
  /** The name of the terrain the hero stands on, in lower case. */
  underfoot(snap: LevelSnapshot): string;
  /** The toolbar would offer to light a light (a stop in the dark says to tap it). */
  lightOffered(snap: LevelSnapshot): boolean;
  /** Sends keys as the player's own. */
  send(keys: number[]): void;
  showToast(text: string): void;
  hideToast(): void;
  recentreMap(): void;
  updatePromptCard(): void;
  updateActionBar(): void;
  requestFrame(): void;
}

/**
 * Travel, exploring and target picking: journeys walked a step per idle
 * until something needs the player (`play/travel.ts`, `play/explore.ts`).
 */
export class Journeys {
  private readonly deps: JourneyDeps;
  private travel: Travel | Explore | null = null;
  private picker: TargetPicker | null = null;
  private timer = 0;
  private stopCause = '';
  /** The current travel only gets as near as the known way allows. */
  private approximate = false;
  /* What each terrain feature means to exploring, by feature index; null until the features are known. */
  private roles: { down: boolean[]; up: boolean[] } | null = null;
  /* What Explore would do (the toolbar's label), by level, turn and place. */
  private nextCache = { key: '', next: 'explore' as ExploreNext };

  constructor(deps: JourneyDeps) {
    this.deps = deps;
  }

  /** Stops whatever is under way and forgets the last game's plans (back at the title). */
  reset(): void {
    this.stop(null, 'title');
    this.approximate = false;
    this.nextCache = { key: '', next: 'explore' };
  }

  /** A journey or a target pick is under way. */
  get active(): boolean {
    return !!this.travel || !!this.picker;
  }

  /** Travel or exploring is under way. */
  get travelling(): boolean {
    return this.travel !== null;
  }

  get exploring(): boolean {
    return this.travel instanceof Explore;
  }

  /** Travel is to answer tome2's question of which door it is opening. */
  get answering(): boolean {
    return !!this.travel?.answering;
  }

  /** Why the last journey or target pick stopped. */
  get lastStopCause(): string {
    return this.stopCause;
  }

  /** Learns which terrain features are ways down and up. */
  setFeatures(features: readonly FeatureInfo[]): void {
    this.roles = {
      down: features.map((f) => WAY_ON.down.test(f.name.toLowerCase())),
      up: features.map((f) => WAY_ON.up.test(f.name.toLowerCase())),
    };
  }

  private context(): TravelContext | null {
    const snap = this.deps.snapshot();
    const state = this.deps.state();
    if (!snap || !state?.player) return null;
    const row0 = this.deps.buffer.rowText(0).trim();
    return {
      snap,
      materials: this.deps.materials(),
      monsters: state.monsters ?? [],
      hp: state.player.chp,
      gold: state.player.au,
      passing: this.passing(snap),
      prompt: classifyPrompt(row0, this.deps.buffer.cursorY === 0),
    };
  }

  /** Cells of the creatures travel and exploring plan through: those not in sight (`outOfSight`), and companions they swap places with as tome2 lets the hero (`pushPast`). */
  private passing(snap: LevelSnapshot): Set<number> {
    const state = this.deps.state();
    const player = state?.player;
    const monsters = state?.monsters ?? [];
    const cells = outOfSight(snap, monsters);
    if (!player || !monsters.some((m) => m.status > 0)) return cells;
    const weapon = this.deps.engine.inventory()?.equip.find((slot) => slot.i === INVEN_WIELD)?.name ?? '';
    const companions = pushPast(snap, this.deps.materials(), monsters, {
      confused: (player.status.confused ?? 0) > 0,
      stunned: (player.status.stun ?? 0) > 0,
      hallucinating: (player.status.hallucinating ?? 0) > 0,
      stormbringer: /Stormbringer/.test(weapon),
    });
    for (const cell of companions) cells.add(cell);
    return cells;
  }

  /** Stops whatever is under way, if anything is. */
  interrupt(cause: string): void {
    if (this.active) this.stop(null, cause);
  }

  /** Stops travel, exploring and target picking, telling the player `message`. */
  stop(message: string | null, cause: string): void {
    if (this.active) this.stopCause = cause;
    const answering = this.answering;
    const snap = this.deps.snapshot();
    if (this.travel instanceof Explore && snap) this.deps.level().explore.stopped(this.travel.anchor, { x: snap.px, y: snap.py });
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.travel = null;
    this.picker = null;
    this.deps.map.setPath(null);
    if (message) this.deps.showToast(message);
    /* A door's question travel was to answer is left to the player. */
    if (answering) this.deps.updatePromptCard();
    this.deps.updateActionBar();
    this.deps.requestFrame();
  }

  /** At each idle with no macro running: the next step of a journey, after its pause, or of a target pick. */
  idle(): void {
    if (this.travel) {
      if (!this.timer) this.timer = window.setTimeout(() => this.step(), this.stepMs());
    } else if (this.picker) {
      this.stepTarget();
    }
  }

  private step(): void {
    this.timer = 0;
    if (!this.deps.engine.awaitingInput) return;
    const ctx = this.context();
    const travel = this.travel;
    if (!travel || !ctx) return;
    if (travel instanceof Explore) this.deps.level().explore.noteSpotted(this.deps.state()?.objects ?? [], ctx.snap);
    const step = travel.step(ctx);
    if (step.kind === 'stop') {
      const spotted = travel instanceof Explore ? this.spottedText() : null;
      const message = [this.stopMessage(travel, step, ctx.snap), spotted].filter(Boolean).join(' ');
      this.stop(message || null, step.reason);
      return;
    }
    this.deps.map.setPath(step.path);
    this.deps.engine.sendKeys(step.keys);
    if (travel instanceof Travel && travel.oneStep) this.stop(null, 'step');
    this.deps.requestFrame();
  }

  /** What to tell the player when travel or exploring stops. */
  private stopMessage(journey: Travel | Explore, step: Extract<TravelStep, { kind: 'stop' }>, snap: LevelSnapshot): string | null {
    return stopMessage(step, {
      light: this.deps.lightOffered(snap),
      exploring: journey instanceof Explore,
      walked: journey instanceof Travel ? journey.walked : 0,
      approximate: this.approximate,
      depth: snap.depth,
      lightRadius: snap.lightRadius,
    });
  }

  /** The pause between steps of travel and exploring: Relaxed walks at its own slower pace, whatever the animation setting. */
  private stepMs(): number {
    if (this.deps.pace() === 'relaxed') return RELAXED_STEP_MS;
    return this.deps.animating() ? TRAVEL_STEP_MS : 0;
  }

  /** Items first seen during an exploration that are still lying there, for its closing message. */
  private spottedText(): string | null {
    const snap = this.deps.snapshot();
    if (!snap || this.deps.alwaysPickup()) return null;
    const names = this.deps.level().explore.spottedNames(snap);
    if (names.length === 0) return null;
    return names.length === 1 ? `You spotted ${names[0]} on the way.` : `You spotted ${names.length} items on the way.`;
  }

  /**
   * Walks towards a place on the map: there when a known way leads there,
   * otherwise as far as the known way goes towards it.
   */
  travelTo(goal: MapPoint): void {
    const ctx = this.context();
    if (!ctx || this.deps.held()) return;
    this.stop(null, 'new travel');
    this.deps.hideToast();
    this.deps.recentreMap();
    const snap = ctx.snap;
    const approach = approachTarget(snap, ctx.materials, goal, ctx.passing);
    if (!approach && !isAdjacent(snap.px, snap.py, goal.x, goal.y)) {
      this.deps.showToast(STOP_MESSAGES.unreachable ?? '');
      return;
    }
    this.travel = new Travel(approach?.point ?? goal, ctx);
    this.approximate = !!approach && !approach.exact;
    this.step();
  }

  /** One step to a neighbouring cell (a closed door there is opened, then walked through). */
  stepTo(cell: MapPoint): void {
    const ctx = this.context();
    if (!ctx || this.deps.held()) return;
    this.stop(null, 'step');
    this.deps.hideToast();
    const mat = ctx.materials[ctx.snap.feat[cell.y * ctx.snap.width + cell.x]];
    const door = !!mat?.door && !mat.walkable;
    this.travel = new Travel(cell, ctx, { oneStep: !door });
    this.approximate = false;
    this.step();
  }

  /**
   * Walks to unexplored places until something needs attention; on an
   * explored level, goes to the way on, which a further press takes (on the
   * land, once nothing is left, it opens the world map).
   */
  explore(): void {
    const ctx = this.context();
    if (!ctx || this.deps.held()) return;
    this.stop(null, 'explore');
    this.deps.recentreMap();
    this.deps.level().explore.begin({ x: ctx.snap.px, y: ctx.snap.py }, this.deps.state()?.objects ?? [], ctx.snap.width);
    const next = this.exploreNext(ctx.snap);
    const way = next === 'worldMap' ? '<' : next === 'here' ? transitionUnderfoot(this.deps.underfoot(ctx.snap))?.command : null;
    if (way) {
      this.deps.send([BACKSLASH, way.charCodeAt(0)]);
      return;
    }
    this.travel = new Explore(this.plan());
    this.approximate = false;
    this.deps.updateActionBar();
    this.step();
  }

  /** Moves tome2's targeting cursor onto a place (aiming a spell or missile there). */
  target(goal: MapPoint): void {
    this.stop(null, 'new target');
    this.picker = new TargetPicker(goal, this.deps.state()?.monsters?.length ?? 0);
    this.deps.engine.sendKeys(this.picker.begin());
  }

  private stepTarget(): void {
    const snap = this.deps.snapshot();
    if (!this.picker || !snap) return;
    const prompt = classifyPrompt(this.deps.buffer.rowText(0).trim());
    const targeting = !snap.atCommand && prompt !== 'aim' && prompt !== 'more';
    const step = this.picker.step(this.deps.cursorCell(), { x: snap.px, y: snap.py }, targeting);
    if (step.kind === 'keys') this.deps.engine.sendKeys(step.keys);
    else this.stop(step.kind === 'fail' ? 'Could not target there.' : null, 'target');
  }

  /**
   * Exploring's plan for this level. Below ground the way on is in the hero's
   * heading; a dungeon level with no known way that way (the bottom of a
   * dungeon, the top of one entered from its far end) is left the other way.
   * On the land it leads to no entrance: finding them is the player's.
   */
  private plan(): ExplorePlan {
    const heading = this.deps.heading();
    const level = this.deps.level();
    const underground = (this.deps.snapshot()?.depth ?? 0) > 0;
    const roles = this.roles ?? { down: [], up: [] };
    const role = (marks: boolean[]) => (i: number) => {
      const snap = this.deps.snapshot();
      return underground && !!snap && !!marks[snap.feat[i]];
    };
    return {
      skip: level.explore.skip,
      heading,
      isExit: role(roles[heading]),
      isBackExit: underground ? role(roles[heading === 'up' ? 'down' : 'up']) : undefined,
      anchor: level.explore.anchor,
      collect: this.deps.alwaysPickup() ? () => true : (i) => level.explore.gold.has(i),
    };
  }

  /** What Explore would do now (see `ExploreNext`); on the land, once nothing is left, the way on is the world map. */
  exploreNext(snap: LevelSnapshot | null): ExploreNext {
    if (!snap?.atCommand || snap.wild || !this.roles) return 'explore';
    const level = this.deps.level();
    const key = `${level.key}:${snap.turn}:${snap.px},${snap.py}:${level.explore.skip.size}:${level.explore.goldVersion}:${this.deps.heading()}:${this.deps.alwaysPickup()}`;
    if (this.nextCache.key !== key) this.nextCache = { key, next: this.exploreNextFrom(snap) };
    return this.nextCache.next;
  }

  private exploreNextFrom(snap: LevelSnapshot): ExploreNext {
    const next = exploreOutcome(snap, this.deps.materials(), this.plan(), this.passing(snap));
    if (next === 'explored') return snap.depth === 0 ? 'worldMap' : 'none';
    if (typeof next === 'string' || next.kind !== 'exit') return 'explore';
    return next.x === snap.px && next.y === snap.py ? 'here' : (next.heading ?? 'down');
  }

  /** Where exploring would go next, for tests. */
  nextStop(): { kind: string; x: number; y: number; heading: string } | null {
    const snap = this.deps.snapshot();
    if (!snap) return null;
    const plan = this.plan();
    const stop = nextStop(snap, this.deps.materials(), plan, this.passing(snap));
    return { kind: stop?.kind ?? 'none', x: stop?.x ?? -1, y: stop?.y ?? -1, heading: plan.heading ?? 'down' };
  }
}
