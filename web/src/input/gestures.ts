export function pinchRatio(startDistance: number, currentDistance: number): number {
  if (startDistance <= 0 || currentDistance <= 0) return 1;
  return currentDistance / startDistance;
}

/**
 * Reports two-finger pinch scale relative to the gesture start, and the end of the gesture.
 */
export function attachPinch(
  element: HTMLElement,
  onPinch: (ratio: number) => void,
  onPinchEnd: () => void,
): void {
  let start = 0;
  const spread = (touches: TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  element.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) start = spread(e.touches);
    },
    { passive: true },
  );

  element.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 2 || start <= 0) return;
      e.preventDefault();
      onPinch(pinchRatio(start, spread(e.touches)));
    },
    { passive: false },
  );

  const end = (e: TouchEvent) => {
    if (start > 0 && e.touches.length < 2) {
      start = 0;
      onPinchEnd();
    }
  };
  element.addEventListener('touchend', end);
  element.addEventListener('touchcancel', end);
}

export const TAP_MAX_MOVE = 12;
export const TAP_MAX_MS = 450;

export const LONG_PRESS_MS = 500;

export interface MapGestureHandlers {
  onTap(clientX: number, clientY: number, target: EventTarget | null): void;
  onLongPress(clientX: number, clientY: number, target: EventTarget | null): void;
  /** Incremental drag in CSS pixels. */
  onPan(dx: number, dy: number): void;
  onPanEnd(): void;
}

/**
 * Single-pointer gestures on the map: a tap, a long press (held still), or
 * a drag that pans. A second finger cancels them so pinch-zoom can take over.
 */
export function attachMapGestures(element: HTMLElement, handlers: MapGestureHandlers): void {
  let active: { id: number; x: number; y: number; lastX: number; lastY: number; t: number; target: EventTarget | null } | null = null;
  let panning = false;
  let pressed = false;
  let timer = 0;
  let pointers = 0;

  const reset = () => {
    window.clearTimeout(timer);
    timer = 0;
    active = null;
    if (panning) handlers.onPanEnd();
    panning = false;
    pressed = false;
  };

  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers++;
    if (pointers > 1) {
      reset();
      return;
    }
    active = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, t: performance.now(), target: e.target };
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!active || panning) return;
      pressed = true;
      handlers.onLongPress(active.x, active.y, active.target);
    }, LONG_PRESS_MS);
  });

  element.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id || pressed) return;
    if (!panning && Math.hypot(e.clientX - active.x, e.clientY - active.y) > TAP_MAX_MOVE) {
      panning = true;
      window.clearTimeout(timer);
      if (element.hasPointerCapture?.(e.pointerId) === false) element.setPointerCapture?.(e.pointerId);
    }
    if (panning) {
      handlers.onPan(e.clientX - active.lastX, e.clientY - active.lastY);
      active.lastX = e.clientX;
      active.lastY = e.clientY;
    }
  });

  element.addEventListener('pointerup', (e) => {
    pointers = Math.max(0, pointers - 1);
    if (!active || e.pointerId !== active.id) return;
    const tap = !panning && !pressed && performance.now() - active.t <= TAP_MAX_MS * 2;
    const { x, y, target } = active;
    reset();
    if (tap) handlers.onTap(x, y, target);
  });

  element.addEventListener('pointercancel', () => {
    pointers = Math.max(0, pointers - 1);
    reset();
  });
}
