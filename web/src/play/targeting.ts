import { keyCodes as code } from '../input/keys.ts';
import type { LevelSnapshot } from '../render/snapshot.ts';
import type { Point } from './pathfinding.ts';
import { directionDigit } from './prompts.ts';

type TargetStep = { kind: 'keys'; keys: number[] } | { kind: 'done' } | { kind: 'fail' };

/** Digits that move a free cursor by (dx, dy): diagonals first, then straight. */
export function cursorMoves(dx: number, dy: number): number[] {
  const keys: number[] = [];
  let x = dx;
  let y = dy;
  while (x !== 0 || y !== 0) {
    const sx = Math.sign(x);
    const sy = Math.sign(y);
    keys.push(directionDigit(sx, sy)!.charCodeAt(0));
    x -= sx;
    y -= sy;
  }
  return keys;
}

/** Where tome2's map sits on its screen of `cols` × `rows`, and which part of the level it shows. */
export type PointView = Pick<LevelSnapshot, 'panelCol' | 'panelRow' | 'colMap' | 'rowMap' | 'width' | 'height'> & { cols: number; rows: number };

/**
 * Whether tome2's point cursor (`tgt_pt`) can reach a cell: it keeps to the
 * part of the level its screen shows (its panel), short of the panel's first
 * row and column and of the level's edge.
 */
export function pointReachable(view: PointView, cell: Point): boolean {
  const wid = view.cols - view.colMap - 1;
  const hgt = view.rows - view.rowMap - 1;
  const across = cell.x > Math.max(0, view.panelCol) && cell.x < Math.min(view.panelCol + wid, view.width - 1);
  const down = cell.y > Math.max(0, view.panelRow) && cell.y < Math.min(view.panelRow + hgt, view.height - 1);
  return across && down;
}

/** What a tap on the map does while tome2 asks for a point: chooses where its cursor is, moves the cursor there, or cannot reach. */
export type PointStep = { kind: 'choose' } | { kind: 'move'; keys: number[] } | { kind: 'far' };

export function pointStep(view: PointView, cursor: Point, cell: Point): PointStep {
  if (cursor.x === cell.x && cursor.y === cell.y) return { kind: 'choose' };
  if (!pointReachable(view, cell)) return { kind: 'far' };
  return { kind: 'move', keys: cursorMoves(cell.x - cursor.x, cell.y - cursor.y) };
}

/**
 * Drives tome2's interactive targeting ('*') to a tapped cell: first cycles
 * through "interesting" targets (so monsters are tracked), then falls back
 * to free-cursor mode, moving from the player to the cell and selecting it.
 */
export class TargetPicker {
  readonly goal: Point;
  private readonly maxCycles: number;
  private phase: 'start' | 'cycle' | 'free' | 'selected' = 'start';
  private cycles = 0;
  private firstCursor: Point | null = null;

  constructor(goal: Point, visibleTargets: number) {
    this.goal = goal;
    this.maxCycles = Math.max(1, visibleTargets + 1);
  }

  /** Keys that open the targeting interface from an aim prompt. */
  begin(): number[] {
    this.phase = 'cycle';
    return code('*');
  }

  /**
   * Called each time the engine waits for input, with the targeting cursor
   * (or null when no cursor is shown) and the player position.
   */
  step(cursor: Point | null, player: Point, targeting: boolean): TargetStep {
    if (this.phase === 'selected') return { kind: 'done' };
    if (this.phase === 'free') {
      this.phase = 'selected';
      return { kind: 'done' };
    }
    if (!targeting) return { kind: 'fail' };

    if (cursor && cursor.x === this.goal.x && cursor.y === this.goal.y) {
      this.phase = 'selected';
      return { kind: 'keys', keys: code('t') };
    }

    const repeated = cursor && this.firstCursor && cursor.x === this.firstCursor.x && cursor.y === this.firstCursor.y;
    if (!this.firstCursor && cursor) this.firstCursor = cursor;

    if (cursor && !(repeated && this.cycles > 0) && this.cycles < this.maxCycles) {
      this.cycles++;
      return { kind: 'keys', keys: code(' ') };
    }

    this.phase = 'free';
    return { kind: 'keys', keys: [...code('p'), ...cursorMoves(this.goal.x - player.x, this.goal.y - player.y), ...code('t')] };
  }
}
