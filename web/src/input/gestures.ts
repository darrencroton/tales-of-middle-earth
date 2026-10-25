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
