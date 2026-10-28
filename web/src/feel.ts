import type { AnimationLevel } from './settings.ts';
import type { PlayerState } from './render/snapshot.ts';
import { depthLabel } from './hud.ts';
import { el, iconText } from './ui/dom.ts';

/** Health below this fraction of the maximum counts as low. */
export const LOW_HEALTH = 0.3;

/** Where on the surface a new place is: the world map, a town, or the land around. */
export type Surface = 'world' | 'town' | 'land';

export type FeelEvent =
  | { kind: 'hurt'; fraction: number }
  | { kind: 'levelup'; level: number; skillPoints: number }
  | { kind: 'depth'; place: string; feet: number; deeper: boolean; surface: Surface }
  | { kind: 'gold'; amount: number }
  | { kind: 'exp'; amount: number };

type Tracked = Pick<PlayerState, 'name' | 'lev' | 'exp' | 'au' | 'chp' | 'mhp' | 'depth' | 'dungeon' | 'wild' | 'skillPoints' | 'area' | 'inTown'>;

/** What changed for the player between two states, as feedback events. */
export function playerEvents(prev: Tracked | null, next: Tracked): FeelEvent[] {
  if (!prev || prev.name !== next.name) return [];
  const events: FeelEvent[] = [];
  const level = next.depth !== prev.depth || next.dungeon !== prev.dungeon || next.wild !== prev.wild;
  const area = next.depth === 0 && !!prev.area && !!next.area && prev.area !== next.area;
  if (level || area) {
    const place = next.depth > 0 && !next.wild ? next.dungeon : depthLabel(next);
    const surface: Surface = next.wild ? 'world' : next.inTown ? 'town' : 'land';
    events.push({ kind: 'depth', place, feet: next.wild ? 0 : next.depth * 50, deeper: next.depth > prev.depth, surface });
  }
  if (next.lev > prev.lev) events.push({ kind: 'levelup', level: next.lev, skillPoints: next.skillPoints ?? 0 });
  else if (next.exp > prev.exp) events.push({ kind: 'exp', amount: next.exp - prev.exp });
  if (next.chp < prev.chp && next.mhp > 0) events.push({ kind: 'hurt', fraction: Math.min(1, (prev.chp - next.chp) / next.mhp) });
  if (next.au > prev.au) events.push({ kind: 'gold', amount: next.au - prev.au });
  return events;
}

export function isLowHealth(player: Pick<PlayerState, 'chp' | 'mhp'>): boolean {
  return player.mhp > 0 && player.chp / player.mhp < LOW_HEALTH;
}

const BANNER_MS = 2600;
const FLOAT_MS = 1400;
const RING_MS = 700;
const SHAKE_MS = 420;
const DEED_MS = 3600;
/* A hit taking at least this fraction of maximum health shakes the screen. */
const SHAKE_HURT = 0.2;

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Vibration is unavailable. */
  }
}

/* Gold and experience floats start a little apart so both can be read. */
const FLOAT_OFFSETS: Readonly<Record<string, string>> = { gold: '42%', exp: '50%' };

/**
 * Feedback layer over the map: a red flash when hurt, a pulse at low
 * health, a banner for a new level or depth and a float for gold found.
 */
export class GameFeel {
  private readonly layer: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly deed: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly animation: () => AnimationLevel;
  private prev: Tracked | null = null;
  private bannerTimer = 0;
  private shakeTimer = 0;
  private deedTimer = 0;
  private readonly deeds: [string, string][] = [];

  constructor(stage: HTMLElement, animation: () => AnimationLevel) {
    this.animation = animation;
    this.stage = stage;
    this.layer = el('div', 'feel-layer');
    this.layer.setAttribute('aria-hidden', 'true');
    this.vignette = el('div', 'feel-vignette');
    this.banner = el('div', 'feel-banner');
    this.banner.setAttribute('role', 'status');
    this.deed = el('div', 'feel-deed');
    this.deed.setAttribute('role', 'status');
    this.layer.append(this.vignette, this.banner, this.deed);
    stage.append(this.layer);
  }

  /** A banner for a moment worth marking: a kill streak, a legend slain. */
  announce(title: string, subtitle: string, kind: string): void {
    this.showBanner(title, subtitle, kind);
  }

  /** Shakes the map; `strength` 0..1. */
  shake(strength: number): void {
    if (this.animation() !== 'full') return;
    this.stage.style.setProperty('--shake', `${(2 + 6 * Math.min(1, strength)).toFixed(1)}px`);
    this.stage.classList.remove('feel-shake');
    void this.stage.offsetWidth;
    this.stage.classList.add('feel-shake');
    window.clearTimeout(this.shakeTimer);
    this.shakeTimer = window.setTimeout(() => this.stage.classList.remove('feel-shake'), SHAKE_MS);
  }

  /** An expanding ring where a creature fell, in its colour (viewport coordinates). */
  ringAt(clientX: number, clientY: number, colour: string): void {
    if (this.animation() === 'off') return;
    const rect = this.layer.getBoundingClientRect();
    const node = el('div', 'feel-ring');
    node.style.left = `${clientX - rect.left}px`;
    node.style.top = `${clientY - rect.top}px`;
    node.style.setProperty('--ring', colour);
    this.layer.append(node);
    window.setTimeout(() => node.remove(), RING_MS);
  }

  /** A deed earned: a gold card at the top of the map, one at a time. */
  showDeed(title: string, text: string): void {
    this.deeds.push([title, text]);
    if (!this.deedTimer) this.nextDeed();
  }

  private nextDeed(): void {
    const next = this.deeds.shift();
    if (!next) {
      this.deedTimer = 0;
      this.deed.classList.remove('visible');
      return;
    }
    this.deed.replaceChildren(el('span', 'feel-deed-star', iconText('★')), el('strong', undefined, next[0]), el('span', undefined, next[1]));
    this.deed.classList.remove('visible');
    void this.deed.offsetWidth;
    this.deed.classList.add('visible');
    vibrate([20, 40, 20]);
    this.deedTimer = window.setTimeout(() => this.nextDeed(), DEED_MS);
  }

  /** Compares with the last state seen and plays any feedback. */
  /** Forgets the last hero, for a new game in the same page. */
  reset(): void {
    this.prev = null;
    this.layer.classList.remove('low');
  }

  update(player: Tracked): void {
    const events = playerEvents(this.prev, player);
    this.prev = { ...player };
    this.layer.classList.toggle('low', isLowHealth(player));
    this.layer.classList.toggle('still', this.animation() === 'off');
    for (const event of events) this.play(event);
  }

  /** Floats a short text (damage, a pickup) at a point on the stage, in viewport coordinates. */
  floatAt(clientX: number, clientY: number, text: string, kind: string): void {
    const rect = this.layer.getBoundingClientRect();
    const node = el('div', `feel-float at ${kind}`, text);
    node.style.left = `${clientX - rect.left}px`;
    node.style.top = `${clientY - rect.top}px`;
    if (this.animation() === 'off') node.classList.add('still');
    this.layer.append(node);
    window.setTimeout(() => node.remove(), FLOAT_MS);
  }

  private play(event: FeelEvent): void {
    switch (event.kind) {
      case 'hurt':
        this.flash('hurt', 0.35 + event.fraction * 1.3);
        if (event.fraction >= SHAKE_HURT) this.shake(event.fraction * 2);
        vibrate(Math.round(20 + event.fraction * 80));
        break;
      case 'levelup':
        this.flash('levelup', 1);
        this.showBanner(
          `Level ${event.level}`,
          event.skillPoints > 0 ? `${event.skillPoints} skill point${event.skillPoints === 1 ? '' : 's'} to spend` : 'Your hero grows stronger',
          'levelup',
        );
        vibrate([30, 60, 30]);
        break;
      case 'exp':
        this.float(`+${event.amount} xp`, 'exp');
        break;
      case 'depth': {
        const where = event.feet
          ? `${event.feet} ft · ${event.deeper ? 'Descending' : 'Climbing up'}`
          : event.surface === 'town'
            ? 'A moment of rest'
            : event.surface === 'world'
              ? 'Middle-earth lies before you'
              : 'Out in the wilds';
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
    node.style.top = FLOAT_OFFSETS[kind] ?? '42%';
    if (this.animation() === 'off') node.classList.add('still');
    this.layer.append(node);
    window.setTimeout(() => node.remove(), FLOAT_MS);
  }
}
