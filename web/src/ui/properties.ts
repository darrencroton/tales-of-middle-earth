import { heroEffects, type Effect } from '../play/effects.ts';
import { propertyGroups, sourceEffect, sourceName, type PropertyPage, type PropertyRow, type SourceShare } from '../play/properties.ts';
import type { PropertyCensus } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { el, navButton, section } from './dom.ts';
import { openEffect } from './effects.ts';
import { openHeroGod } from './gods.ts';
import { carriedItem, openItemDetails } from './inventory.ts';

/** What a source adds, as its row and card say it: the amount or how it counts, its turns left, whether it is undone. */
function shareHint(share: SourceShare): string {
  return [share.detail, share.turns ? `${share.turns} turn${share.turns === 1 ? '' : 's'} left` : '', share.cancelled ? 'cancelled' : ''].filter(Boolean).join(' · ');
}

/** The sources on a row, in a line: an amount beside its source, an immunity or a weakness after it; what counts plainly by name alone. */
function sourcesLine(row: PropertyRow, effects: readonly Effect[]): string {
  return row.shares
    .map((share) => {
      const name = sourceName(share.source, effects);
      const amount = /^[+−]/.test(share.detail) ? ` ${share.detail}` : '';
      const notes = [amount || share.detail === 'Resist' ? '' : share.detail.toLowerCase(), share.cancelled ? 'cancelled' : ''].filter(Boolean).join(', ');
      return `${name}${amount}${notes ? ` (${notes})` : ''}`;
    })
    .join(' · ');
}

/** What tapping a source opens: its item's card, its effect's or its god's; nothing for a trait. */
function sourceOpener(api: GameApi, share: SourceShare, effects: readonly Effect[]): (() => void) | null {
  const source = share.source;
  if (source?.kind === 'item' && source.i !== undefined) {
    const item = carriedItem(api, source.i);
    return item ? () => openItemDetails(api, item, 'equip') : null;
  }
  if (source?.kind === 'god') return () => openHeroGod(api);
  const effect = sourceEffect(source, effects);
  return effect ? () => openEffect(api, effect) : null;
}

/** A property's card: what it does in the game, the hero's state and every source, each opening its own card where it has one. */
function openProperty(api: GameApi, row: PropertyRow, effects: readonly Effect[]): void {
  const body = el('div', 'description property-card');
  body.append(el('p', undefined, row.does));
  if (row.note) body.append(el('p', 'muted', row.note));
  if (row.shares.length) {
    const list = el('div', 'property-sources');
    for (const share of row.shares) {
      const name = sourceName(share.source, effects);
      const hint = shareHint(share);
      const open = sourceOpener(api, share, effects);
      if (open) {
        list.append(navButton(name, { hint, onClick: open }));
      } else {
        const item = el('div', 'property-source');
        item.append(el('span', 'row-label', name));
        if (hint) item.append(el('span', 'row-hint', hint));
        list.append(item);
      }
    }
    body.append(section('From', list));
  } else {
    body.append(el('p', 'muted', 'Nothing gives you this now.'));
  }
  api.sheets.open({
    title: row.label,
    subtitle: row.temporary ? `${row.state} · Temporary` : row.state,
    body,
    kind: 'card',
    className: `sheet-property ${row.tone}`,
  });
}

/** One property as a row: its name and state, and below, what gives it; dimmed when the hero lacks it. */
function propertyRow(api: GameApi, row: PropertyRow, effects: readonly Effect[]): HTMLButtonElement {
  const button = el('button', `property-row ${row.tone}${row.temporary ? ' temporary' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  button.dataset.key = `property-${row.id}`;
  const main = el('span', 'property-main');
  main.append(el('span', 'property-label', row.label));
  if (row.temporary) main.append(el('span', 'property-temp', 'temporary'));
  main.append(el('span', 'property-state', row.state));
  button.append(main);
  const line = sourcesLine(row, effects);
  if (line) button.append(el('span', 'property-from', line));
  button.addEventListener('click', () => openProperty(api, row, effects));
  return button;
}

/** A page of the hero's properties (the full sheet's Bonuses, Defences, Traits or Senses), grouped, every property shown whether had or not. */
export function propertyElements(api: GameApi, census: PropertyCensus, page: PropertyPage): HTMLElement[] {
  const player = api.state()?.player;
  const effects = player ? heroEffects(player) : [];
  return propertyGroups(census, page).map((group) => {
    const list = el('div', 'property-list');
    for (const row of group.rows) list.append(propertyRow(api, row, effects));
    return section(group.title, list);
  });
}
