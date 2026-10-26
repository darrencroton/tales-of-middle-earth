import { readableColour } from '../render/colour.ts';
import type { MapPoint } from '../render/map.ts';
import { CAVE_MARK, CAVE_SEEN, isAlly, isHostile, type MonsterState, type ObjectState } from '../render/snapshot.ts';
import { capitalise, titleName, type GameApi } from './api.ts';
import { el, glyph, navButton } from './dom.ts';
import { descriptionParagraphs, openItem } from './inventory.ts';


export function healthWord(hp: number, maxhp: number): string {
  if (maxhp <= 0) return 'unhurt';
  const pct = (100 * Math.max(0, hp)) / maxhp;
  if (pct >= 100) return 'unhurt';
  if (pct >= 60) return 'somewhat wounded';
  if (pct >= 25) return 'wounded';
  if (pct >= 10) return 'badly wounded';
  return 'almost dead';
}

export function monsterSummary(m: MonsterState): string {
  const parts: string[] = [];
  if (m.level !== undefined) parts.push(`Level ${m.level}`);
  parts.push(m.asleep ? 'asleep' : 'awake');
  if (m.afraid) parts.push('afraid');
  parts.push(healthWord(m.hp, m.maxhp));
  if (isAlly(m)) parts.push('ally');
  else if (!isHostile(m)) parts.push('neutral');
  return parts.join(' · ');
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Details and recall for a visible creature. */
export function openMonster(api: GameApi, m: MonsterState): void {
  const snap = api.snapshot();
  const body = el('div', 'monster-detail');
  const health = el('div', `health ${isAlly(m) ? 'ally' : ''}`);
  health.style.setProperty('--fill', `${Math.max(0, Math.min(100, (100 * m.hp) / Math.max(1, m.maxhp))).toFixed(1)}%`);
  health.append(el('span', undefined, capitalise(healthWord(m.hp, m.maxhp))));
  body.append(health);

  const actions = el('div', 'action-grid');
  const friendly = !isHostile(m);
  const near = snap ? distance({ x: snap.px, y: snap.py }, m) : 99;
  actions.append(
    navButton(friendly ? 'Go to' : near <= 1 ? 'Attack' : 'Approach', {
      className: 'action-button primary',
      onClick: () => api.travelTo({ x: m.x, y: m.y }),
    }),
    navButton('Show on map', {
      className: 'action-button',
      onClick: () => {
        api.sheets.closeAll();
        api.highlight({ x: m.x, y: m.y });
      },
    }),
  );
  body.append(actions);

  const recall = api.engine.monsterRecall(m.id);
  const description = el('div', 'description recall');
  let paragraph = el('p');
  for (const [attr, text] of recall?.text ?? []) {
    const pieces = text.split('\n');
    pieces.forEach((piece, i) => {
      if (i > 0 && paragraph.textContent?.trim()) {
        description.append(paragraph);
        paragraph = el('p');
      }
      if (!piece) return;
      const span = el('span', undefined, piece);
      if (attr !== 1) span.style.color = readableColour(api.palette()[attr] ?? '');
      paragraph.append(span);
    });
  }
  if (paragraph.textContent?.trim()) description.append(paragraph);
  if (!description.childElementCount) description.append(el('p', 'muted', 'You know nothing more about this creature.'));
  body.append(description);

  api.sheets.open({
    title: titleName(m.name),
    subtitle: monsterSummary(m),
    badge: glyph(m.ch, api.palette()[m.attr] ?? '#fff'),
    body,
    className: 'sheet-monster',
  });
}

/** An item seen on the floor somewhere on the level. */
export function openFloorObject(api: GameApi, o: ObjectState): void {
  const snap = api.snapshot();
  const underfoot = snap && snap.px === o.x && snap.py === o.y;
  if (underfoot) {
    const item = api.engine.inventory()?.floor.find((f) => f.i === -o.id);
    if (item) {
      openItem(api, item, 'floor');
      return;
    }
  }
  const body = el('div', 'item-detail');
  const actions = el('div', 'action-grid');
  actions.append(
    navButton('Go there', { className: 'action-button primary', onClick: () => api.travelTo({ x: o.x, y: o.y }) }),
    navButton('Show on map', {
      className: 'action-button',
      onClick: () => {
        api.sheets.closeAll();
        api.highlight({ x: o.x, y: o.y });
      },
    }),
  );
  body.append(actions);
  const description = el('div', 'description');
  const paragraphs = descriptionParagraphs(api.engine.objectDescription(-o.id));
  for (const p of paragraphs.length ? paragraphs : ['You know nothing more about this item yet.']) description.append(el('p', undefined, p));
  body.append(description);
  api.sheets.open({
    title: titleName(o.name),
    subtitle: 'On the floor',
    badge: glyph(o.ch, api.palette()[o.attr] ?? '#fff'),
    body,
    className: 'sheet-item',
  });
}

export interface CellDescription {
  point: MapPoint;
  /** One-line summary, e.g. "a Village idiot (awake, unhurt) on grass". */
  text: string;
  monsters: MonsterState[];
  objects: ObjectState[];
  terrain: string;
  known: boolean;
  player: boolean;
}

/** What the player can see (or remembers) at a map cell. */
export function describeCell(api: GameApi, point: MapPoint): CellDescription | null {
  const snap = api.snapshot();
  if (!snap || point.x < 0 || point.y < 0 || point.x >= snap.width || point.y >= snap.height) return null;
  const state = api.state();
  const i = point.y * snap.width + point.x;
  const known = (snap.info[i] & (CAVE_MARK | CAVE_SEEN)) !== 0;
  const terrain = known ? (api.features()[snap.feat[i]]?.name ?? 'something') : '';
  const monsters = (state?.monsters ?? []).filter((m) => m.x === point.x && m.y === point.y);
  const objects = (state?.objects ?? []).filter((o) => o.x === point.x && o.y === point.y);
  const player = snap.px === point.x && snap.py === point.y;

  const things: string[] = [];
  if (player) things.push('yourself');
  for (const m of monsters) things.push(`${m.unique ? '' : `${article(m.name)} `}${m.name} (${m.asleep ? 'asleep' : 'awake'}, ${healthWord(m.hp, m.maxhp)})`);
  for (const o of objects) things.push(o.name);
  let text: string;
  if (!known && things.length === 0) text = 'You have not explored there.';
  else if (things.length === 0) text = `You see ${/^[aeiou]/i.test(terrain) ? 'an' : 'a'} ${terrain}.`;
  else text = `You see ${things.join(', ')}${terrain ? ` on ${terrain}` : ''}.`;

  return { point, text: capitalise(text), monsters, objects, terrain, known, player };
}
