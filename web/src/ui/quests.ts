import { loggedQuestText, questGroups, questLine } from '../play/quests.ts';
import type { LoggedQuest, QuestLog } from '../render/snapshot.ts';
import { el, iconText, section } from './dom.ts';
import { questParagraphs } from './info.ts';
import type { Sheets } from './sheet.ts';

/** The hero's quests: those under way, then those completed and those failed; each row opens the quest's card. */
export function openQuestLog(sheets: Sheets, log: QuestLog): void {
  const groups = questGroups(log);
  const body = el('div', 'quest-log');
  const group = (title: string, quests: readonly LoggedQuest[]) => {
    if (!quests.length) return;
    const list = el('div', 'menu-list');
    for (const quest of quests) list.append(questRow(sheets, quest));
    body.append(section(title, list));
  };
  group('Under way', groups.active);
  group('Completed', groups.done);
  group('Failed', groups.failed);
  const counts = [`${groups.active.length} under way`, `${groups.done.length} completed`];
  if (groups.failed.length) counts.push(`${groups.failed.length} failed`);
  sheets.open({ title: 'Quests', subtitle: counts.join(' · '), body, className: 'sheet-quest-log' });
}

function questRow(sheets: Sheets, quest: LoggedQuest): HTMLButtonElement {
  const row = el('button', `row-button quest-row ${quest.state}`);
  row.type = 'button';
  row.dataset.nav = '';
  row.dataset.key = `${quest.id}:${quest.depth ?? 0}`;
  const text = el('span', 'row-text');
  text.append(el('span', 'row-label', quest.title));
  const line = questLine(quest);
  if (line) text.append(el('span', `quest-line${quest.unclaimed ? ' reward' : ''}`, line));
  row.append(el('span', 'row-icon', iconText('⚑')), text);
  row.addEventListener('click', () => openLoggedQuest(sheets, quest));
  return row;
}

/** One quest of the log, as a card: how it stands, and what it asked or what the hero did. */
function openLoggedQuest(sheets: Sheets, quest: LoggedQuest): void {
  const body = el('div', 'description');
  const done = loggedQuestText(quest);
  for (const text of done.length ? done : questParagraphs(quest)) body.append(el('p', undefined, text));
  const standing =
    quest.state === 'failed'
      ? 'Failed'
      : quest.state === 'done'
        ? quest.unclaimed ? 'Completed · reward waiting' : 'Completed'
        : quest.level ? `Under way · danger level ${quest.level}` : 'Under way';
  sheets.open({
    title: quest.title,
    subtitle: standing,
    badge: el('span', 'glyph quest', iconText('⚑')),
    body,
    kind: 'card',
    className: 'sheet-quest',
  });
}
