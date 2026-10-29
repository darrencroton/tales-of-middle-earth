/* A pointer that moves further than this (px) between down and up is a drag, not a tap. */
const TAP_SLOP = 12;
/* The click a browser sends after a tap already handled arrives within this (ms). */
const CLICK_AFTER_TAP_MS = 800;

/**
 * Calls `handler` when an element matching `selector` inside `root` is
 * tapped. A pointer tap counts on pointerup over the element it went down
 * on, without waiting for the click: iOS drops the click of a tap while the
 * page changes under it (the map walking), so controls used during play
 * would otherwise ignore taps. A click with no tap before it (the keyboard's
 * Enter or Space) also counts; the click that follows a tap does not.
 */
export function onTap(root: HTMLElement, selector: string, handler: (target: HTMLElement, event: Event) => void): void {
  let down: { pointer: number; target: HTMLElement; x: number; y: number } | null = null;
  let tapped: { target: HTMLElement; at: number } | null = null;
  const match = (node: EventTarget | null): HTMLElement | null => {
    const target = node instanceof Element ? node.closest<HTMLElement>(selector) : null;
    return target && root.contains(target) ? target : null;
  };

  root.addEventListener('pointerdown', (e) => {
    const target = e.button === 0 ? match(e.target) : null;
    down = target ? { pointer: e.pointerId, target, x: e.clientX, y: e.clientY } : null;
  });
  root.addEventListener('pointercancel', () => {
    down = null;
  });
  root.addEventListener('pointerup', (e) => {
    const start = down;
    down = null;
    if (!start || start.pointer !== e.pointerId || !start.target.isConnected) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
    tapped = { target: start.target, at: performance.now() };
    handler(start.target, e);
  });
  root.addEventListener('click', (e) => {
    const target = match(e.target);
    const last = tapped;
    tapped = null;
    if (!target || (last && performance.now() - last.at < CLICK_AFTER_TAP_MS)) return;
    handler(target, e);
  });
}
