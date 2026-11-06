import type { AnimationLevel } from './settings.ts';
import { feetOf, placeName, type PlayerState } from './render/snapshot.ts';
import { blessingsGone, heroEffects } from './play/effects.ts';
import { livesText } from './play/lives.ts';
import { el, iconText } from './ui/dom.ts';

/** Health below this fraction of the maximum counts as low. */
export const LOW_HEALTH = 0.3;

/** A quest's arrival or end. */
export type QuestEvent = Extract<FeelEvent, { kind: 'quest' | 'questEnd' }>;

/** Where on the surface a new place is: the world map, a town, or the land around. */
type Surface = 'world' | 'town' | 'land';

export type FeelEvent =
  | { kind: 'hurt'; fraction: number }
  | { kind: 'levelup'; level: number; skillPoints: number }
  | { kind: 'depth'; place: string; feet: number; deeper: boolean; surface: Surface }
  /** A level that holds a quest, arrived at (`place` is its dungeon, empty on a quest's own level). */
  | { kind: 'quest'; title: string; place: string; feet: number }
  /** A quest done or failed, wherever it ended. */
  | { kind: 'questEnd'; id: number; title: string; failed: boolean }
  /** One more of a random quest's creatures slain, the quest not yet done. */
  | { kind: 'questProgress'; slain: number; count: number }
  | { kind: 'gold'; amount: number }
  | { kind: 'exp'; amount: number }
  /** Blessings or sustained powers that began or ended, by name ("Doom shield"), the first one's glyph first. */
  | { kind: 'blessing'; ended: boolean; icon: string; names: string[] }
  /** Back from death in Adventure mode, with `lives` left (this one included); played by main.ts (`followReturn`). */
  | { kind: 'returned'; lives: number };

type Tracked = Pick<PlayerState, 'name' | 'lev' | 'exp' | 'au' | 'chp' | 'mhp' | 'depth' | 'dungeon' | 'wild' | 'skillPoints' | 'area' | 'inTown' | 'quest' | 'quests' | 'effects' | 'pray' | 'dead'>;

/** What changed for the player between two states, as feedback events. */
export function playerEvents(prev: Tracked | null, next: Tracked): FeelEvent[] {
  if (!prev || prev.name !== next.name) return [];
  const events: FeelEvent[] = [];
  const level = next.depth !== prev.depth || next.dungeon !== prev.dungeon || next.wild !== prev.wild;
  const area = next.depth === 0 && !!prev.area && !!next.area && prev.area !== next.area;
  /* A quest's banner comes last, so no other banner covers it. */
  let quest: FeelEvent | null = null;
  if (level || area) {
    const ownLevel = next.depth > 0 && !!next.quest?.own;
    const place = placeName(next) || 'Town';
    const surface: Surface = next.wild ? 'world' : next.inTown ? 'town' : 'land';
    const feet = feetOf(next);
    if (level && next.quest?.state === 'active') quest = { kind: 'quest', title: next.quest.title, place: ownLevel ? '' : place, feet };
    else events.push({ kind: 'depth', place, feet, deeper: next.depth > prev.depth, surface });
  } else if (next.quest?.state === 'active' && next.quest.random && prev.quest?.random && next.quest.random.slain > prev.quest.random.slain) {
    quest = { kind: 'questProgress', slain: next.quest.random.slain, count: next.quest.random.count };
  }
  /* tome2 never ends a quest as the hero arrives on another quest's level, so an end takes the arrival's place. */
  quest = endedQuest(prev, next, level) ?? quest;
  if (next.lev > prev.lev) events.push({ kind: 'levelup', level: next.lev, skillPoints: next.skillPoints ?? 0 });
  else if (next.exp > prev.exp) events.push({ kind: 'exp', amount: next.exp - prev.exp });
  if (next.chp < prev.chp && next.mhp > 0) events.push({ kind: 'hurt', fraction: Math.min(1, (prev.chp - next.chp) / next.mhp) });
  if (next.au > prev.au) events.push({ kind: 'gold', amount: next.au - prev.au });
  if (!next.dead) {
    const before = heroEffects(prev);
    const after = heroEffects(next);
    for (const [ended, changed] of [[false, blessingsGone(after, before)], [true, blessingsGone(before, after)]] as const) {
      if (changed.length) events.push({ kind: 'blessing', ended, icon: changed[0].icon, names: changed.map((e) => e.name) });
    }
  }
  if (quest) events.push(quest);
  return events;
}

/**
 * A quest that ended between two states: a random quest done or failed on its
 * level (leaving it only resets it), or a fixed quest no longer active,
 * wherever that came (on its level, as the hero left it, or away from any
 * quest's level). One gone from the hero's quests is done: tome2 hands a
 * god's quest back once the relic is found, and a bounty once it is paid.
 */
function endedQuest(prev: Tracked, next: Tracked, level: boolean): Extract<QuestEvent, { kind: 'questEnd' }> | null {
  const random = prev.quest?.random ? prev.quest : null;
  if (!level && random?.state === 'active' && next.quest?.random && next.quest.state !== 'active') {
    return { kind: 'questEnd', id: random.id, title: random.title, failed: next.quest.state === 'failed' };
  }
  if (!prev.quests || !next.quests) return null;
  for (const was of prev.quests) {
    if (was.state !== 'active') continue;
    const now = next.quests.find((q) => q.id === was.id);
    if (now?.state !== 'active') return { kind: 'questEnd', id: was.id, title: was.title, failed: now?.state === 'failed' };
  }
  return null;
}

export function isLowHealth(player: Pick<PlayerState, 'chp' | 'mhp'>): boolean {
  return player.mhp > 0 && player.chp / player.mhp < LOW_HEALTH;
}

/**
 * A banner's rank: `passing` (a new depth or area, a kill streak), `milestone`
 * (a level gained, a legend slain) or `quest`. It sets how long the banner
 * stays and what it gives way to.
 */
type BannerRank = 'passing' | 'milestone' | 'quest';
const BANNER_MS: Readonly<Record<BannerRank, number>> = { passing: 2600, milestone: 3600, quest: 4200 };
const RANK_ORDER: Readonly<Record<BannerRank, number>> = { passing: 0, milestone: 1, quest: 2 };
/** How long a deed card, or a toast to be read, stays. */
export const READ_MS = 3600;
/* Between a banner going and one that waited for it. */
const BANNER_GAP_MS = 400;
/* The most banners kept waiting. */
const MAX_WAITING = 2;

interface Banner {
  title: string;
  subtitle: string;
  kind: string;
  rank: BannerRank;
}

function rankOf(kind: string): BannerRank {
  if (kind.startsWith('quest')) return 'quest';
  return kind === 'levelup' || kind === 'legend' || kind === 'returned' ? 'milestone' : 'passing';
}
const FLOAT_MS = 1400;
/* Damage and kill floats over creatures (the CSS animation is 1600ms). */
const FLOAT_AT_MS = 1650;
const RING_MS = 700;
const SHAKE_MS = 420;
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
const FLOAT_OFFSETS: Readonly<Record<string, string>> = { gold: '42%', exp: '50%', blessing: '56%' };

/**
 * Feedback layer over the map: a red flash when hurt, a pulse at low
 * health, a banner for a new level or depth (or the quest it holds) and a
 * float for gold found.
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
  /** The banner showing (until when), and those waiting for it to end. */
  private shown: { banner: Banner; until: number } | null = null;
  private readonly waiting: Banner[] = [];
  /** A banner that waited, about to show once the last has gone. */
  private next: Banner | null = null;
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

  /**
   * Edges the map in the quest's colour while the level's quest is active,
   * glowing stronger while a creature it is after is in view.
   */
  setQuest(active: boolean, foeInView: boolean): void {
    this.layer.classList.toggle('quest', active);
    this.layer.classList.toggle('quest-near', active && foeInView);
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
    this.deedTimer = window.setTimeout(() => this.nextDeed(), READ_MS);
  }

  /** Forgets the last hero, for a new game in the same page. */
  reset(): void {
    this.prev = null;
    this.shown = null;
    this.waiting.length = 0;
    this.layer.classList.remove('quest', 'quest-near');
    this.next = null;
    window.clearTimeout(this.bannerTimer);
    this.banner.classList.remove('visible');
    this.layer.classList.remove('low');
    this.deeds.length = 0;
    window.clearTimeout(this.deedTimer);
    this.deedTimer = 0;
    this.deed.classList.remove('visible');
  }

  /** Compares with the last state seen and plays its feedback, except a quest's arrival or end, which it returns (to be told in a card, or played later with `play`). */
  update(player: Tracked): QuestEvent[] {
    const events = playerEvents(this.prev, player);
    this.prev = { ...player };
    this.layer.classList.toggle('low', isLowHealth(player));
    this.layer.classList.toggle('still', this.animation() === 'off');
    const held: QuestEvent[] = [];
    for (const event of events) {
      if (event.kind === 'quest' || event.kind === 'questEnd') held.push(event);
      else this.play(event);
    }
    return held;
  }

  /** Floats a short text (damage, a pickup) at a point on the stage, in viewport coordinates. */
  floatAt(clientX: number, clientY: number, text: string, kind: string): void {
    const rect = this.layer.getBoundingClientRect();
    const node = el('div', `feel-float at ${kind}`, text);
    node.style.left = `${clientX - rect.left}px`;
    node.style.top = `${clientY - rect.top}px`;
    if (this.animation() === 'off') node.classList.add('still');
    this.layer.append(node);
    window.setTimeout(() => node.remove(), FLOAT_AT_MS);
  }

  /** Plays an event's feedback (a banner, a float). */
  play(event: FeelEvent): void {
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
      case 'quest':
        this.showBanner(event.title, [event.place, event.feet ? `${event.feet} ft` : ''].filter(Boolean).join(' · '), 'quest');
        vibrate([20, 40, 20]);
        break;
      case 'questProgress':
        this.float(`${iconText('⚑')} ${event.slain} of ${event.count}`, 'quest');
        break;
      case 'questEnd':
        this.showBanner(event.title, event.failed ? 'Quest failed' : 'Quest complete', event.failed ? 'quest failed' : 'quest');
        if (!event.failed) vibrate([30, 60, 30]);
        break;
      case 'gold':
        this.float(`+${event.amount} gold`, 'gold');
        break;
      case 'blessing':
        this.float(`${iconText(event.icon)} ${event.names.join(', ')}${event.ended ? (event.names.length === 1 ? ' fades' : ' fade') : ''}`, event.ended ? 'blessing faded' : 'blessing');
        break;
      case 'returned':
        this.flash('returned', 1);
        this.showBanner('Returned from death', livesText(event.lives), 'returned');
        vibrate([60, 120, 60]);
        break;
    }
  }

  private flash(kind: string, strength: number): void {
    if (this.animation() === 'off') return;
    this.vignette.style.setProperty('--strength', String(Math.min(1, strength)));
    this.vignette.classList.remove('hurt', 'levelup', 'returned');
    void this.vignette.offsetWidth;
    this.vignette.classList.add(kind);
  }

  /**
   * Shows a banner. One of a higher rank takes over, and the one it covered
   * comes back after; one of a lower rank waits, and so does one of the same
   * rank, unless both are passing (the newer replaces the older).
   */
  private showBanner(title: string, subtitle: string, kind: string): void {
    const banner: Banner = { title, subtitle, kind, rank: rankOf(kind) };
    const now = performance.now();
    const current = (this.shown && now < this.shown.until ? this.shown.banner : null) ?? this.next;
    if (current) {
      const order = RANK_ORDER[banner.rank] - RANK_ORDER[current.rank];
      if (order < 0 || (order === 0 && banner.rank !== 'passing')) {
        this.enqueue(banner);
        return;
      }
      if (order > 0) this.enqueue(current);
    }
    this.display(banner);
  }

  /** Queues a banner after those of its rank or higher; a passing one replaces any passing one waiting, and the lowest goes when the queue is full. */
  private enqueue(banner: Banner): void {
    if (banner.rank === 'passing') {
      const stale = this.waiting.findIndex((b) => b.rank === 'passing');
      if (stale >= 0) this.waiting.splice(stale, 1);
    }
    const at = this.waiting.findIndex((b) => RANK_ORDER[b.rank] < RANK_ORDER[banner.rank]);
    this.waiting.splice(at < 0 ? this.waiting.length : at, 0, banner);
    this.waiting.length = Math.min(this.waiting.length, MAX_WAITING);
  }

  private display(banner: Banner): void {
    this.next = null;
    this.shown = { banner, until: performance.now() + BANNER_MS[banner.rank] };
    this.banner.className = `feel-banner ${banner.kind}`;
    this.banner.replaceChildren(el('strong', undefined, banner.title), el('span', undefined, banner.subtitle));
    void this.banner.offsetWidth;
    this.banner.classList.add('visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.classList.remove('visible');
      const next = this.waiting.shift();
      if (!next) return;
      this.next = next;
      this.bannerTimer = window.setTimeout(() => this.display(next), BANNER_GAP_MS);
    }, BANNER_MS[banner.rank]);
  }

  private float(text: string, kind: string): void {
    const node = el('div', `feel-float ${kind}`, text);
    node.style.top = FLOAT_OFFSETS[kind.split(' ')[0]] ?? '42%';
    if (this.animation() === 'off') node.classList.add('still');
    this.layer.append(node);
    window.setTimeout(() => node.remove(), FLOAT_MS);
  }
}
