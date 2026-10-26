export const SWIPE_MIN_DISTANCE = 24;
export const SWIPE_RUN_DISTANCE = 140;

/* Keypad digits by 45-degree sector, starting east and turning anticlockwise (screen y points down). */
const SECTOR_DIGITS = ['6', '9', '8', '7', '4', '1', '2', '3'] as const;

export interface Swipe {
  digit: string;
  run: boolean;
}

export function swipeFromDelta(dx: number, dy: number): Swipe | null {
  const distance = Math.hypot(dx, dy);
  if (distance < SWIPE_MIN_DISTANCE) return null;
  const angle = Math.atan2(-dy, dx);
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return { digit: SECTOR_DIGITS[sector], run: distance >= SWIPE_RUN_DISTANCE };
}

/**
 * Calls onSwipe for single-finger swipes on the element. Multi-touch gestures are ignored.
 */
export function attachSwipe(element: HTMLElement, onSwipe: (swipe: Swipe) => void): void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  element.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );

  element.addEventListener(
    'touchmove',
    (e) => {
      if (tracking) e.preventDefault();
    },
    { passive: false },
  );

  element.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const swipe = swipeFromDelta(touch.clientX - startX, touch.clientY - startY);
    if (swipe) onSwipe(swipe);
  });

  element.addEventListener('touchcancel', () => {
    tracking = false;
  });
}

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

/**
 * Reports single-pointer taps (touch, pen or mouse) that barely moved.
 */
export function attachTap(element: HTMLElement, onTap: (clientX: number, clientY: number) => void): void {
  const down = new Map<number, { x: number; y: number; t: number }>();
  let multi = false;

  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (down.size > 1) multi = true;
  });

  element.addEventListener('pointerup', (e) => {
    const start = down.get(e.pointerId);
    down.delete(e.pointerId);
    const wasMulti = multi;
    if (down.size === 0) multi = false;
    if (!start || wasMulti) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved <= TAP_MAX_MOVE && performance.now() - start.t <= TAP_MAX_MS) onTap(e.clientX, e.clientY);
  });

  element.addEventListener('pointercancel', (e) => {
    down.delete(e.pointerId);
    if (down.size === 0) multi = false;
  });
}
