export type NavDirection = 'up' | 'down' | 'left' | 'right' | 'first' | 'last';

export interface NavRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Index of the item to move to from `current` in a list or grid laid out as
 * `rects`. Up/down pick the nearest item in the row above/below; left/right
 * step through the list in order.
 */
export function nextIndex(rects: readonly NavRect[], current: number, direction: NavDirection): number {
  const n = rects.length;
  if (n === 0) return -1;
  if (direction === 'first') return 0;
  if (direction === 'last') return n - 1;
  if (current < 0 || current >= n) return direction === 'up' || direction === 'left' ? n - 1 : 0;
  if (direction === 'left') return Math.max(0, current - 1);
  if (direction === 'right') return Math.min(n - 1, current + 1);

  const from = rects[current];
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const below = direction === 'down';
  let best = -1;
  let bestRowGap = Infinity;
  let bestDx = Infinity;
  rects.forEach((r, i) => {
    if (i === current) return;
    const ry = r.top + r.height / 2;
    const gap = below ? ry - cy : cy - ry;
    if (gap <= Math.min(from.height, r.height) / 3) return;
    const dx = Math.abs(r.left + r.width / 2 - cx);
    const rowGap = Math.round(gap);
    if (rowGap < bestRowGap - 2 || (Math.abs(rowGap - bestRowGap) <= 2 && dx < bestDx)) {
      best = i;
      bestRowGap = rowGap;
      bestDx = dx;
    }
  });
  return best < 0 ? current : best;
}

export function keyDirection(key: string): NavDirection | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

const SWIPE_MIN = 28;
const SWIPE_MAX_MS = 600;

/**
 * Keyboard and swipe navigation over the [data-nav] elements in a container:
 * one item is highlighted, arrows and swipes move it, Enter or a tap
 * activates. Vertical swipes only navigate when the container does not
 * scroll, so long lists still scroll naturally.
 */
export class ListNav {
  private readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private index = -1;

  constructor(root: HTMLElement, scroller: HTMLElement = root) {
    this.root = root;
    this.scroller = scroller;
    this.attachSwipe();
  }

  items(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-nav]')].filter(
      (item) => !(item as HTMLButtonElement).disabled && item.offsetParent !== null,
    );
  }

  get active(): HTMLElement | null {
    return this.items()[this.index] ?? null;
  }

  /** Highlights an item (by element or index) and scrolls it into view. */
  setActive(target: HTMLElement | number | null, scroll = true): void {
    const items = this.items();
    const index = typeof target === 'number' ? target : target ? items.indexOf(target) : -1;
    this.index = index >= 0 && index < items.length ? index : -1;
    for (const item of this.root.querySelectorAll('.is-active')) item.classList.remove('is-active');
    const active = items[this.index];
    if (!active) return;
    active.classList.add('is-active');
    if (scroll) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Re-applies the highlight after the list was rebuilt, keeping the same position. */
  refresh(preferred?: HTMLElement | null): void {
    const items = this.items();
    if (preferred && items.includes(preferred)) this.setActive(preferred, false);
    else this.setActive(items.length ? Math.max(0, Math.min(this.index, items.length - 1)) : -1, false);
  }

  move(direction: NavDirection): void {
    const items = this.items();
    if (items.length === 0) return;
    const rects = items.map((item) => item.getBoundingClientRect());
    this.setActive(nextIndex(rects, this.index, direction));
  }

  activate(): boolean {
    const active = this.active;
    if (!active) return false;
    active.click();
    return true;
  }

  /** Handles navigation keys; returns true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    const direction = keyDirection(e.key);
    if (direction) {
      this.move(direction);
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') return this.activate();
    return false;
  }

  private attachSwipe(): void {
    let start: { x: number; y: number; t: number } | null = null;
    this.root.addEventListener(
      'touchstart',
      (e) => {
        start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null;
      },
      { passive: true },
    );
    this.root.addEventListener('touchend', (e) => {
      const s = start;
      start = null;
      const touch = e.changedTouches[0];
      if (!s || !touch || performance.now() - s.t > SWIPE_MAX_MS) return;
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.move(dx < 0 ? 'right' : 'left');
      } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && this.scroller.scrollHeight <= this.scroller.clientHeight + 2) {
        this.move(dy < 0 ? 'down' : 'up');
      }
    });
  }
}
