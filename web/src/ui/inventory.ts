import { SLOT_NAMES, itemActions, itemMacro, type ItemPlace } from '../play/items.ts';
import { itemRecent, recentItem, recentItemAction, recentKey } from '../play/recent.ts';
import type { EquipSlot, InventoryState, ItemState } from '../render/snapshot.ts';
import { capitalise, descriptionParagraphs, pounds, titleName, type GameApi } from './api.ts';
import { el, glyph, section } from './dom.ts';
import type { SheetAction, SheetContent, SheetTab } from './sheet.ts';


/* Slot for a carried symbiote, shown only when something is in it. */
const CARRIED = 49;

export type InventoryTab = 'pack' | 'equip' | 'floor';

function itemRow(api: GameApi, item: ItemState, place: ItemPlace, slot?: string): HTMLButtonElement {
  const button = el('button', 'item-row');
  button.type = 'button';
  button.dataset.nav = '';
  if (slot) button.append(el('span', 'item-slot', slot));
  button.append(glyph(item.ch, api.palette()[item.attr] ?? '#fff'));
  const name = el('span', 'item-name', item.name);
  if (item.ins) name.append(el('span', 'item-ins', ` {${item.ins}}`));
  button.append(name, el('span', 'item-weight', pounds(item.weight * item.number)));
  button.addEventListener('click', () => openItem(api, item, place));
  return button;
}

function slotName(slot: EquipSlot): string {
  return SLOT_NAMES[slot.part] ?? 'Slot';
}

function tabs(api: GameApi, inventory: InventoryState, current: InventoryTab): SheetTab[] {
  const entries: [InventoryTab, string, string][] = [
    ['pack', `Pack · ${inventory.pack.length}`, '≡'],
    ['equip', 'Equipment', '['],
  ];
  if (inventory.floor.length) entries.push(['floor', `Floor · ${inventory.floor.length}`, '⇣']);
  return entries.map(([tab, label, icon]) => ({ id: tab, label, icon, active: tab === current, run: () => openInventory(api, tab, true) }));
}

/** Pack, equipment and floor items as a native list; tap an item for its actions. */
export function openInventory(api: GameApi, tab: InventoryTab = 'pack', replace = false): void {
  const inventory = api.engine.inventory();
  if (!inventory) return;
  const current = tab === 'floor' && inventory.floor.length === 0 ? 'pack' : tab;
  const body = el('div', 'inventory');

  const capacity = inventory.limit / 2;
  const burden = el('div', 'burden');
  const fill = el('div', 'burden-fill');
  fill.style.width = `${Math.min(100, (inventory.weight / Math.max(1, capacity)) * 100).toFixed(1)}%`;
  if (inventory.weight > capacity) burden.classList.add('heavy');
  burden.append(
    el('span', undefined, `Carrying ${pounds(inventory.weight)} of ${pounds(capacity)}`),
    el('span', 'burden-bar'),
  );
  burden.lastElementChild!.append(fill);
  body.append(burden);

  if (current === 'pack') {
    const quick = quickUse(api, inventory.pack);
    if (quick) body.append(quick);
  }

  const list = el('div', 'item-list');
  if (current === 'pack') {
    for (const item of inventory.pack) list.append(itemRow(api, item, 'pack'));
    if (!inventory.pack.length) list.append(el('p', 'empty', 'Your pack is empty.'));
  } else if (current === 'equip') {
    for (const slot of inventory.equip) {
      if ((slot.empty || !slot.name) && slot.part === CARRIED) continue;
      if (slot.empty || !slot.name) {
        const row = el('div', 'item-row empty-slot');
        row.append(el('span', 'item-slot', slotName(slot)), el('span', 'item-name', 'nothing'));
        list.append(row);
      } else {
        list.append(itemRow(api, slot as ItemState, 'equip', slotName(slot)));
      }
    }
  } else {
    for (const item of inventory.floor) list.append(itemRow(api, item, 'floor'));
  }
  body.append(list);

  const content: SheetContent = {
    title: current === 'equip' ? 'Equipment' : current === 'floor' ? 'On the floor' : 'Inventory',
    body,
    tabs: tabs(api, inventory, current),
    className: 'sheet-inventory',
    initial: list.querySelector<HTMLElement>('[data-nav]'),
  };
  if (replace) api.sheets.replace(content);
  else api.sheets.open(content);
}

/* Item actions worth offering again from the pack. */
const QUICK_USES = new Set(['quaff', 'read', 'eat', 'aim', 'use', 'zap', 'throw']);

/** Recently used items still in the pack, one tap to use again. */
function quickUse(api: GameApi, pack: readonly ItemState[]): HTMLElement | null {
  const grid = el('div', 'action-grid recent-grid');
  const alwaysPickup = !!api.state()?.player?.alwaysPickup;
  for (const entry of api.recent()) {
    if (entry.kind !== 'item') continue;
    const item = recentItem(entry, pack);
    const action = item ? recentItemAction(entry, item) : null;
    if (!item || !action) continue;
    const button = el('button', 'action-button recent-button');
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = recentKey(entry);
    button.append(el('span', 'row-label', `${entry.verb} · ${entry.name}`));
    if (item.number > 1) button.append(el('span', 'row-hint', `×${item.number}`));
    button.addEventListener('click', () => {
      api.remember(itemRecent(action.command, action.label, item));
      api.runMacro(itemMacro(action, item, 'pack', '', alwaysPickup));
    });
    grid.append(button);
  }
  return grid.childElementCount ? section('Recently used', grid) : null;
}

function placeLabel(item: ItemState, place: ItemPlace, slot?: EquipSlot): string {
  const weight = pounds(item.weight * item.number);
  if (place === 'equip') return `${slot ? slotName(slot) : 'Equipped'} · ${weight}`;
  if (place === 'floor') return `On the floor · ${weight}`;
  return `In your pack · ${weight}`;
}

/** One item: what is known about it and what you can do with it. */
export function openItem(api: GameApi, item: ItemState, place: ItemPlace): void {
  const inventory = api.engine.inventory();
  const slot = place === 'equip' ? inventory?.equip.find((s) => s.i === item.i) : undefined;
  const body = el('div', 'item-detail');

  const alwaysPickup = !!api.state()?.player?.alwaysPickup;
  const actions: SheetAction[] = itemActions(item, place).map((action) => ({
    id: action.id,
    label: action.label,
    primary: action.primary,
    danger: action.danger,
    run: () => {
      if (action.needsText) {
        api.askText('Inscribe', `Inscription for ${item.name}`, item.ins).then((text) => {
          if (text !== null) api.runMacro(itemMacro(action, item, place, text, alwaysPickup));
        });
        return;
      }
      if (action.quantity === 'ask') {
        api
          .askQuantity({ title: `${action.label} how many?`, label: capitalise(item.name), max: item.number, verb: action.label, danger: action.danger })
          .then((count) => {
            if (count !== null) api.runMacro(itemMacro({ ...action, quantity: count }, item, place, '', alwaysPickup));
          });
        return;
      }
      if (place === 'pack' && QUICK_USES.has(action.id)) api.remember(itemRecent(action.command, action.label, item));
      api.runMacro(itemMacro(action, item, place, '', alwaysPickup), action.reading);
    },
  }));

  const description = el('div', 'description');
  const paragraphs = descriptionParagraphs(api.engine.objectDescription(item.i));
  if (paragraphs.length === 0) paragraphs.push('You know nothing more about this item yet.');
  for (const p of paragraphs) description.append(el('p', undefined, p));
  if (item.ins) description.append(el('p', 'muted', `Inscribed {${item.ins}}`));
  body.append(description);

  api.sheets.open({
    title: titleName(item.name),
    subtitle: placeLabel(item, place, slot),
    badge: glyph(item.ch, api.palette()[item.attr] ?? '#fff'),
    body,
    actions,
    kind: 'card',
    className: 'sheet-item',
  });
}
