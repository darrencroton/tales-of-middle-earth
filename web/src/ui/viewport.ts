import { shortStandaloneView } from '../hud.ts';
import { el } from './dom.ts';

/* Visible height lost to an on-screen keyboard before the layout makes room for it. */
const KEYBOARD_MIN_PX = 120;
/* Below this visible height above the keyboard, text questions shrink to fit. */
const KEYBOARD_TIGHT_PX = 320;

/* Height of the view without the on-screen keyboard, for the current width. */
let fullHeight = 0;
let fullWidth = 0;

/** The top safe-area inset in CSS pixels. */
function safeTop(): number {
  const probe = el('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;padding-top:var(--safe-top)';
  document.body.append(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

function editingText(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && (active.type === 'text' || active.type === 'search'));
}

/**
 * The app fills the screen with CSS; only while the on-screen keyboard
 * covers part of it does it shrink to the visible area above the keyboard.
 */
function updateAppHeight(): void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const visible = viewport?.height ?? window.innerHeight;
  const layout = Math.max(window.innerHeight, root.clientHeight);
  if (window.innerWidth !== fullWidth) {
    fullWidth = window.innerWidth;
    fullHeight = 0;
  }
  fullHeight = editingText() ? Math.max(fullHeight, layout) : Math.max(layout, visible);
  const keyboard = visible < fullHeight - KEYBOARD_MIN_PX;
  root.classList.toggle('keyboard-open', keyboard);
  root.classList.toggle('keyboard-tight', keyboard && visible < KEYBOARD_TIGHT_PX);
  if (keyboard) {
    root.style.setProperty('--app-height', `${Math.round(visible)}px`);
    root.style.setProperty('--app-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
  } else if (window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  root.classList.toggle('short-view', shortStandaloneView(standalone, window.innerWidth, window.innerHeight, screen.width, screen.height, standalone ? safeTop() : 0));
}

/** Keeps the app's height to the view above the on-screen keyboard (`updateAppHeight`), from now on. */
export function watchAppHeight(): void {
  window.visualViewport?.addEventListener('resize', updateAppHeight);
  window.visualViewport?.addEventListener('scroll', updateAppHeight);
  window.addEventListener('resize', updateAppHeight);
  document.addEventListener('focusin', updateAppHeight);
  document.addEventListener('focusout', () => window.setTimeout(updateAppHeight, 100));
  window.addEventListener('orientationchange', () => window.setTimeout(updateAppHeight, 250));
  updateAppHeight();
}
