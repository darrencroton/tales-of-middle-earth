import { readableColour } from './render/colour.ts';
import { isAlly, isHostile, type GameState, type MessageState, type MonsterState, type ObjectState, type PlayerState } from './render/snapshot.ts';

export interface TextSegment {
  text: string;
  colour: string;
}

export type HudEntity = { kind: 'monster'; monster: MonsterState } | { kind: 'object'; object: ObjectState };

export interface HudCallbacks {
  onEntity(entity: HudEntity): void;
  onPlayer(): void;
  onMore(): void;
  onHistory(): void;
}

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fraction(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}

function bar(kind: string, label: string, value: number, max: number): HTMLElement {
  const node = el('div', `bar bar-${kind}`);
  node.style.setProperty('--fill', `${(fraction(value, max) * 100).toFixed(1)}%`);
  node.append(el('span', 'bar-label', label), el('span', 'bar-value', `${value}/${max}`));
  return node;
}

export function depthLabel(player: Pick<PlayerState, 'depth' | 'dungeon' | 'wild'>): string {
  if (player.wild) return 'Wilderness';
  if (player.depth === 0) return 'Town';
  return `${player.dungeon} · ${player.depth * 50} ft (L${player.depth})`;
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

  constructor(root: HTMLElement, messagesEl: HTMLElement, palette: () => readonly string[], callbacks: HudCallbacks) {
    this.root = root;
    this.messagesEl = messagesEl;
    this.palette = palette;
    this.callbacks = callbacks;
    messagesEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.more')) this.callbacks.onMore();
      else this.callbacks.onHistory();
    });
  }

  /** Called once per player turn (engine idle) to age messages. */
  tick(): void {
    this.turn++;
  }

  update(state: GameState, py: number, px: number): void {
    if (!state.ready || !state.player) return;
    const key = JSON.stringify([state.player, state.monsters, state.objects, py, px]);
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;

    const p = state.player;
    const palette = this.palette();
    const player = el('button', 'hud-player');
    player.type = 'button';
    player.setAttribute('aria-label', `${p.name}: character sheet`);
    player.addEventListener('click', () => this.callbacks.onPlayer());
    const who = el('div', 'who');
    who.append(el('span', 'name', p.name), el('span', 'sub', `${p.race} ${p.cls} · Lv ${p.lev}`));
    const bars = el('div', 'bars');
    bars.append(bar('hp', 'Health', p.chp, p.mhp));
    if (p.msp > 0) bars.append(bar('sp', 'Mana', p.csp, p.msp));
    if (p.msane > 0) bars.append(bar('sn', 'Sanity', p.csane, p.msane));
    const meta = el('div', 'meta');
    meta.append(el('span', undefined, depthLabel(p)), el('span', undefined, `${p.au} AU`));
    if (p.speed !== 0) meta.append(el('span', p.speed > 0 ? 'good' : 'bad', `Speed ${p.speed > 0 ? '+' : ''}${p.speed}`));
    const chips = el('div', 'chips');
    for (const label of statusLabels(p)) chips.append(el('span', 'chip', label));
    player.append(who, bars, meta, chips);

    const list = el('ul', 'hud-entities');
    const hallucinating = (p.status.hallucinating ?? 0) > 0;
    const monsters = hallucinating ? (state.monsters ?? []).map(disguiseMonster) : (state.monsters ?? []);
    const objects = hallucinating ? (state.objects ?? []).map(disguiseObject) : (state.objects ?? []);
    const real = new Map((state.monsters ?? []).map((m) => [m.id, m]));
    const realObjects = new Map((state.objects ?? []).map((o) => [o.id, o]));
    for (const m of sortByDistance(monsters, px, py)) list.append(this.monsterItem(m, real.get(m.id) ?? m, palette));
    for (const o of sortByDistance(objects, px, py)) list.append(this.objectItem(o, realObjects.get(o.id) ?? o, palette));

    this.root.replaceChildren(player, list);
  }

  private glyph(ch: number, attr: number, palette: readonly string[]): HTMLElement {
    const g = el('span', 'glyph', String.fromCharCode(ch));
    g.style.color = palette[attr] ?? '#fff';
    return g;
  }

  private entityButton(entity: HudEntity): HTMLButtonElement {
    const button = el('button', 'entity');
    button.type = 'button';
    button.addEventListener('click', () => this.callbacks.onEntity(entity));
    return button;
  }

  private monsterItem(m: MonsterState, real: MonsterState, palette: readonly string[]): HTMLElement {
    const item = el('li');
    const button = this.entityButton({ kind: 'monster', monster: real });
    const friendly = isAlly(m);
    const neutral = !friendly && !isHostile(m);
    button.classList.add(friendly ? 'ally' : neutral ? 'neutral' : 'foe');
    button.style.setProperty('--fill', `${(fraction(m.hp, m.maxhp) * 100).toFixed(1)}%`);
    const tags: string[] = [];
    if (m.asleep) tags.push('asleep');
    if (m.afraid) tags.push('afraid');
    if (friendly) tags.push('ally');
    if (neutral) tags.push('neutral');
    button.append(this.glyph(m.ch, m.attr, palette), el('span', m.unique ? 'label unique' : 'label', m.name));
    if (tags.length) button.append(el('span', 'tags', tags.join(', ')));
    item.append(button);
    return item;
  }

  private objectItem(o: ObjectState, real: ObjectState, palette: readonly string[]): HTMLElement {
    const item = el('li');
    const button = this.entityButton({ kind: 'object', object: real });
    button.classList.add('item');
    button.append(this.glyph(o.ch, o.attr, palette), el('span', 'label', o.name));
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
    if (currentText && history.length && currentText.startsWith(history[0].text.slice(0, 20))) history = history.slice(1);
    const historyCount = currentText ? VISIBLE_MESSAGES - 1 : VISIBLE_MESSAGES;

    history.slice(0, historyCount).reverse().forEach((m, i, arr) => {
      const age = arr.length - 1 - i;
      const turns = this.turn - (this.seenAt.get(keyOf(m, messages.indexOf(m))) ?? this.turn);
      const line = el('div', 'msg', m.text);
      line.style.color = readableColour(palette[m.color] ?? '#ddd');
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
