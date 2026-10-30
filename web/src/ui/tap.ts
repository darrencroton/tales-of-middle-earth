/* A pointer that moves further than this (px) between down and up is a drag, not a tap. */
const TAP_SLOP = 12;
/* A click this soon (ms) after a press ended is that press's own. */
const CLICK_AFTER_PRESS_MS = 1000;

/**
 * Calls `handler` when an element matching `selector` inside `root` is
 * tapped: on pointerup over the element the pointer went down on, without
 * waiting for the browser's click. The click that follows is cancelled (on
 * touch) or ignored; a click with no press behind it (Enter, Space,
 * assistive technology) counts. An element's `data-tap` names what it does:
 * a tap is dropped when it changed between down and up, and follows an
 * element redrawn with the same `data-tap` in the meantime.
 */
export function onTap(root: HTMLElement, selector: string, handler: (target: HTMLElement, event: Event) => void): void {
  let down: { pointer: number; target: HTMLElement; tap: string | undefined; x: number; y: number } | null = null;
  let tapped = false;
  /* When a press last ended in `root`: the click after it is the press's, handled or dropped at pointerup. */
  let pressEnded = -Infinity;
  const match = (node: EventTarget | null): HTMLElement | null => {
    const target = node instanceof Element ? node.closest<HTMLElement>(selector) : null;
    return target && root.contains(target) ? target : null;
  };
  /* The element pressed, or the one now drawn in its place. */
  const current = (start: NonNullable<typeof down>): HTMLElement | null => {
    if (start.target.isConnected) return start.target.dataset.tap === start.tap ? start.target : null;
    if (start.tap === undefined) return null;
    return [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.dataset.tap === start.tap) ?? null;
  };
  /* The pointer was let go over the element (or one redrawn as it), not beside it. */
  const releasedOver = (target: HTMLElement, e: PointerEvent): boolean => {
    const under = match(document.elementFromPoint(e.clientX, e.clientY));
    return under === target || (!!under && target.dataset.tap !== undefined && under.dataset.tap === target.dataset.tap);
  };
  /* Touch events stay with the element first touched, even once it is redrawn away, so it cancels its own click. */
  const cancelClick = (e: TouchEvent) => {
    if (tapped && e.cancelable) e.preventDefault();
    tapped = false;
  };

  root.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    tapped = false;
    const target = e.button === 0 ? match(e.target) : null;
    down = target ? { pointer: e.pointerId, target, tap: target.dataset.tap, x: e.clientX, y: e.clientY } : null;
    if (target && e.pointerType === 'touch' && e.target instanceof HTMLElement) {
      e.target.addEventListener('touchend', cancelClick, { once: true, passive: false });
    }
  });
  root.addEventListener('pointercancel', (e) => {
    if (down?.pointer === e.pointerId) down = null;
  });
  root.addEventListener('pointerup', (e) => {
    const start = down;
    if (!start || start.pointer !== e.pointerId) return;
    down = null;
    pressEnded = performance.now();
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
    const target = current(start);
    if (!target || !releasedOver(target, e)) return;
    tapped = e.pointerType === 'touch';
    handler(target, e);
  });
  root.addEventListener('click', (e) => {
    const target = match(e.target);
    const pressed = performance.now() - pressEnded < CLICK_AFTER_PRESS_MS;
    pressEnded = -Infinity;
    if (target && !pressed) handler(target, e);
  });
}
