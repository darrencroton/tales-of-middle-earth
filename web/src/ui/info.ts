import { bondName, FRIEND, orderRefusal, PET, type Companion } from '../play/companions.ts';
import { directionDigit } from '../play/prompts.ts';
import { NO_TARGET } from '../play/recent.ts';
import type { MapPoint } from '../render/map.ts';
import { isAlly, isHostile, isNeutral, type LevelQuest, type MonsterState, type ObjectState } from '../render/snapshot.ts';
import { capitalise, itemGlyph, NOT_NOW, titleName, type GameApi } from './api.ts';
import { el, fraction, iconText, leadIn } from './dom.ts';
import { confirmSheet } from './menus.ts';
import { openItem } from './inventory.ts';
import { itemCardBody, recallLines, recallParagraphs } from './inspect.ts';
import type { SheetAction, Sheets } from './sheet.ts';

function healthWord(hp: number, maxhp: number): string {
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
  if (m.status >= FRIEND) parts.push(bondName(m).toLowerCase());
  else if (isAlly(m)) parts.push('ally');
  else if (!isHostile(m)) parts.push('neutral');
  return parts.join(' · ');
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Why the hero cannot give their creatures orders now, or null: tome2's `P` waits for the command prompt, is refused while confused, and ignored on the world map or while controlling a creature. */
export function orderUnavailable(api: GameApi): string | null {
  if (!api.snapshot()?.atCommand) return NOT_NOW;
  return api.refusal('P') ?? orderRefusal((api.state()?.player?.status.confused ?? 0) > 0);
}

/** A creature on the hero's side as the creature card takes it: where it stands, and whether the hero can see it. */
export function companionMonster(c: Companion): MonsterState {
  return { id: c.id, name: c.name, ch: c.ch, attr: c.attr, x: c.x, y: c.y, hp: c.hp, maxhp: c.maxhp, asleep: c.asleep, afraid: 0, unique: c.unique, status: c.status, level: c.level, view: c.seen };
}

/**
 * The card actions for a creature on the hero's side: call it off the foe it
 * is set on (tome2's *friend forget target*: it chooses its own again), and dismiss it for good (asked first; not one that cannot die).
 * `changed` runs once it has gone or been called off.
 */
export function companionActions(api: GameApi, m: Pick<MonsterState, 'id' | 'name' | 'status'>, changed: () => void = () => undefined): SheetAction[] {
  if (m.status < FRIEND) return [];
  const c = api.engine.companions()?.list.find((x) => x.id === m.id);
  if (!c) return [];
  const why = orderUnavailable(api);
  const name = titleName(c.name);
  const actions: SheetAction[] = [];
  if (c.target && c.status >= PET) {
    actions.push({
      id: 'calloff',
      label: 'Call off',
      unavailable: why,
      run: () => {
        if (!api.engine.callOff(c.id)) return;
        api.tell(`${name} turns from ${titleName(c.target!)}, free to choose its own foe.`);
        api.sheets.back();
        changed();
      },
    });
  }
  if (!c.stays) {
    actions.push({
      id: 'dismiss',
      label: 'Dismiss',
      danger: true,
      unavailable: why,
      run: () =>
        confirmSheet(
          api.sheets,
          `Dismiss ${name}?`,
          `${name} leaves your side for good.`,
          'Dismiss',
          () => {
            api.sheets.back();
            if (!api.engine.dismissCompanion(c.id)) return;
            api.sheets.back();
            api.tell(`You dismiss ${name}.`);
            api.redraw();
            changed();
          },
          true,
        ),
    });
  }
  return actions;
}

/** Sets the hero's creatures on a hostile creature (tome2's "give target to all friends"), offered while any are with them. */
export function setOnAction(api: GameApi, m: MonsterState): SheetAction | null {
  if (!isHostile(m)) return null;
  const pack = api.engine.companions()?.list.filter((c) => c.status >= PET) ?? [];
  if (!pack.length) return null;
  return {
    id: 'seton',
    label: pack.length === 1 ? `Send ${titleName(pack[0].name)}` : 'Send companions',
    unavailable: orderUnavailable(api),
    run: () => {
      if (!api.engine.setCompanionsOn(m.id)) return;
      api.sheets.closeAll();
      api.tell(`${pack.length === 1 ? titleName(pack[0].name) : 'Your companions'} turn${pack.length === 1 ? 's' : ''} on ${titleName(m.name)}.`);
    },
  };
}

/**
 * Details and recall for a creature: one in view, or one on the hero's side
 * wherever it is (from Companions). `changed` runs once a creature on the
 * hero's side has been called off or dismissed.
 */
export function openMonster(api: GameApi, m: MonsterState, changed?: () => void): void {
  const snap = api.snapshot();
  const body = el('div', 'monster-detail');
  const health = el('div', `health ${isAlly(m) ? 'ally' : ''}`);
  health.style.setProperty('--fill', `${(fraction(m.hp, m.maxhp) * 100).toFixed(1)}%`);
  health.append(el('span', undefined, capitalise(healthWord(m.hp, m.maxhp))));
  body.append(health);

  const fallen = !!api.state()?.player?.dead;
  const seen = (api.state()?.monsters ?? []).some((x) => x.id === m.id);
  const friendly = !isHostile(m);
  const near = snap ? distance({ x: snap.px, y: snap.py }, m) : 99;
  /* Beside the hero, someone neutral can be talked to, and anyone not hostile given something (tome2's Y and y, with its direction). */
  const towards = (id: string, label: string, command: 'Y' | 'y', primary: boolean): SheetAction => ({
    id,
    label,
    primary,
    unavailable: snap?.atCommand ? api.refusal(command) : NOT_NOW,
    run: () => {
      const digit = snap && directionDigit(m.x - snap.px, m.y - snap.py);
      if (digit) api.converse(command, digit);
    },
  });
  const where: SheetAction[] = !seen
    ? []
    : [
        ...(friendly && near === 1
          ? [...(isNeutral(m) ? [towards('talk', 'Talk', 'Y', true)] : []), towards('give', 'Give', 'y', !isNeutral(m))]
          : [{ id: 'approach', label: friendly ? 'Go to' : near <= 1 ? 'Attack' : 'Approach', primary: true, unavailable: api.travelRefusal(), run: () => api.travelTo({ x: m.x, y: m.y }) }]),
        {
          id: 'show',
          label: 'Show on map',
          run: () => {
            api.sheets.closeAll();
            api.highlight({ x: m.x, y: m.y });
          },
        },
      ];
  const target: SheetAction[] =
    seen && isHostile(m) && m.target
      ? [{ id: 'target', label: 'Target', unavailable: snap?.atCommand ? api.refusal('*') : NOT_NOW, run: () => api.target({ x: m.x, y: m.y }) }]
      : [];
  const setOn = seen ? setOnAction(api, m) : null;
  const actions: SheetAction[] = fallen ? [] : [...where, ...target, ...(setOn ? [setOn] : []), ...companionActions(api, m, changed)];

  body.append(recallParagraphs(recallLines(api.engine, api.palette(), m.id), 'You know nothing more about this creature.'));

  api.sheets.open({
    title: titleName(m.name),
    subtitle: seen ? monsterSummary(m) : `${monsterSummary(m)} · out of sight`,
    badge: itemGlyph(api, m),
    body,
    actions,
    kind: 'card',
    className: 'sheet-monster',
  });
}

/** Choose target: the foes a spell or missile can be aimed at, nearest first; one tapped becomes tome2's target. */
export function openTargets(api: GameApi): void {
  const snap = api.snapshot();
  if (!snap) return;
  const hero = { x: snap.px, y: snap.py };
  const foes = (api.state()?.monsters ?? []).filter((m) => isHostile(m) && m.target).sort((a, b) => distance(hero, a) - distance(hero, b));
  const list = el('div', 'menu-list');
  for (const m of foes) {
    const row = el('button', 'row-button race-row');
    row.type = 'button';
    row.dataset.nav = '';
    row.dataset.key = String(m.id);
    const text = el('span', 'row-text');
    const steps = distance(hero, m);
    text.append(el('span', 'row-label', titleName(m.name)), el('span', 'row-line', `${monsterSummary(m)} · ${steps <= 1 ? 'beside you' : `${steps} steps away`}`));
    row.append(itemGlyph(api, m), text);
    row.addEventListener('click', () => api.target({ x: m.x, y: m.y }));
    list.append(row);
  }
  if (!foes.length) list.append(el('p', 'empty', NO_TARGET));
  api.sheets.open({
    title: 'Choose target',
    subtitle: 'Spells and missiles go to your target while it is in reach',
    body: list,
    kind: 'card',
    className: 'sheet-targets',
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
        { id: 'goto', label: 'Go there', primary: true, unavailable: api.travelRefusal(), run: () => api.travelTo({ x: o.x, y: o.y }) },
        {
          id: 'show',
          label: 'Show on map',
          run: () => {
            api.sheets.closeAll();
            api.highlight({ x: o.x, y: o.y });
          },
        },
      ];
  body.append(itemCardBody(api, api.engine.itemInfo(-o.id), 'You know nothing more about this item yet.'));
  api.sheets.open({
    title: titleName(o.name),
    subtitle: 'On the floor',
    badge: itemGlyph(api, o),
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
  /** The god of an altar there. */
  god?: string;
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
    god: grid?.god,
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
interface QuestMoment {
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
