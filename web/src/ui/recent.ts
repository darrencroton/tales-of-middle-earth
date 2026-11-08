import { recentItem, recentKey, recentLabel, recentMagicItem, recentSource, type RecentAction } from '../play/recent.ts';
import type { InventoryState, MagicItem, SpellState } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { el, section } from './dom.ts';

type Carried = Pick<InventoryState, 'pack' | 'equip'>;

/** Whether an item used as magic is ready: worn only, its charges, charging; empty when that is not known. */
export function itemState(item: MagicItem): string {
  if (item.wear) return 'Not worn';
  if (item.charges !== undefined) return item.charges ? `${item.charges} charge${item.charges === 1 ? '' : 's'}` : 'No charges';
  if (item.charging) return item.command === 'A' ? 'Recharging' : 'Charging';
  return item.fail === undefined ? '' : 'Ready';
}

/** A recent entry's second line: a spell's mana and failure, where a power comes from, an item's readiness (else its use) and how many are carried. */
function recentHint(entry: RecentAction, spells: SpellState | null, carried: Carried): string {
  if (entry.kind === 'spell') {
    const spell = spells?.books.flatMap((b) => b.spells).find((s) => s.name === entry.name);
    return spell ? `${spell.mana} mana · ${spell.fail}%` : 'Spell';
  }
  if (entry.kind === 'path') return recentSource(entry);
  const magic = recentMagicItem(entry, spells, carried);
  const state = magic ? itemState(magic) : '';
  const count = recentItem(entry, carried)?.item.number ?? 0;
  return [state && state !== 'Ready' ? state : entry.verb, count > 1 ? `×${count}` : ''].filter(Boolean).join(' · ');
}

/**
 * Recent, as every panel shows it: `entries` (newest first) as a grid of
 * buttons, one tap to do again, dimmed when it cannot be done now (`run`
 * says why). Null when there is nothing to show.
 */
export function recentSection(
  api: GameApi,
  entries: readonly RecentAction[],
  spells: SpellState | null,
  carried: Carried,
  run: (entry: RecentAction) => void,
): HTMLElement | null {
  if (!entries.length) return null;
  const grid = el('div', 'recent-grid');
  for (const entry of entries) {
    const why = api.castRefusal(entry);
    const button = el('button', why ? 'action-button recent-button unavailable' : 'action-button recent-button');
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = recentKey(entry);
    button.append(el('span', 'row-label', recentLabel(entry)), el('span', 'row-hint', recentHint(entry, spells, carried)));
    if (why) button.setAttribute('aria-description', why);
    button.addEventListener('click', () => run(entry));
    grid.append(button);
  }
  const node = section('Recent', grid);
  node.classList.add('recent');
  return node;
}
