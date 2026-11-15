import { recallChoiceKeys, recallChoices, type Knowledge } from '../play/knowledge.ts';
import { FEET_PER_LEVEL } from '../render/snapshot.ts';
import { el, iconText } from './dom.ts';
import type { TermView } from './termview.ts';

/**
 * tome2's choice of the dungeon Word of Recall leads to (a Scroll of Reset
 * Recall, a building's teleport to a dungeon level) as a native panel: each
 * dungeon with its recall depth, the one recall leads to now highlighted; a
 * tap sends the keys that pick it in tome2's list, which then asks how deep.
 */
export function renderRecallChoice(view: TermView, knowledge: Knowledge | null, choose: (keys: string) => void): void {
  const dungeons = knowledge ? recallChoices(knowledge) : [];
  const key = dungeons.map((d) => `${d.dungeon}:${d.depth}:${d.recall}`).join('|');
  view.renderCustom(
    { layout: 'panel', title: 'Recall to which dungeon?', subtitle: 'Then choose how deep Word of Recall takes you' },
    `recall:${key}`,
    () => {
      const list = el('div', 'menu-list');
      dungeons.forEach((d, i) => {
        const row = el('button', `row-button recall-row${d.recall ? ' current' : ''}`);
        row.type = 'button';
        row.dataset.nav = '';
        row.dataset.key = d.dungeon;
        const text = el('span', 'row-text');
        text.append(el('span', 'row-label', d.dungeon));
        if (d.recall) text.append(el('span', 'row-line', 'Word of Recall takes you here'));
        row.append(el('span', 'row-icon', iconText('↧')), text, el('span', 'row-hint', `${d.depth * FEET_PER_LEVEL} ft (L${d.depth})`));
        row.addEventListener('click', () => choose(recallChoiceKeys(i, dungeons.length)));
        list.append(row);
      });
      if (!dungeons.length) list.append(el('p', 'empty', 'Go down into a dungeon first, and Word of Recall can take you back there.'));
      return [list];
    },
  );
}
