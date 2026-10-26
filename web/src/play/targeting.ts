import { keyCodes as code } from '../input/keys.ts';
import type { Point } from './pathfinding.ts';
import { directionDigit } from './prompts.ts';

export type TargetStep = { kind: 'keys'; keys: number[] } | { kind: 'done' } | { kind: 'fail' };

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
