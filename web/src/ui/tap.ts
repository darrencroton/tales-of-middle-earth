/* A pointer that moves further than this (px) between down and up is a drag, not a tap. */
const TAP_SLOP = 12;

/**
 * Calls `handler` when an element matching `selector` inside `root` is
 * tapped: on pointerup over the element the pointer went down on, without
 * waiting for the browser's click, which is then cancelled (on touch) or
 * ignored. A click with no pointer behind it (Enter or Space) also counts.
 * An element's `data-tap` names what it does: a tap is dropped when it
 * changed between down and up, and follows an element redrawn with the same
 * `data-tap` in the meantime.
 */
export function onTap(root: HTMLElement, selector: string, handler: (target: HTMLElement, event: Event) => void): void {
  let down: { pointer: number; target: HTMLElement; tap: string | undefined; x: number; y: number } | null = null;
  let tapped = false;
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

  root.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    tapped = false;
    const target = e.button === 0 ? match(e.target) : null;
    down = target ? { pointer: e.pointerId, target, tap: target.dataset.tap, x: e.clientX, y: e.clientY } : null;
  });
  root.addEventListener('pointercancel', (e) => {
    if (down?.pointer === e.pointerId) down = null;
  });
  root.addEventListener('pointerup', (e) => {
    const start = down;
    if (!start || start.pointer !== e.pointerId) return;
    down = null;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
    const target = current(start);
    if (!target) return;
    tapped = e.pointerType === 'touch';
    handler(target, e);
  });
  /* The click a touch tap would send next lands on whatever the tap opened under the finger. */
  root.addEventListener(
    'touchend',
    (e) => {
      if (!tapped) return;
      tapped = false;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener('click', (e) => {
    const target = match(e.target);
    if (target && e.detail === 0) handler(target, e);
  });
}
