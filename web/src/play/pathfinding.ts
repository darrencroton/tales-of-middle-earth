export interface Point {
  x: number;
  y: number;
}

export interface TravelGrid {
  width: number;
  height: number;
  passable(x: number, y: number): boolean;
  /** Extra cost of entering a cell (default 0). */
  penalty?(x: number, y: number): number;
}

const SQRT2 = Math.SQRT2;

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/** Minimal binary heap keyed by priority. */
class Heap {
  private readonly items: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.priorities[l] < this.priorities[m]) m = l;
        if (r < this.items.length && this.priorities[r] < this.priorities[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}

/**
 * A* over an 8-connected grid. Returns the steps from start (exclusive) to
 * goal (inclusive), or null when unreachable. The goal itself need not be
 * passable (so a monster or closed door can be the destination).
 */
export function findPath(grid: TravelGrid, start: Point, goal: Point, maxExpanded = 40_000): Point[] | null {
  const { width, height } = grid;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(start.x, start.y) || !inside(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const n = width * height;
  const cost = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;
  const open = new Heap();

  cost[startIndex] = 0;
  open.push(startIndex, octile(start.x, start.y, goal.x, goal.y));
  let expanded = 0;

  while (open.size > 0 && expanded < maxExpanded) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    expanded++;
    if (current === goalIndex) break;

    const cx = current % width;
    const cy = (current - cx) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inside(nx, ny)) continue;
        const next = ny * width + nx;
        if (closed[next]) continue;
        if (next !== goalIndex && !grid.passable(nx, ny)) continue;
        const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) + (grid.penalty?.(nx, ny) ?? 0);
        const candidate = cost[current] + step;
        if (candidate < cost[next]) {
          cost[next] = candidate;
          from[next] = current;
          open.push(next, candidate + octile(nx, ny, goal.x, goal.y));
        }
      }
    }
  }

  if (from[goalIndex] < 0) return null;
  const path: Point[] = [];
  for (let i = goalIndex; i !== startIndex; i = from[i]) {
    path.push({ x: i % width, y: Math.floor(i / width) });
  }
  return path.reverse();
}
