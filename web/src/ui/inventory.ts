import { INVEN_WIELD, SLOT_NAMES, itemActions, itemMacro, type ItemPlace } from '../play/items.ts';
import { itemRecent, packRecents } from '../play/recent.ts';
import type { EquipSlot, InventoryState, ItemState, SpellInfo } from '../render/snapshot.ts';
import { capitalise, itemGlyph, pounds, titleName, type GameApi } from './api.ts';
import { el } from './dom.ts';
import { itemCardBody } from './inspect.ts';
import { recentSection } from './recent.ts';
import type { SheetAction, SheetContent, SheetTab } from './sheet.ts';


/* Slot for a carried symbiote, shown only when something is in it. */
const CARRIED = 49;

type InventoryTab = 'pack' | 'equip' | 'floor';

function itemRow(api: GameApi, item: ItemState, place: ItemPlace, slot?: string): HTMLButtonElement {
  const button = el('button', 'item-row');
  button.type = 'button';
  button.dataset.nav = '';
  if (slot) button.append(el('span', 'item-slot', slot));
  button.append(itemGlyph(api, item));
  const name = el('span', 'item-name', item.name);
  if (item.ins) name.append(el('span', 'item-ins', ` {${item.ins}}`));
  button.append(name, el('span', 'item-weight', pounds(item.weight * item.number)));
  button.addEventListener('click', () => openItem(api, item, place));
  return button;
}

/** The carried or worn item at an inventory index. */
export function carriedItem(api: GameApi, index: number): ItemState | null {
  const inventory = api.engine.inventory();
  const found = index >= INVEN_WIELD ? inventory?.equip.find((slot) => slot.i === index && !slot.empty && !!slot.name) : inventory?.pack.find((i) => i.i === index);
  return (found as ItemState | undefined) ?? null;
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
    const recent = recentSection(api, packRecents(api.recent(), inventory), api.engine.spells(), inventory, (entry) => api.cast(entry));
    if (recent) body.append(recent);
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
  };
  if (replace) api.sheets.replace(content);
  else api.sheets.open(content);
}

/* Item actions remembered as recent and repeated from Recent, the Magic panel and the toolbar. */
const QUICK_USES = new Set(['quaff', 'read', 'eat', 'aim', 'use', 'zap', 'throw', 'activate']);

function placeLabel(item: ItemState, place: ItemPlace, slot?: EquipSlot): string {
  const weight = pounds(item.weight * item.number);
  if (place === 'equip') return `${slot ? slotName(slot) : 'Equipped'} · ${weight}`;
  if (place === 'floor') return `On the floor · ${weight}`;
  return `In your pack · ${weight}`;
}

/** What the hero knows of a carried or nearby item, with its inscription; its spells open over it (castable with `cast`). */
function itemBody(api: GameApi, item: ItemState, cast?: (spell: SpellInfo, anyway: boolean) => void): HTMLElement {
  const body = itemCardBody(api, api.engine.itemInfo(item.i), 'You know nothing more about this item yet.', cast);
  if (item.ins) body.append(el('p', 'muted', `Inscribed {${item.ins}}`));
  return body;
}

/** One item, only to look at, while tome2 asks which item to use: what is known about it, with nothing to do but close it. */
export function openItemDetails(api: GameApi, item: ItemState, place: ItemPlace): void {
  const slot = place === 'equip' ? api.engine.inventory()?.equip.find((s) => s.i === item.i) : undefined;
  api.sheets.open({
    title: titleName(item.name),
    subtitle: placeLabel(item, place, slot),
    badge: itemGlyph(api, item),
    body: itemBody(api, item),
    kind: 'card',
    className: 'sheet-item',
  });
}

/** One item: what is known about it and what you can do with it. */
export function openItem(api: GameApi, item: ItemState, place: ItemPlace): void {
  const inventory = api.engine.inventory();
  const slot = place === 'equip' ? inventory?.equip.find((s) => s.i === item.i) : undefined;
  const body = el('div', 'item-detail');

  const alwaysPickup = !!api.state()?.player?.alwaysPickup;
  const actions: SheetAction[] = itemActions(item, place).map((action) => {
    const recent = place !== 'floor' && QUICK_USES.has(action.id) ? itemRecent(action.command, action.label, item) : null;
    return {
      id: action.id,
      label: action.label,
      primary: action.primary,
      danger: action.danger,
      unavailable: recent ? api.castRefusal(recent) : api.refusal(action.command),
      run: () => {
        if (recent) {
          api.cast(recent);
          return;
        }
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
        api.runMacro(itemMacro(action, item, place, '', alwaysPickup), action.reading);
      },
    };
  });

  const cast = place === 'floor' ? undefined : (spell: SpellInfo, anyway: boolean) => api.cast({ kind: 'spell', name: spell.name }, anyway);
  body.append(itemBody(api, item, cast));

  api.sheets.open({
    title: titleName(item.name),
    subtitle: placeLabel(item, place, slot),
    badge: itemGlyph(api, item),
    body,
    actions,
    kind: 'card',
    className: 'sheet-item',
  });
}
