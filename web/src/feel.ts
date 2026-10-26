import type { AnimationLevel } from './settings.ts';
import type { PlayerState } from './render/snapshot.ts';
import { depthLabel } from './hud.ts';
import { el } from './ui/dom.ts';

/** Health below this fraction of the maximum counts as low. */
export const LOW_HEALTH = 0.3;

export type FeelEvent =
  | { kind: 'hurt'; fraction: number }
  | { kind: 'levelup'; level: number }
  | { kind: 'depth'; place: string; feet: number; deeper: boolean }
  | { kind: 'gold'; amount: number };

type Tracked = Pick<PlayerState, 'name' | 'lev' | 'au' | 'chp' | 'mhp' | 'depth' | 'dungeon' | 'wild'>;

/** What changed for the player between two states, as feedback events. */
export function playerEvents(prev: Tracked | null, next: Tracked): FeelEvent[] {
  if (!prev || prev.name !== next.name) return [];
  const events: FeelEvent[] = [];
  if (next.depth !== prev.depth || next.dungeon !== prev.dungeon || next.wild !== prev.wild) {
    const place = next.depth > 0 && !next.wild ? next.dungeon : depthLabel(next);
    events.push({ kind: 'depth', place, feet: next.wild ? 0 : next.depth * 50, deeper: next.depth > prev.depth });
  }
  if (next.lev > prev.lev) events.push({ kind: 'levelup', level: next.lev });
  if (next.chp < prev.chp && next.mhp > 0) events.push({ kind: 'hurt', fraction: Math.min(1, (prev.chp - next.chp) / next.mhp) });
  if (next.au > prev.au) events.push({ kind: 'gold', amount: next.au - prev.au });
  return events;
}

export function isLowHealth(player: Pick<PlayerState, 'chp' | 'mhp'>): boolean {
  return player.mhp > 0 && player.chp / player.mhp < LOW_HEALTH;
}

const BANNER_MS = 2600;
const FLOAT_MS = 1400;

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Vibration is unavailable. */
  }
}

/**
 * Feedback layer over the map: a red flash when hurt, a pulse at low
 * health, a banner for a new level or depth and a float for gold found.
 */
export class GameFeel {
  private readonly layer: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly animation: () => AnimationLevel;
  private prev: Tracked | null = null;
  private bannerTimer = 0;

  constructor(stage: HTMLElement, animation: () => AnimationLevel) {
    this.animation = animation;
    this.layer = el('div', 'feel-layer');
    this.layer.setAttribute('aria-hidden', 'true');
    this.vignette = el('div', 'feel-vignette');
    this.banner = el('div', 'feel-banner');
    this.banner.setAttribute('role', 'status');
    this.layer.append(this.vignette, this.banner);
    stage.append(this.layer);
  }

  /** Compares with the last state seen and plays any feedback. */
  update(player: Tracked): void {
    const events = playerEvents(this.prev, player);
    this.prev = { ...player };
    this.layer.classList.toggle('low', isLowHealth(player));
    this.layer.classList.toggle('still', this.animation() === 'off');
    for (const event of events) this.play(event);
  }

  /** Forgets the last state, e.g. when a new game starts. */
  reset(): void {
    this.prev = null;
    this.layer.classList.remove('low');
  }

  private play(event: FeelEvent): void {
    switch (event.kind) {
      case 'hurt':
        this.flash('hurt', 0.35 + event.fraction * 1.3);
        vibrate(Math.round(20 + event.fraction * 80));
        break;
      case 'levelup':
        this.flash('levelup', 1);
        this.showBanner(`Level ${event.level}`, 'Your hero grows stronger', 'levelup');
        vibrate([30, 60, 30]);
        break;
      case 'depth': {
        const where = event.feet
          ? `${event.feet} ft · ${event.deeper ? 'Descending' : 'Climbing up'}`
          : event.place === 'Town'
            ? 'A moment of rest'
            : 'Out in the open';
        this.showBanner(event.place, where, 'depth');
        break;
      }
      case 'gold':
        this.float(`+${event.amount} gold`, 'gold');
        break;
    }
  }

  private flash(kind: string, strength: number): void {
    if (this.animation() === 'off') return;
    this.vignette.style.setProperty('--strength', String(Math.min(1, strength)));
    this.vignette.classList.remove('hurt', 'levelup');
    void this.vignette.offsetWidth;
    this.vignette.classList.add(kind);
  }

  private showBanner(title: string, subtitle: string, kind: string): void {
    this.banner.className = `feel-banner ${kind}`;
    this.banner.replaceChildren(el('strong', undefined, title), el('span', undefined, subtitle));
    void this.banner.offsetWidth;
    this.banner.classList.add('visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('visible'), BANNER_MS);
  }

  private float(text: string, kind: string): void {
    const node = el('div', `feel-float ${kind}`, text);
    if (this.animation() === 'off') node.classList.add('still');
    this.layer.append(node);
    window.setTimeout(() => node.remove(), FLOAT_MS);
  }
}
