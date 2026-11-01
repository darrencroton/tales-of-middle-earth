import { KEY_BACKSLASH, keyCodes } from '../input/keys.ts';
import { directionDigit } from '../play/prompts.ts';
import { readableColour } from '../render/colour.ts';
import type { MapPoint } from '../render/map.ts';
import { isAlly, isHostile, isNeutral, type LevelQuest, type MonsterState, type ObjectState } from '../render/snapshot.ts';
import { capitalise, descriptionParagraphs, titleName, type GameApi } from './api.ts';
import { el, glyph, iconText, leadIn } from './dom.ts';
import { openItem } from './inventory.ts';
import type { SheetAction, Sheets } from './sheet.ts';


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

  const fallen = !!api.state()?.player?.dead;
  const friendly = !isHostile(m);
  const near = snap ? distance({ x: snap.px, y: snap.py }, m) : 99;
  /* Beside the hero, someone neutral can be talked to, and anyone not hostile given something (tome2's Y and y, with its direction). */
  const busy = snap?.atCommand ? null : 'Finish what you are doing first.';
  const towards = (id: string, label: string, command: string, primary: boolean): SheetAction => ({
    id,
    label,
    primary,
    unavailable: busy,
    run: () => {
      if (snap) api.send([KEY_BACKSLASH, ...keyCodes(`${command}${directionDigit(m.x - snap.px, m.y - snap.py)}`)]);
    },
  });
  const actions: SheetAction[] = fallen
    ? []
    : [
        ...(friendly && near === 1
          ? [...(isNeutral(m) ? [towards('talk', 'Talk', 'Y', true)] : []), towards('give', 'Give', 'y', !isNeutral(m))]
          : [{ id: 'approach', label: friendly ? 'Go to' : near <= 1 ? 'Attack' : 'Approach', primary: true, run: () => api.travelTo({ x: m.x, y: m.y }) }]),
        {
          id: 'show',
          label: 'Show on map',
          run: () => {
            api.sheets.closeAll();
            api.highlight({ x: m.x, y: m.y });
          },
        },
      ];

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
    actions,
    kind: 'card',
    className: 'sheet-monster',
  });
}

/** An item seen on the floor somewhere on the level. */
export function openFloorObject(api: GameApi, o: ObjectState): void {
  const snap = api.snapshot();
  const underfoot = snap && snap.px === o.x && snap.py === o.y && !api.state()?.player?.dead;
  if (underfoot) {
    const item = api.engine.inventory()?.floor.find((f) => f.i === -o.id);
    if (item) {
      openItem(api, item, 'floor');
      return;
    }
  }
  const body = el('div', 'item-detail');
  const actions: SheetAction[] = api.state()?.player?.dead
    ? []
    : [
        { id: 'goto', label: 'Go there', primary: true, run: () => api.travelTo({ x: o.x, y: o.y }) },
        {
          id: 'show',
          label: 'Show on map',
          run: () => {
            api.sheets.closeAll();
            api.highlight({ x: o.x, y: o.y });
          },
        },
      ];
  const description = el('div', 'description');
  const paragraphs = descriptionParagraphs(api.engine.objectDescription(-o.id));
  for (const p of paragraphs.length ? paragraphs : ['You know nothing more about this item yet.']) description.append(el('p', undefined, p));
  body.append(description);
  api.sheets.open({
    title: titleName(o.name),
    subtitle: 'On the floor',
    badge: glyph(o.ch, api.palette()[o.attr] ?? '#fff'),
    body,
    actions,
    kind: 'card',
    className: 'sheet-item',
  });
}

export interface CellDescription {
  point: MapPoint;
  /** The terrain, as tome2's look names it ("Grass", "General Store"); "Unexplored" when unknown. */
  title: string;
  /** Where the hero stands, in view, remembered, or nothing known. */
  note: 'here' | 'view' | 'remembered' | 'unknown';
  /** Visible creatures there. */
  monsters: MonsterState[];
  /** Objects noticed there, seen now or remembered. */
  objects: ObjectState[];
  /** Creatures and objects there cannot be made out (hallucinating). */
  blurred: boolean;
  known: boolean;
  player: boolean;
}

/** What the hero perceives or remembers at a map cell, within what tome2 lets them know. */
export function describeCell(api: GameApi, point: MapPoint): CellDescription | null {
  const snap = api.snapshot();
  if (!snap || point.x < 0 || point.y < 0 || point.x >= snap.width || point.y >= snap.height) return null;
  const grid = api.engine.grid(point.x, point.y);
  const state = api.state();
  const known = !!grid?.known;
  const player = snap.px === point.x && snap.py === point.y;
  const name = (grid?.name ?? '').replace(/\.$/, '').replace(/^(a|an) /i, '');
  const monsters = (state?.monsters ?? []).filter((m) => m.x === point.x && m.y === point.y);
  const objects = (grid?.objects ?? []).map((o) => ({ ...o, x: point.x, y: point.y }));
  const blurred = (state?.player?.status.hallucinating ?? 0) > 0 && (monsters.length > 0 || objects.length > 0);
  return {
    point,
    title: known && name ? capitalise(name) : 'Unexplored',
    note: player ? 'here' : !known ? 'unknown' : grid?.view ? 'view' : 'remembered',
    monsters: blurred ? [] : monsters,
    objects: blurred ? [] : objects,
    blurred,
    known,
    player,
  };
}

/** What a level's quest asks, as paragraphs: a fixed quest's description (tome2 wraps it at 80 columns), or a random quest in our words with the creatures slain. */
export function questParagraphs(quest: LevelQuest): string[] {
  const r = quest.random;
  if (!r) return quest.lines?.length ? [quest.lines.join(' ')] : [];
  const ask =
    r.kind === 'sword'
      ? `An adventurer's sword was taken by creatures roaming this level. Defeat them all to win it back: ${r.count} × ${r.foe}.`
      : r.count === 1
        ? `A princess is held captive on this level by ${r.foe}. Defeat her captor to set her free.`
        : `A princess is held captive on this level. Defeat her guards to set her free: ${r.count} × ${r.foe}.`;
  return [ask, `Slain: ${r.slain} of ${r.count}.`];
}

/** How a quest begins or ends, told in its card: the heading under its title, what tome2 said then, and whether to say what it asks. */
export interface QuestMoment {
  subtitle: string;
  scene: readonly string[];
  task: boolean;
}

/** The quest of the level, as a card: what it asks (from the HUD's chip); as it begins or ends, what tome2 said then, first. */
export function openQuest(sheets: Sheets, quest: LevelQuest, moment?: QuestMoment): void {
  const body = el('div', 'description');
  if (moment?.scene.length) body.append(leadIn(moment.scene));
  if (!moment || moment.task) for (const text of questParagraphs(quest)) body.append(el('p', undefined, text));
  sheets.open({
    title: quest.title,
    subtitle: moment?.subtitle ?? 'Quest on this level',
    badge: el('span', 'glyph quest', iconText('⚑')),
    body,
    kind: 'card',
    className: 'sheet-quest',
    actions: moment ? [{ id: 'onward', label: 'Onward', run: () => sheets.back() }] : [],
  });
}
