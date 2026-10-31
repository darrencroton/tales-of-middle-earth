import { questChoices, questsText, RUN_OPTION_TEXT, type RunOptions } from '../flow/runoptions.ts';
import { el } from './dom.ts';
import { segmented } from './menus.ts';

/** How the rules of a run are changed while a character is created; without it they are only shown. */
export interface RunChanges {
  quests(count: number): void;
  option(index: number, on: boolean): void;
}

/**
 * The rules of a run: its random quests and tome2's birth options, as the
 * last creation screen sets them. Read-only once the adventure has begun
 * (no `change`): the choice made stands out and the others are faded.
 */
export function runElements(run: RunOptions, quests: number, change?: RunChanges): HTMLElement[] {
  const unusual = run.options.some((o) => o.name === 'unusualRooms' && o.on);
  const questBox = el('section', 'run-quests');
  questBox.append(el('h4', undefined, 'Random quests'));
  if (unusual) {
    questBox.append(el('p', 'muted', RUN_OPTION_TEXT.unusualRooms.detail));
  } else {
    const counts = questChoices(run.maxQuests);
    if (!counts.includes(quests)) counts.push(quests);
    counts.sort((a, b) => a - b);
    const choices = counts.map((n) => [String(n), n === 0 ? 'None' : String(n)] as [string, string]);
    const group = segmented('Random quests', choices, String(quests), (value) => change?.quests(Number(value)));
    if (!change) for (const button of group.querySelectorAll('button')) button.disabled = true;
    questBox.append(group, el('p', 'muted', questsText(quests)));
  }
  const rows: HTMLElement[] = [questBox];
  run.options.forEach((option, index) => {
    const text = RUN_OPTION_TEXT[option.name];
    if (!text) return;
    const row = el('button', 'run-option');
    row.type = 'button';
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', String(!!option.on));
    const words = el('span', 'run-option-text');
    words.append(el('span', 'run-option-label', text.label), el('span', 'run-option-detail', text.detail));
    row.append(words, el('span', 'switch'));
    if (change) {
      row.dataset.nav = '';
      row.addEventListener('click', () => change.option(index, !option.on));
    } else {
      row.disabled = true;
    }
    rows.push(row);
  });
  return rows;
}
