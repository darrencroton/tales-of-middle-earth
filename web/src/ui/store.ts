import { KEY_BACKSLASH as BACKSLASH, KEY_ENTER as ENTER } from '../input/keys.ts';
import { keyCodes, type Macro } from '../play/macro.ts';
import type { GameApi } from './api.ts';
import { capitalise, descriptionParagraphs } from './api.ts';
import { el, navButton } from './dom.ts';
import type { ChoiceBlock } from './termparse.ts';

export interface StoreCommand {
  key: string;
  /** What the command does to an item: buy/take, examine or steal. */
  kind: 'buy' | 'examine' | 'steal' | 'other';
  label: string;
}

export interface StoreScreen {
  /** Terminal row of "You may:", below which the commands are listed. */
  commandsRow: number;
  commands: StoreCommand[];
  hasNextPage: boolean;
  home: boolean;
  /** Shelf page shown, from 1. */
  page: number;
}

const ITEMS_PER_PAGE = 12;

/** Recognises tome2's shop (or home) screen from its command list. */
export function parseStore(screen: string, choices: readonly ChoiceBlock[]): StoreScreen | null {
  const lines = screen.split('\n');
  const commandsRow = lines.findIndex((line) => /^You may:/.test(line.trim()));
  if (commandsRow < 0 || !/(Purchase|Get) an item/.test(screen)) return null;
  const commands = choices
    .filter((c) => c.row >= commandsRow)
    .map((c): StoreCommand => {
      const label = c.label.text.replace(/\.$/, '');
      const kind = /^(Purchase|Get) an item/i.test(label)
        ? 'buy'
        : /^e?X?amine an item/i.test(label)
          ? 'examine'
          : /^Steal an item/i.test(label)
            ? 'steal'
            : 'other';
      return { key: c.key, kind, label };
    });
  const page = Number(/\(Page (\d+)\)/.exec(screen)?.[1] ?? 1);
  return { commandsRow, commands, hasNextPage: /SPACE\) Next page/.test(screen), home: /Get an item/.test(screen), page };
}

/** Leading count of a stack ("28 Strips of Venison" → 28, "a Cloak" → 1). */
export function stackSize(name: string): number {
  const m = /^(\d+) /.exec(name.trim());
  return m ? Number(m[1]) : 1;
}

/** Buys (or examines) a listed item: command, item letter, then the quantity. */
export function* storeMacro(command: string, letter: string, quantity: number): Macro {
  let s = yield [BACKSLASH, ...keyCodes(command)];
  if (!/Which item|interested in/i.test(s.prompt)) return;
  s = yield keyCodes(letter);
  if (/Quantity/i.test(s.prompt)) s = yield [...keyCodes(String(quantity)), ENTER];
  if (command !== 'x' && /\[y\/n/.test(s.prompt)) yield keyCodes('y');
}

/** Sheet for one item on a shop shelf: buy (with quantity) or examine. */
export function openStoreItem(api: GameApi, store: StoreScreen, choice: ChoiceBlock): void {
  const name = choice.label.text.trim();
  const stack = stackSize(name);
  const price = Number((choice.meta[choice.meta.length - 1]?.text ?? '').replace(/[^\d]/g, '')) || 0;
  const weight = choice.meta.length > 1 ? choice.meta[0].text.trim() : '';
  const gold = api.state()?.player?.au ?? 0;
  const affordable = store.home || price === 0 ? stack : Math.max(0, Math.min(stack, Math.floor(gold / price)));
  let quantity = Math.min(1, affordable) || 1;

  const body = el('div', 'store-item');
  const summary = el('p', 'muted');
  summary.textContent = [store.home ? '' : `${price} gold each`, weight ? `${weight} lb each` : '', stack > 1 ? `${stack} on the shelf` : '']
    .filter(Boolean)
    .join(' · ');
  body.append(summary);

  const buy = store.commands.find((c) => c.kind === 'buy');
  const examine = store.commands.find((c) => c.kind === 'examine');
  const actions = el('div', 'action-grid');
  let buyButton: HTMLButtonElement | null = null;
  const buyLabel = () => {
    const verb = store.home ? 'Take' : 'Buy';
    if (store.home) return `${verb} ${quantity}`;
    return `${verb} ${quantity} for ${quantity * price} gold`;
  };

  if (buy) {
    if (stack > 1 && affordable > 1) {
      const stepper = el('div', 'stepper');
      const minus = el('button', 'stepper-button', '−');
      const plus = el('button', 'stepper-button', '+');
      const all = el('button', 'stepper-button wide', 'Max');
      const value = el('span', 'stepper-value', String(quantity));
      for (const b of [minus, plus, all]) {
        b.type = 'button';
        b.dataset.nav = '';
      }
      const set = (n: number) => {
        quantity = Math.max(1, Math.min(affordable, n));
        value.textContent = String(quantity);
        if (buyButton) buyButton.querySelector('.row-label')!.textContent = buyLabel();
      };
      minus.addEventListener('click', () => set(quantity - 1));
      plus.addEventListener('click', () => set(quantity + 1));
      all.addEventListener('click', () => set(affordable));
      stepper.append(minus, value, plus, all);
      body.append(stepper);
    }
    buyButton = navButton(buyLabel(), {
      className: 'action-button primary',
      disabled: affordable === 0,
      onClick: () => api.runMacro(storeMacro(buy.key, choice.key, quantity)),
    });
    actions.append(buyButton);
  }
  const index = (store.page - 1) * ITEMS_PER_PAGE + choice.key.charCodeAt(0) - 'a'.charCodeAt(0);
  const paragraphs = descriptionParagraphs(api.engine.storeObjectDescription(index));
  if (examine && paragraphs.length === 0) {
    actions.append(navButton('Examine', { className: 'action-button', onClick: () => api.runMacro(storeMacro(examine.key, choice.key, 1)) }));
  }
  body.append(actions);
  if (!store.home && affordable === 0) body.append(el('p', 'muted', 'You cannot afford this.'));
  if (paragraphs.length) {
    const description = el('div', 'description');
    for (const p of paragraphs) description.append(el('p', undefined, p));
    body.append(description);
  }

  api.sheets.open({
    title: capitalise(name.replace(/^(a|an|\d+) /i, '')),
    subtitle: store.home ? 'In your home' : 'For sale',
    body,
    className: 'sheet-item',
    initial: buyButton ?? actions.querySelector<HTMLElement>('[data-nav]'),
  });
}
