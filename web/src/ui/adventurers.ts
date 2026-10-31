import type { SaveInfo } from '../title.ts';
import { el, iconText } from './dom.ts';
import { confirmSheet } from './menus.ts';
import type { Sheets } from './sheet.ts';

/** What is known of a saved hero beyond their name; any of it may be missing (a save from before it was kept). */
export interface AdventurerDetails {
  /** The hero's own name (the savefile's may differ: "Old_Tom"). */
  name: string;
  /** "Level 12 High-Elf Sorcerer", or tome2's own "Ent Warrior". */
  line: string;
  place?: string;
  /** When last played (ISO). */
  saved?: string;
  kills?: number;
  deepestFeet?: number;
}

export interface AdventurerHandlers {
  details(save: SaveInfo): AdventurerDetails;
  play(save: SaveInfo): void;
  /** Deletes the hero's saved game and records. */
  remove(save: SaveInfo): void;
}

/** One line for the title screen and lists: who they are and where. */
export function adventurerSummary(details: AdventurerDetails): string {
  return [details.line, details.place].filter(Boolean).join(' · ');
}

function when(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Every saved hero, the one played last first: a row each, opening the hero's card. */
export function openAdventurers(sheets: Sheets, saves: readonly SaveInfo[], handlers: AdventurerHandlers): void {
  const list = el('div', 'adventurer-list');
  for (const save of saves) {
    const details = handlers.details(save);
    const row = el('button', 'row-button adventurer-row');
    row.type = 'button';
    row.dataset.nav = '';
    row.dataset.key = save.name;
    const text = el('span', 'adventurer-text');
    text.append(el('span', 'row-label', details.name), el('span', 'adventurer-line', adventurerSummary(details)));
    row.append(el('span', 'row-icon', iconText('@')), text);
    row.addEventListener('click', () => openAdventurer(sheets, save, handlers));
    list.append(row);
  }
  sheets.open({ title: 'Roster', subtitle: 'Your saved heroes', body: list, className: 'sheet-adventurers' });
}

/** A saved hero: who and where they are, with Play, and Delete after a warning. */
function openAdventurer(sheets: Sheets, save: SaveInfo, handlers: AdventurerHandlers): void {
  const details = handlers.details(save);
  const facts = el('dl', 'hero-facts');
  const fact = (label: string, value: string | null | undefined) => {
    if (value) facts.append(el('dt', undefined, label), el('dd', undefined, value));
  };
  fact('Where', details.place);
  fact('Last played', when(details.saved));
  fact('Foes slain', details.kills ? String(details.kills) : null);
  fact('Deepest', details.deepestFeet ? `${details.deepestFeet} ft` : null);
  const body = el('div', 'adventurer-detail');
  if (facts.childElementCount) body.append(facts);
  else body.append(el('p', 'muted', 'Play to see where this adventure stands.'));
  const name = details.name;
  sheets.open({
    title: name,
    subtitle: details.line,
    body,
    kind: 'card',
    className: 'sheet-adventurer',
    actions: [
      {
        id: 'delete',
        label: 'Delete',
        danger: true,
        run: () =>
          confirmSheet(
            sheets,
            `Delete ${name}?`,
            `${name}'s adventure is gone for good: the saved game, the map they remember and their tale. Your other heroes, the Hall of Fame and the deeds you have earned stay.`,
            'Delete',
            () => {
              sheets.closeAll();
              handlers.remove(save);
            },
            true,
          ),
      },
      {
        id: 'play',
        label: 'Play',
        primary: true,
        run: () => {
          sheets.closeAll();
          handlers.play(save);
        },
      },
    ],
  });
}
