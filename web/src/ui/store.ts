import { KEY_BACKSLASH as BACKSLASH, KEY_ENTER as ENTER, KEY_SPACE as SPACE } from '../input/keys.ts';
import { itemActions, itemMacro, SLOT_NAMES, type ItemAction, type ItemPlace } from '../play/items.ts';
import { keyCodes, type Macro, type MacroScreen } from '../play/macro.ts';
import { STORE_ACTION, type InventoryState, type ItemState, type StockItem, type StoreCommand, type StoreOffer, type StoreState } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { capitalise, descriptionParagraphs, pounds, titleName } from './api.ts';
import { el, glyph, section } from './dom.ts';
import type { SheetAction } from './sheet.ts';

/** The shop's two lists: what is on its shelves (or in the home), and what the hero carries to offer it. */
export type ShopTab = 'shelf' | 'offer';

/** What a shop lets the hero do, from its commands: the verbs and keys of its two lists, and its other services. */
export interface ShopModel {
  shelf: { label: string; verb: string | null; key: string | null; empty: string };
  offer: { label: string; verb: string; key: string } | null;
  /** The building's other services (a fortune told, a night's rest), sent to tome2 as they are. */
  extras: StoreCommand[];
}

const TRADE_ACTIONS: ReadonlySet<number> = new Set(Object.values(STORE_ACTION));

/** A shop is shown natively when it trades: it sells, buys, or shows a collection. */
export function trades(store: Pick<StoreState, 'museum' | 'actions'>): boolean {
  return !!store.museum || store.actions.some((a) => a.action === STORE_ACTION.buy || a.action === STORE_ACTION.sell);
}

/** The toolbar's button at a building's door. */
export function entranceLabel(store: Pick<StoreState, 'home' | 'museum' | 'actions'>): string {
  if (store.home) return 'Enter home';
  return !store.museum && trades(store) ? 'Enter shop' : 'Go inside';
}

export function shopModel(store: StoreState): ShopModel {
  const key = (action: number) => store.actions.find((a) => a.action === action)?.key ?? null;
  const buy = key(STORE_ACTION.buy);
  const sell = key(STORE_ACTION.sell);
  const extras = store.actions.filter((a) => !TRADE_ACTIONS.has(a.action));
  if (store.home) {
    return {
      shelf: { label: 'Stored', verb: buy ? 'Take' : null, key: buy, empty: 'Your home stands bare. Whatever you store here waits safely for your return.' },
      offer: sell ? { label: 'Inventory', verb: 'Store', key: sell } : null,
      extras,
    };
  }
  if (store.museum) {
    return {
      shelf: { label: 'Collection', verb: null, key: null, empty: 'The display cases stand empty, waiting for a worthy gift.' },
      offer: sell ? { label: 'Donate', verb: 'Donate', key: sell } : null,
      extras,
    };
  }
  return {
    shelf: { label: 'Buy', verb: buy ? 'Buy' : null, key: buy, empty: 'The shelves are bare. Come back later: shops restock while you are away.' },
    offer: sell ? { label: 'Sell', verb: 'Sell', key: sell } : null,
    extras,
  };
}

/* What each kind of shop buys (engine/snapshot.cc `shop_buys`, after tome2's store_will_buy). */
const SHOP_WANTS: Readonly<Record<string, string>> = {
  'General Store': 'food, lights, flasks of oil, ammunition, spikes, diggers, cloaks and empty bottles',
  Armoury: 'armour, shields, helms, gloves, boots and cloaks',
  Weaponsmith: 'weapons, bows, ammunition, diggers and mage staffs',
  Temple: 'potions, scrolls, blunt weapons, blessed weapons and holy books',
  'Alchemy shop': 'potions, scrolls and empty bottles',
  'Magic shop': 'wands, staffs, rods, rings, amulets, potions, scrolls and spellbooks',
  'Black Market': 'anything of value',
  'Book Store': 'books of every kind',
  'Pet Shop': 'eggs',
  'Hunting Supply Store': 'bows, ammunition, boomerangs and potions',
  'Construction Supply Store': 'lights and diggers',
  'Music Store': 'instruments',
};

/** Who keeps the shop, for its notes ("Lyar-el the Comely"); the shop's name when no keeper is named. */
function keeper(store: Pick<StoreState, 'owner' | 'name'>): string {
  return store.owner.replace(/\s*\(.*\)\s*$/, '').trim() || `The ${store.name}`;
}

/** Why the shop will not take something carried, in a few words. */
export function refusal(why: StoreOffer['why']): string {
  switch (why) {
    case 'kind':
      return 'Not wanted here';
    case 'worthless':
      return 'Worth nothing';
    case 'cursed':
      return 'Cursed: cannot be let go';
    case 'nothing':
      return 'Offers nothing for it';
    default:
      return '';
  }
}

/** The most of a shelf item the hero can take: all of it in the home, as many as their gold buys in a shop (tome2 asks for at most 99). */
export function affordable(store: Pick<StoreState, 'home' | 'museum' | 'gold'>, item: Pick<StockItem, 'number' | 'price'>): number {
  const most = Math.min(item.number, 99);
  if (store.home || item.price <= 0) return most;
  return Math.max(0, Math.min(most, Math.floor(store.gold / item.price)));
}

/** Items tome2 shows on one page of a shop's list. */
export const SHELF_PAGE = 12;

/** The page of the shelf tome2 shows (from 1), from its "(Page n)" marker; 1 when the stock fits on one page. */
export function shelfPage(screen: string): number {
  return Number(/\(Page (\d+)\)/.exec(screen)?.[1] ?? 1);
}

/** Answers what tome2 asks once an item is chosen: messages to read on, how many, and its yes to the price. */
function* answerTrade(first: MacroScreen, quantity: number): Macro {
  let s = first;
  for (let i = 0; i < 6; i++) {
    if (/-more-/.test(s.prompt)) s = yield [SPACE];
    else if (/Quantity/i.test(s.prompt)) s = yield [...keyCodes(String(quantity)), ENTER];
    else if (/\[y\/n/.test(s.prompt)) s = yield keyCodes('y');
    else return;
  }
}

/**
 * Takes an item off the shelf (buys it, or takes it from the home): turns
 * tome2's list to the item's page (it shows twelve at a time, and Space goes
 * to the next, round to the first), then gives the command, the item's
 * letter, how many, and yes to the price.
 */
export function* shelfMacro(key: string, item: number, quantity: number, stock: number, page: number): Macro {
  const pages = Math.max(1, Math.ceil(stock / SHELF_PAGE));
  const target = Math.floor(item / SHELF_PAGE) + 1;
  const turns = pages > 1 ? (target - page + pages) % pages : 0;
  if (turns > 0) {
    const s = yield new Array<number>(turns).fill(SPACE);
    if (shelfPage(s.screen) !== target) return;
  }
  let s = yield [BACKSLASH, ...keyCodes(key)];
  if (!/^\(Items [a-l]-[a-l]/.test(s.prompt)) return;
  s = yield keyCodes(String.fromCharCode(97 + (item % SHELF_PAGE)));
  yield* answerTrade(s, quantity);
}

/** Offers something carried to the shop: sells, stores or donates it, with how many and yes to the price. */
export function offerMacro(key: string, verb: string, item: ItemState, place: ItemPlace, quantity: number): Macro {
  return itemMacro({ id: 'offer', label: verb, command: key, quantity, confirm: true }, item, place);
}

/* Item commands tome2 takes inside a shop (store.cc's store_process_command). */
const IN_SHOP = new Set(['wear', 'takeoff', 'inscribe', 'destroy']);

export interface ShopHandlers {
  /** Runs a trade or another command in the shop, keeping the shop on screen; `done` is said once it has gone through. */
  trade(macro: Macro, done: string | null): void;
  /** Turns tome2's list to the page an item is on: the page shown now. */
  page(): number;
}

/** An item and how many, for the word after a trade ("2 × Flasks of oil"). */
function traded(name: string, quantity: number): string {
  const title = titleName(name.replace(/^\d+ /, ''));
  return quantity > 1 ? `${quantity} × ${title}` : title;
}


/** What a row of the shop's lists is found by after a trade: the item's name without how many there are. */
function rowKey(list: string, name: string): string {
  return `${list}:${name.replace(/^(\d+|an?|the) /i, '')}`;
}

/** A row of the shop's lists: glyph, name and what it costs (or weighs, at home) or why not. */
function row(api: GameApi, key: string, item: Pick<ItemState, 'ch' | 'attr' | 'name'>, aside: string, price: boolean, dim: boolean, open: () => void): HTMLButtonElement {
  const button = el('button', `item-row shop-row${dim ? ' dim' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  button.dataset.key = key;
  button.append(glyph(item.ch, api.palette()[item.attr] ?? '#fff'), el('span', 'item-name', item.name), el('span', price ? 'item-price' : 'item-weight', aside));
  button.addEventListener('click', open);
  return button;
}

/** The shelf: everything for sale (or stored, or on show), one scrolling list; tap an item for its card. */
export function shelfElements(api: GameApi, store: StoreState, model: ShopModel, handlers: ShopHandlers): HTMLElement[] {
  if (store.stock.length === 0) return [el('p', 'empty', model.shelf.empty)];
  const list = el('div', 'item-list');
  for (const item of store.stock) {
    const short = !store.home && !store.museum && affordable(store, item) === 0;
    const aside = store.home || store.museum ? pounds(item.weight * item.number) : `${item.price} gold`;
    list.append(row(api, rowKey('stock', item.name), item, aside, !store.home && !store.museum, short, () => openShelfItem(api, store, model, item, handlers)));
  }
  const elements: HTMLElement[] = [list];
  if (store.home) elements.unshift(el('p', 'shop-note muted', `Room on the shelves for ${Math.max(0, store.capacity - store.stock.length)} more.`));
  return elements;
}

/** What the hero carries, pack and equipment, each with what the shop offers for it or why it will not take it. */
export function offerElements(api: GameApi, store: StoreState, model: ShopModel, inventory: InventoryState, handlers: ShopHandlers): HTMLElement[] {
  const offer = model.offer;
  if (!offer) return [];
  const offers = new Map(store.sell.map((o) => [o.i, o]));
  const elements: HTMLElement[] = [];
  const wants = SHOP_WANTS[store.name];
  if (!store.home && !store.museum) {
    if (!store.buys) elements.push(el('p', 'shop-note', `${keeper(store)} sells, but never buys.`));
    else if (wants) elements.push(el('p', 'shop-note muted', `${keeper(store)} buys ${wants}.`));
    if (store.buys && store.noSelling) elements.push(el('p', 'shop-note muted', 'In this adventure shops pay nothing for what you bring them.'));
  }
  const listOf = (items: readonly ItemState[], place: ItemPlace) => {
    const list = el('div', 'item-list');
    for (const item of items) {
      const o = offers.get(item.i);
      const why = o?.why ?? 'kind';
      const aside = why ? refusal(why) : store.home || store.museum ? pounds(item.weight * item.number) : `${o?.price ?? 0} gold`;
      list.append(row(api, rowKey(place, item.name), item, aside, !why && !store.home && !store.museum, !!why, () => openOfferItem(api, store, model, item, place, o ?? null, handlers)));
    }
    return list;
  };
  const worn = inventory.equip.filter((slot): slot is ItemState & { part: number } => !slot.empty && !!slot.name);
  if (inventory.pack.length === 0 && worn.length === 0) {
    elements.push(el('p', 'empty', 'You carry nothing at all. Travelling light!'));
    return elements;
  }
  const usable = [...inventory.pack, ...worn].some((item) => !offers.get(item.i)?.why);
  if (!usable && store.buys) {
    elements.push(el('p', 'empty', store.home ? 'Nothing you carry can be stored.' : 'Nothing you carry catches the shopkeeper’s eye.'));
  }
  if (inventory.pack.length) elements.push(section('Pack', listOf(inventory.pack, 'pack')));
  else elements.push(section('Pack', el('p', 'empty', 'Your pack is empty.')));
  if (worn.length) elements.push(section('Equipment', listOf(worn, 'equip')));
  return elements;
}

/** A stepper choosing how many, starting at one; `onChange` gets each new number. */
function stepper(max: number, onChange: (n: number) => void): HTMLElement {
  let value = 1;
  const box = el('div', 'stepper');
  const shown = el('span', 'stepper-value', '1');
  shown.setAttribute('aria-live', 'polite');
  const button = (label: string, to: () => number, className = 'stepper-button') => {
    const b = el('button', className, label);
    b.type = 'button';
    b.dataset.nav = '';
    b.addEventListener('click', () => {
      value = Math.max(1, Math.min(max, to()));
      shown.textContent = String(value);
      onChange(value);
    });
    return b;
  };
  box.append(button('−', () => value - 1), shown, button('+', () => value + 1), button(`All ${max}`, () => max, 'stepper-button wide'));
  return box;
}

/** Updates the label of a card's confirming button in place. */
function relabel(body: HTMLElement, id: string, label: string): void {
  const node = body.closest('.sheet')?.querySelector(`[data-action="${id}"] .pop-label`);
  if (node) node.textContent = label;
}

function description(text: string, fallback: string): HTMLElement {
  const box = el('div', 'description');
  const paragraphs = descriptionParagraphs(text);
  for (const p of paragraphs.length ? paragraphs : [fallback]) box.append(el('p', undefined, p));
  return box;
}

/** One item on the shelf: what it is and costs, how many to take, and Buy (or Take); looking costs nothing. */
export function openShelfItem(api: GameApi, store: StoreState, model: ShopModel, item: StockItem, handlers: ShopHandlers): void {
  const body = el('div', 'item-detail');
  const most = affordable(store, item);
  const shop = !store.home && !store.museum;
  let quantity = 1;
  const verb = model.shelf.verb;
  const label = () => (shop ? `${verb} ${quantity} for ${quantity * item.price} gold` : `${verb} ${quantity}`);
  if (verb && most > 1) {
    body.append(
      stepper(most, (n) => {
        quantity = n;
        relabel(body, 'take', label());
      }),
    );
  }
  const short = verb && shop && most === 0 ? `You have ${store.gold} gold: not enough for one.` : null;
  if (short) body.append(el('p', 'shop-short', short));
  body.append(description(api.engine.storeObjectDescription(item.i), 'Nothing more is known about it until you own it.'));
  const subtitle = shop
    ? [`${item.price} gold each`, item.number > 1 ? `${item.number} for sale` : '', pounds(item.weight)].filter(Boolean).join(' · ')
    : [store.home ? 'In your home' : 'On show', item.number > 1 ? `${item.number} here` : '', pounds(item.weight)].filter(Boolean).join(' · ');
  const actions: SheetAction[] = [];
  const key = model.shelf.key;
  if (verb && key) {
    actions.push({
      id: 'take',
      label: label(),
      primary: true,
      unavailable: short,
      run: () => {
        const name = traded(item.name, quantity);
        const done = shop ? `Bought ${name} for ${quantity * item.price} gold.` : `Took ${name} from home.`;
        handlers.trade(shelfMacro(key, item.i, quantity, store.stock.length, handlers.page()), done);
      },
    });
  }
  api.sheets.open({
    title: titleName(item.name.replace(/^\d+ /, '')),
    subtitle,
    badge: glyph(item.ch, api.palette()[item.attr] ?? '#fff'),
    body,
    actions,
    kind: 'card',
    className: 'sheet-item',
  });
}

/** Something carried, in a shop: what it is and what the shop offers, how many to let go, Sell (Store, Donate), and what can be done with it here. */
export function openOfferItem(api: GameApi, store: StoreState, model: ShopModel, item: ItemState, place: ItemPlace, offer: StoreOffer | null, handlers: ShopHandlers): void {
  const body = el('div', 'item-detail');
  const shop = !store.home && !store.museum;
  const why = offer?.why ?? 'kind';
  const verb = model.offer?.verb ?? 'Sell';
  let quantity = 1;
  const label = () => (shop ? `${verb} ${quantity} for ${quantity * (offer?.price ?? 0)} gold` : `${verb} ${quantity}`);
  const actions: SheetAction[] = [];
  const key = model.offer?.key;
  if (!why && key) {
    if (item.number > 1) {
      body.append(
        stepper(item.number, (n) => {
          quantity = n;
          relabel(body, 'offer', label());
        }),
      );
    }
    actions.push({
      id: 'offer',
      label: label(),
      primary: true,
      run: () => {
        const name = traded(item.name, quantity);
        const done = shop
          ? `Sold ${name} for ${quantity * (offer?.price ?? 0)} gold.`
          : store.home
            ? `Stored ${name} safely at home.`
            : `Donated ${name}. The curators are delighted.`;
        handlers.trade(offerMacro(key, verb, item, place, quantity), done);
      },
    });
  } else if (why) {
    const note = why === 'kind' && !store.buys ? `${keeper(store)} sells, but never buys.` : why === 'nothing' ? `${keeper(store)} offers nothing for it.` : `${refusal(why)}.`;
    body.append(el('p', 'shop-short', note));
  }
  if (store.museum && !why) body.append(el('p', 'muted', 'A donation cannot be taken back.'));
  body.append(description(api.engine.objectDescription(item.i), 'You know nothing more about this item yet.'));
  for (const action of itemActions(item, place).filter((a) => IN_SHOP.has(a.id))) actions.push(shopItemAction(api, action, item, place, handlers));
  const where = place === 'equip' ? (SLOT_NAMES[(item as ItemState & { part?: number }).part ?? 0] ?? 'Worn') : 'In your pack';
  const price = shop && !why ? `${offer?.price ?? 0} gold each` : '';
  api.sheets.open({
    title: titleName(item.name),
    subtitle: [where, price, pounds(item.weight * item.number)].filter(Boolean).join(' · '),
    badge: glyph(item.ch, api.palette()[item.attr] ?? '#fff'),
    body,
    actions,
    kind: 'card',
    className: 'sheet-item',
  });
}

/** An item command the shop allows (wear, take off, inscribe, destroy), run as the inventory runs it. */
function shopItemAction(api: GameApi, action: ItemAction, item: ItemState, place: ItemPlace, handlers: ShopHandlers): SheetAction {
  return {
    id: action.id,
    label: action.label,
    danger: action.danger,
    run: () => {
      if (action.needsText) {
        api.askText('Inscribe', `Inscription for ${item.name}`, item.ins).then((text) => {
          if (text !== null) handlers.trade(itemMacro(action, item, place, text), null);
        });
        return;
      }
      if (action.quantity === 'ask') {
        api.askQuantity({ title: `${action.label} how many?`, label: capitalise(item.name), max: item.number, verb: action.label, danger: action.danger }).then((count) => {
          if (count !== null) handlers.trade(itemMacro({ ...action, quantity: count }, item, place), null);
        });
        return;
      }
      handlers.trade(itemMacro(action, item, place), null);
    },
  };
}

/* A building's screen rows a service draws on: below the messages, above the shop's gold (row 19) and its commands. */
const SERVICE_ROWS = { first: 1, last: 18 };
/** Rows blanked before a service, so its answer is told from the last one's; row 5 holds a shop's "(Page n)" (`shelfPage`). */
export const SERVICE_CLEAR = { first: 6, last: SERVICE_ROWS.last };

/** Lines that are tome2's key hints, or reworded for this game. */
const SERVICE_WORDING: [RegExp, string | null][] = [
  [/\b(hit|press)\b.*\b(any key|spacebar)\b|\bto continue\b/i, null],
  [/^Again\s*\(Y\/N\)\?$/i, null],
  [/^Use CTRL-Q to check the status of your quest\.?$/i, 'Your quests are listed in Menu → Knowledge.'],
];

/** True when every bracket a line opens it also closes ("1) Bilbo (Level" is cut mid-way). */
function balanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** A row divides at column c: a gap of two spaces before it, text after it, and no bracket left open on either side. */
function dividesAt(row: string, c: number): boolean {
  const right = row.slice(c).trim();
  return row[c - 1] === ' ' && row[c - 2] === ' ' && !!right && !right.startsWith(':') && balanced(row.slice(0, c)) && balanced(right);
}

/**
 * The column where a page drawn as two columns divides (compare weapons: one
 * weapon from column 2, the other from about 40), where the most rows divide
 * and at least three; null for a page of one column.
 */
function columnSplit(rows: readonly string[]): number | null {
  const width = Math.max(0, ...rows.map((row) => row.length));
  let best: number | null = null;
  let most = 2;
  for (let c = 20; c < width; c++) {
    const count = rows.filter((row) => dividesAt(row, c)).length;
    if (count > most) {
      best = c;
      most = count;
    }
  }
  return best;
}

/**
 * What a service drew on a building's screen: the rows changed since it
 * began, as blocks of adjacent rows; a page drawn as two columns gives the
 * left column's blocks (with the rows that span the page), then the right's.
 */
export function drawnBlocks(before: readonly string[], after: readonly string[]): string[][] {
  const changed: { row: number; text: string }[] = [];
  for (let r = SERVICE_ROWS.first; r <= SERVICE_ROWS.last && r < after.length; r++) {
    const text = after[r].trimEnd();
    if (text.trim() && text !== (before[r] ?? '').trimEnd()) changed.push({ row: r, text });
  }
  const split = columnSplit(changed.map((line) => line.text));
  const divides = (text: string) => split !== null && dividesAt(text, split);
  const sides = [
    (text: string) => (divides(text) ? text.slice(0, split!) : text),
    ...(split === null ? [] : [(text: string) => (divides(text) ? text.slice(split) : '')]),
  ];
  const blocks: string[][] = [];
  for (const side of sides) {
    let last = -2;
    for (const line of changed) {
      const text = side(line.text).trim().replace(/\s+/g, ' ');
      if (!text) continue;
      if (line.row !== last + 1 || !blocks.length) blocks.push([]);
      blocks[blocks.length - 1].push(text);
      last = line.row;
    }
  }
  return blocks;
}

/**
 * A service's reply as paragraphs: what tome2 said (oldest first), then each page it drew
 * (lines wrapped mid-sentence joined; of several pages, those with only
 * their heading left out; key hints left out).
 */
export function serviceReply(pages: readonly (readonly string[][])[], messages: readonly string[]): string[] {
  const reword = (line: string): string | null => {
    for (const [pattern, text] of SERVICE_WORDING) if (pattern.test(line)) return text;
    return line;
  };
  const lines = (page: readonly string[][]) => page.reduce((n, block) => n + block.length, 0);
  const paragraphs: string[] = [];
  for (const message of messages) {
    const text = reword(message.trim());
    if (text && paragraphs[paragraphs.length - 1] !== text) paragraphs.push(text);
  }
  for (const page of pages) {
    if (pages.length > 1 && lines(page) < 2) continue;
    for (const block of page) {
      let open = false;
      for (const line of block) {
        const text = reword(line);
        if (!text) continue;
        if (open && /^[a-z]/.test(text) && !/[.!?:)]$/.test(paragraphs[paragraphs.length - 1])) paragraphs[paragraphs.length - 1] += ` ${text}`;
        else paragraphs.push(text);
        open = true;
      }
    }
  }
  return paragraphs;
}
