import type { Place } from './audio/places.ts';
import { readableColour } from './render/colour.ts';
import { bar, el, fraction } from './ui/dom.ts';
import { onTap } from './ui/tap.ts';
import { isAlly, isHostile, isNotice, type GameState, type MessageState, type MonsterState, type ObjectState, type PlayerState } from './render/snapshot.ts';

export interface TextSegment {
  text: string;
  colour: string;
}

export type HudEntity = { kind: 'monster'; monster: MonsterState } | { kind: 'object'; object: ObjectState };

export interface HudCallbacks {
  onEntity(entity: HudEntity): void;
  onPlayer(): void;
  /** The skill-points chip was tapped. */
  onSkills(): void;
  onMore(): void;
  onHistory(): void;
}

/* Health just lost lingers this long (ms) before it has drained away. */
const TRAIL_MS = 750;
const TRAIL_HOLD_MS = 300;
/* A hostile creature below this fraction of its health is near death. */
const CRITICAL = 0.25;

const FOOD_WEAK = 1000;
const FOOD_HUNGRY = 2000;
const VISIBLE_MESSAGES = 3;

const STATUS_LABELS: [string, string][] = [
  ['blind', 'Blind'],
  ['confused', 'Confused'],
  ['afraid', 'Afraid'],
  ['poisoned', 'Poisoned'],
  ['paralyzed', 'Paralysed'],
  ['hallucinating', 'Hallucinating'],
  ['cut', 'Bleeding'],
  ['stun', 'Stunned'],
  ['fast', 'Hasted'],
  ['slow', 'Slowed'],
];

export function depthLabel(player: Pick<PlayerState, 'depth' | 'dungeon' | 'wild' | 'area'>): string {
  if (player.depth === 0 && player.area) return player.area;
  if (player.wild) return 'World map';
  if (player.depth === 0) return 'Town';
  return `${player.dungeon} · ${player.depth * 50} ft (L${player.depth})`;
}

/* Wilderness terrain (wf_info.txt names) as places. */
const TERRAIN_NAMES: Readonly<Record<string, string>> = {
  grass: 'Grasslands',
  forest: 'Forest',
  road: 'The road',
  mountain: 'Mountains',
  'high mountain': 'High mountains',
  hill: 'Hills',
  desert: 'Desert',
  jungle: 'Jungle',
  swamp: 'Marshes',
  glacier: 'Glacier',
  'shallow water': 'Shallows',
  'deep water': 'Deep water',
};

/** What a surface place is called: the world map, a town, a quest, or the land around. Null underground. */
export function areaName(place: Pick<Place, 'wild' | 'depth' | 'quest' | 'levelName' | 'town' | 'terrain'> | null): string | null {
  if (!place) return null;
  if (place.wild) return 'World map';
  if (place.depth > 0) return null;
  if (place.quest) return place.levelName.trim() || 'Quest';
  const terrain = place.terrain.trim();
  if (place.town > 0) return terrain || 'Town';
  if (!terrain) return 'The wilds';
  return TERRAIN_NAMES[terrain.toLowerCase()] ?? terrain.charAt(0).toUpperCase() + terrain.slice(1);
}

export function statusLabels(player: Pick<PlayerState, 'status' | 'food'>): string[] {
  const labels = STATUS_LABELS.filter(([key]) => (player.status[key] ?? 0) > 0).map(([, label]) => label);
  if (player.food < FOOD_WEAK) labels.push('Weak');
  else if (player.food < FOOD_HUNGRY) labels.push('Hungry');
  return labels;
}

const STRANGE_GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Hides a creature's identity while the player is hallucinating. */
export function disguiseMonster(m: MonsterState): MonsterState {
  const seed = (m.id * 2654435761) >>> 0;
  return { ...m, name: 'Something strange', ch: STRANGE_GLYPHS.charCodeAt(seed % STRANGE_GLYPHS.length), attr: 1 + (seed % 15), unique: 0 };
}

/** Hides an item's identity while the player is hallucinating. */
export function disguiseObject(o: ObjectState): ObjectState {
  return { ...o, name: 'Something odd', ch: '&'.charCodeAt(0), attr: 1 + ((o.id * 7) % 15) };
}

export function sortByDistance<T extends { x: number; y: number }>(items: T[], px: number, py: number): T[] {
  return [...items].sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
}

/**
 * Renders the Brogue-style sidebar (player bars, visible entities) and the
 * fading message area.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly messagesEl: HTMLElement;
  private readonly callbacks: HudCallbacks;
  private readonly palette: () => readonly string[];
  private lastStateKey = '';
  private lastMessagesKey = '';
  private turn = 0;
  private readonly seenAt = new Map<string, number>();
  private health: { name: string; fill: number } | null = null;
  private trail: { from: number; at: number } | null = null;
  /** The creatures and items in view as they are now, by id, for a tap on their chips. */
  private monsters = new Map<number, MonsterState>();
  private objects = new Map<number, ObjectState>();

  constructor(root: HTMLElement, messagesEl: HTMLElement, palette: () => readonly string[], callbacks: HudCallbacks) {
    this.root = root;
    this.messagesEl = messagesEl;
    this.palette = palette;
    this.callbacks = callbacks;
    messagesEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.more')) this.callbacks.onMore();
      else this.callbacks.onHistory();
    });
    onTap(root, 'button[data-hud]', (button) => this.tapped(button));
  }

  /** Forgets the last hero, for a new game in the same page. */
  reset(): void {
    this.lastStateKey = '';
    this.lastMessagesKey = '';
    this.turn = 0;
    this.seenAt.clear();
    this.health = null;
    this.trail = null;
    this.monsters.clear();
    this.objects.clear();
    this.root.replaceChildren();
    this.messagesEl.replaceChildren();
  }

  /** Called once per player turn (engine idle) to age messages. */
  tick(): void {
    this.turn++;
  }

  /** A HUD button was tapped: the hero, the skill points, or a creature or item (as it is now). */
  private tapped(button: HTMLElement): void {
    const id = Number(button.dataset.id);
    switch (button.dataset.hud) {
      case 'player':
        return this.callbacks.onPlayer();
      case 'skills':
        return this.callbacks.onSkills();
      case 'monster': {
        const monster = this.monsters.get(id);
        if (monster) this.callbacks.onEntity({ kind: 'monster', monster });
        return;
      }
      case 'object': {
        const object = this.objects.get(id);
        if (object) this.callbacks.onEntity({ kind: 'object', object });
        return;
      }
    }
  }

  /**
   * Shows the hero and, in a strip of its own, their ailments and what is in
   * view. The strip keeps its height whether or not anything is in it, so the
   * map never changes size; the HUD is only redrawn when what it shows changes.
   */
  update(state: GameState, py: number, px: number): void {
    if (!state.ready || !state.player) return;
    const p = state.player;
    this.monsters = new Map((state.monsters ?? []).map((m) => [m.id, m]));
    this.objects = new Map((state.objects ?? []).map((o) => [o.id, o]));
    const hallucinating = (p.status.hallucinating ?? 0) > 0;
    const monsters = sortByDistance(hallucinating ? (state.monsters ?? []).map(disguiseMonster) : (state.monsters ?? []), px, py);
    const objects = sortByDistance(hallucinating ? (state.objects ?? []).map(disguiseObject) : (state.objects ?? []), px, py);
    const statuses = statusLabels(p);
    const key = JSON.stringify([
      [p.name, p.race, p.cls, p.lev, p.chp, p.mhp, p.csp, p.msp, p.csane, p.msane, depthLabel(p), p.au, p.speed, p.skillPoints ?? 0],
      statuses,
      monsters.map((m) => [m.id, m.name, m.ch, m.attr, m.hp, m.maxhp, m.asleep, m.afraid, m.unique, m.status]),
      objects.map((o) => [o.id, o.name, o.ch, o.attr]),
    ]);
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;

    const palette = this.palette();
    const player = el('button', 'hud-player');
    player.type = 'button';
    player.dataset.hud = 'player';
    player.dataset.tap = 'player';
    player.setAttribute('aria-label', `${p.name}: character sheet`);
    const who = el('div', 'who');
    who.append(el('span', 'name', p.name), el('span', 'sub', `${p.race} ${p.cls} · Lv ${p.lev}`));
    const bars = el('div', 'bars');
    bars.append(this.healthBar(p));
    if (p.msp > 0) bars.append(bar('sp', 'Mana', p.csp, p.msp));
    if (p.msane > 0) bars.append(bar('sn', 'Sanity', p.csane, p.msane));
    const meta = el('div', 'meta');
    meta.append(el('span', 'place', depthLabel(p)), el('span', undefined, `${p.au} AU`));
    if (p.speed !== 0) meta.append(el('span', p.speed > 0 ? 'good' : 'bad', `Speed ${p.speed > 0 ? '+' : ''}${p.speed}`));
    player.append(who, bars, meta);

    const strip = el('ul', 'hud-entities');
    for (const label of statuses) strip.append(el('li', 'chip', label));
    if ((p.skillPoints ?? 0) > 0) {
      const item = el('li');
      const button = el('button', 'entity skills', `${p.skillPoints} skill point${p.skillPoints === 1 ? '' : 's'} to spend`);
      button.type = 'button';
      button.dataset.hud = 'skills';
      button.dataset.tap = 'skills';
      item.append(button);
      strip.append(item);
    }
    for (const m of monsters) strip.append(this.monsterItem(m, palette));
    for (const o of objects) strip.append(this.objectItem(o, palette));
    if (!strip.childElementCount) strip.append(el('li', 'quiet', 'All quiet'));

    this.root.replaceChildren(player, strip, ...(this.messagesEl.parentElement === this.root ? [this.messagesEl] : []));
  }

  /** The health bar, with a pale band over health lost in the last moment. */
  private healthBar(p: PlayerState): HTMLElement {
    const node = bar('hp', 'Health', p.chp, p.mhp);
    const fill = fraction(p.chp, p.mhp);
    const now = performance.now();
    const before = this.health?.name === p.name ? this.health.fill : null;
    this.health = { name: p.name, fill };
    if (this.trail && now - this.trail.at >= TRAIL_MS) this.trail = null;
    if (before !== null && fill < before) {
      this.trail = { from: Math.max(before, this.trail?.from ?? 0), at: now };
    } else if (before !== null && fill > before) {
      this.trail = null;
    }
    if (this.trail && this.trail.from > fill) {
      const band = el('span', 'bar-trail');
      band.style.setProperty('--from', `${(this.trail.from * 100).toFixed(1)}%`);
      band.style.animationDelay = `${Math.round(TRAIL_HOLD_MS - (now - this.trail.at))}ms`;
      node.prepend(band);
    }
    return node;
  }

  private glyph(ch: number, attr: number, palette: readonly string[]): HTMLElement {
    const g = el('span', 'glyph', String.fromCharCode(ch));
    g.style.color = palette[attr] ?? '#fff';
    return g;
  }

  private entityButton(kind: HudEntity['kind'], id: number): HTMLButtonElement {
    const button = el('button', 'entity');
    button.type = 'button';
    button.dataset.hud = kind;
    button.dataset.id = String(id);
    button.dataset.tap = `${kind}:${id}`;
    return button;
  }

  private monsterItem(m: MonsterState, palette: readonly string[]): HTMLElement {
    const item = el('li');
    const button = this.entityButton('monster', m.id);
    const friendly = isAlly(m);
    const neutral = !friendly && !isHostile(m);
    button.classList.add(friendly ? 'ally' : neutral ? 'neutral' : 'foe');
    if (!friendly && !neutral && m.maxhp > 0 && m.hp < m.maxhp * CRITICAL) button.classList.add('critical');
    button.style.setProperty('--fill', `${(fraction(m.hp, m.maxhp) * 100).toFixed(1)}%`);
    const tags: string[] = [];
    if (m.asleep) tags.push('asleep');
    if (m.afraid) tags.push('afraid');
    const text = el('span', 'entity-text');
    text.append(el('span', m.unique ? 'label unique' : 'label', m.name));
    if (tags.length) text.append(el('span', 'tags', tags.join(' · ')));
    button.append(this.glyph(m.ch, m.attr, palette), text);
    button.setAttribute('aria-label', [m.name, friendly ? 'ally' : neutral ? 'neutral' : 'hostile', ...tags].join(', '));
    item.append(button);
    return item;
  }

  private objectItem(o: ObjectState, palette: readonly string[]): HTMLElement {
    const item = el('li');
    const button = this.entityButton('object', o.id);
    button.classList.add('item');
    const text = el('span', 'entity-text');
    text.append(el('span', 'label', o.name));
    button.append(this.glyph(o.ch, o.attr, palette), text);
    item.append(button);
    return item;
  }

  /**
   * Shows the current prompt line (terminal row 0) above the most recent
   * messages, which fade as turns pass.
   */
  updateMessages(messages: readonly MessageState[], total: number, current: TextSegment[]): void {
    const keyOf = (m: MessageState, age: number) => `${total - 1 - age}\u0000${m.text}`;
    messages.forEach((m, age) => {
      const k = keyOf(m, age);
      if (!this.seenAt.has(k)) this.seenAt.set(k, this.turn);
    });
    if (this.seenAt.size > 400) {
      const keep = new Set(messages.map(keyOf));
      for (const k of this.seenAt.keys()) if (!keep.has(k)) this.seenAt.delete(k);
    }

    const currentText = current.map((s) => s.text).join('').trim();
    const key = JSON.stringify([messages.slice(0, VISIBLE_MESSAGES + 1), total, current, this.turn]);
    if (key === this.lastMessagesKey) return;
    this.lastMessagesKey = key;

    const palette = this.palette();
    const lines: HTMLElement[] = [];
    let history = messages.filter((m) => /[^\s=\-_~*]/.test(m.text));
    /* The prompt line repeats the newest messages (joined on one row); keep each once. */
    while (currentText && history.length && currentText.includes(history[0].text.slice(0, 20))) history = history.slice(1);
    const historyCount = currentText ? VISIBLE_MESSAGES - 1 : VISIBLE_MESSAGES;

    history.slice(0, historyCount).reverse().forEach((m, i, arr) => {
      const age = arr.length - 1 - i;
      const turns = this.turn - (this.seenAt.get(keyOf(m, messages.indexOf(m))) ?? this.turn);
      const line = el('div', isNotice(m) ? 'msg notice' : 'msg', m.text);
      if (!isNotice(m)) line.style.color = readableColour(palette[m.color] ?? '#ddd');
      line.style.opacity = String(Math.max(0.22, 0.85 - turns * 0.12 - age * 0.18));
      lines.push(line);
    });

    if (currentText) {
      const line = el('div', 'msg current');
      const more = currentText.endsWith('-more-');
      for (const segment of current) {
        const text = more ? segment.text.replace(/-more-\s*$/, '') : segment.text;
        if (!text) continue;
        const span = el('span', undefined, text);
        span.style.color = readableColour(segment.colour);
        line.append(span);
      }
      if (more) line.append(el('span', 'more', 'more ▸'));
      lines.push(line);
    }

    this.messagesEl.replaceChildren(...lines);
  }
}

/** Splits a terminal row into runs of equal colour. */
export function rowSegments(chars: Uint8Array, attrs: Uint8Array, palette: readonly string[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let end = chars.length;
  while (end > 0 && (chars[end - 1] === 0x20 || chars[end - 1] === 0)) end--;
  let start = 0;
  while (start < end) {
    const attr = attrs[start];
    let stop = start + 1;
    while (stop < end && attrs[stop] === attr) stop++;
    segments.push({ text: String.fromCharCode(...chars.subarray(start, stop)), colour: palette[attr] ?? '#ddd' });
    start = stop;
  }
  return segments;
}
