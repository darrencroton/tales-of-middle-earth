import type { MapPoint, MapRenderer } from '../render/map.ts';
import { isHostile } from '../render/snapshot.ts';
import { titleName, type GameApi } from './api.ts';
import { el, glyph } from './dom.ts';
import { describeCell, monsterSummary, openFloorObject, openMonster, type CellDescription } from './info.ts';
import { ListNav } from './listnav.ts';
import { defaultItem } from './popup.ts';

interface LookCardDeps {
  api: GameApi;
  /** The card's element, at the foot of the map. */
  element: HTMLElement;
  map: MapRenderer;
  /** Sets off for a place looked at (Go there, Attack). */
  go(point: MapPoint): void;
  redraw(): void;
  requestFrame(): void;
}

/* How the look card says where a cell's contents are known from. */
const LOOK_NOTES: Readonly<Record<CellDescription['note'], string>> = { here: 'Where you stand', view: 'In view', remembered: 'Remembered', unknown: '' };

/** What is at a map cell, as a card at the foot of the map: its terrain, then each creature and item there (a tap opens its card), and Go there. */
export class LookCard {
  private readonly deps: LookCardDeps;
  /** The card's highlight: its rows and buttons, moved by arrows and swipes. */
  private readonly nav: ListNav;

  constructor(deps: LookCardDeps) {
    this.deps = deps;
    this.nav = new ListNav(deps.element);
  }

  get hidden(): boolean {
    return !!this.deps.element.hidden;
  }

  hide(): void {
    this.deps.element.hidden = true;
    this.deps.map.setLookCell(null);
    this.deps.requestFrame();
  }

  /** Arrows and swipes move the card's highlight, Enter chooses; true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    return this.nav.handleKey(e);
  }

  show(point: MapPoint): void {
    const { api, map } = this.deps;
    const description = describeCell(api, point);
    if (!description) return;
    map.setLookCell(point);
    const head = el('div', 'look-head');
    head.append(el('p', 'look-title', description.title));
    const note = LOOK_NOTES[description.note];
    if (note) head.append(el('span', 'look-note', note));
    const rows = el('div', 'look-rows');
    const row = (ch: number, attr: number, name: string, aside: string, open: () => void) => {
      const button = el('button', 'look-row');
      button.type = 'button';
      button.dataset.nav = '';
      button.append(glyph(ch, api.palette()[attr] ?? '#fff'), el('span', 'look-name', name));
      if (aside) button.append(el('span', 'look-aside', aside));
      button.addEventListener('click', open);
      rows.append(button);
    };
    for (const m of description.monsters) row(m.ch, m.attr, titleName(m.name), monsterSummary(m), () => openMonster(api, m));
    for (const o of description.objects) row(o.ch, o.attr, o.name, '', () => openFloorObject(api, o));
    if (description.blurred) rows.append(el('p', 'look-text', 'You cannot make out what is there.'));
    else if (!description.known && !rows.childElementCount) rows.append(el('p', 'look-text', 'You have not explored there.'));
    const buttons = el('div', 'look-buttons');
    const add = (label: string, run: () => void, unavailable: string | null = null) => {
      const button = el('button', unavailable ? 'look-button unavailable' : 'look-button', label);
      button.type = 'button';
      button.dataset.nav = '';
      if (unavailable) button.setAttribute('aria-description', unavailable);
      button.addEventListener('click', () => (unavailable ? api.refuse(unavailable) : run()));
      buttons.append(button);
    };
    const monster = description.monsters[0];
    if (!description.player && description.known && api.snapshot()?.atCommand) {
      add(monster && isHostile(monster) ? 'Attack' : 'Go there', () => this.deps.go(point), api.travelRefusal());
    }
    add('✕', () => this.hide());
    this.deps.element.replaceChildren(head, ...(rows.childElementCount ? [rows] : []), buttons);
    this.deps.element.hidden = false;
    this.nav.setActive(defaultItem(rows, buttons), false);
    this.deps.redraw();
  }
}
