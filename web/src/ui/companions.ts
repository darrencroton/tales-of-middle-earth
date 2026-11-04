import { bondName, companionOrder, companionsLine, LEASHES, type Companion, type Leash } from '../play/companions.ts';
import { itemGlyph, NOT_NOW, titleName, type GameApi } from './api.ts';
import { el, section } from './dom.ts';
import { companionMonster, openMonster, orderUnavailable } from './info.ts';
import { segmented } from './menus.ts';
import type { SheetContent } from './sheet.ts';

/** The line under a creature on the hero's side: what it is to them, how it fares, where it is and whom it is set on. */
function companionLine(c: Companion): string {
  const parts = [bondName(c), `Level ${c.level}`];
  if (c.hp < c.maxhp) parts.push(`${Math.max(0, Math.round((100 * c.hp) / Math.max(1, c.maxhp)))}% health`);
  if (c.asleep) parts.push('asleep');
  parts.push(c.seen ? (c.dist <= 1 ? 'beside you' : `${c.dist} steps away`) : 'out of sight');
  if (c.target) parts.push(`fighting ${titleName(c.target)}`);
  return parts.join(' · ');
}

function companionRow(api: GameApi, c: Companion, open: (c: Companion) => void): HTMLButtonElement {
  const row = el('button', 'row-button race-row');
  row.type = 'button';
  row.dataset.nav = '';
  row.dataset.key = String(c.id);
  const text = el('span', 'row-text');
  text.append(el('span', 'row-label', titleName(c.name)), el('span', 'row-line', companionLine(c)));
  row.append(itemGlyph(api, c), text);
  row.addEventListener('click', () => open(c));
  return row;
}

/** A switch row: what it does, and whether it is on. */
function switchRow(label: string, detail: string, on: boolean, key: string, unavailable: boolean, toggle: () => void): HTMLButtonElement {
  const row = el('button', unavailable ? 'run-option unavailable' : 'run-option');
  row.type = 'button';
  row.dataset.nav = '';
  row.dataset.key = key;
  row.setAttribute('role', 'switch');
  row.setAttribute('aria-checked', String(on));
  const words = el('span', 'run-option-text');
  words.append(el('span', 'run-option-label', label), el('span', 'run-option-detail', detail));
  row.append(words, el('span', 'switch'));
  row.addEventListener('click', toggle);
  return row;
}

/**
 * The hero's creatures on this level and their orders, as tome2's pet
 * command gives them (none take time): how far they stray, whether they
 * open doors and pick things up, and what too many pets cost in mana;
 * each creature opens its card (call it off, dismiss it). Orders that
 * cannot be given now are dimmed and say why.
 */
function companionsContent(api: GameApi): SheetContent | null {
  const data = api.engine.companions();
  if (!data) return null;
  const creatures = companionOrder(data.list);
  const body = el('div', 'companions');
  const content: SheetContent = {
    title: 'Companions',
    subtitle: companionsLine(creatures),
    body,
    className: 'sheet-companions',
    rebuild: () => companionsContent(api),
  };
  const update = () => {
    const next = companionsContent(api);
    if (next) api.sheets.update(next, content);
  };
  const why = orderUnavailable(api);
  const order = (o: Parameters<GameApi['engine']['orderCompanions']>[0]) => {
    if (why || !api.engine.orderCompanions(o)) api.refuse(why ?? NOT_NOW);
    update();
  };

  if (api.snapshot()?.wild) {
    body.append(el('p', 'empty', 'No orders on the world map: your companions rejoin you when you leave it.'));
    return content;
  }
  if (!creatures.length) {
    body.append(
      el('p', 'empty', 'No one fights at your side.'),
      el('p', 'muted', 'Creatures you charm or tame become your pets, and some may join you as companions. They are listed here, with the orders you give them.'),
    );
    return content;
  }

  const leash = segmented<string>('How far they stray', LEASHES.map(([n, label]) => [String(n), label]), String(data.follow), (value) =>
    order({ follow: Number(value) as Leash }),
  );
  if (why) for (const segment of leash.querySelectorAll('.segment')) segment.classList.add('unavailable');
  body.append(
    section(
      'Orders',
      leash,
      switchRow('Open doors', 'They may open doors to follow you or reach a foe.', !!data.doors, 'doors', !!why, () => order({ doors: !data.doors })),
      switchRow('Pick things up', 'They may carry what they find. Turning this off makes them drop it.', !!data.pickup, 'pickup', !!why, () => order({ pickup: !data.pickup })),
    ),
  );
  if (data.upkeep) body.append(el('p', 'companions-upkeep', `So many pets slow the return of your mana by ${data.upkeep}%.`));
  const rows = el('div', 'menu-list');
  rows.append(...creatures.map((c) => companionRow(api, c, (picked) => openMonster(api, companionMonster(picked), update))));
  body.append(section('With you', rows), el('p', 'muted', 'Companions follow you from level to level; pets and allies stay behind.'));
  return content;
}

/** Companions: the hero's creatures and their orders (Menu → Knowledge, More's Companions, tome2's `P` typed). */
export function openCompanions(api: GameApi): void {
  const content = companionsContent(api);
  if (content) api.sheets.open(content);
}
