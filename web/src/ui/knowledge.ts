import { KEY_BACKSLASH, keyCodes, typedAnswer } from '../input/keys.ts';
import { journal, killList, noteWhen, recallList, uniqueGroups, type Knowledge, type KnownRace, type NoteKind } from '../play/knowledge.ts';
import type { Macro } from '../play/macro.ts';
import { readableColour } from '../render/colour.ts';
import { FEET_PER_LEVEL } from '../render/snapshot.ts';
import { itemGlyph, NOT_NOW, titleName, type GameApi } from './api.ts';
import { openCompanions } from './companions.ts';
import { count, el, iconText, section } from './dom.ts';
import { raceRecallLines, recallParagraphs } from './inspect.ts';
import { menuContent, type MenuItem } from './menus.ts';
import { openQuestLog } from './quests.ts';
import type { SheetContent } from './sheet.ts';

/** A line of a list that only tells something: a glyph or icon, the label, a line under it and a figure at the end. */
function infoRow(lead: HTMLElement, label: string, line?: string, hint?: string): HTMLElement {
  const row = el('div', 'info-row');
  const text = el('span', 'row-text');
  text.append(el('span', 'row-label', label));
  if (line) text.append(el('span', 'row-line', line));
  row.append(lead, text);
  if (hint) row.append(el('span', 'row-hint', hint));
  return row;
}

function icon(symbol: string): HTMLElement {
  return el('span', 'row-icon', iconText(symbol));
}

function list(rows: HTMLElement[], empty: string): HTMLElement {
  const node = el('div', 'menu-list');
  if (rows.length) node.append(...rows);
  else if (empty) node.append(el('p', 'empty', empty));
  return node;
}

/** A creature race as a row opening the hero's recall of it. */
function raceRow(api: GameApi, race: KnownRace, line: string, hint?: string): HTMLButtonElement {
  const row = el('button', 'row-button race-row');
  row.type = 'button';
  row.dataset.nav = '';
  row.dataset.key = String(race.r);
  const text = el('span', 'row-text');
  text.append(el('span', 'row-label', titleName(race.name)), el('span', 'row-line', line));
  row.append(itemGlyph(api, race), text);
  if (hint) row.append(el('span', 'row-hint', hint));
  row.addEventListener('click', () => openRace(api, race, line));
  return row;
}

/** What the hero knows of a kind of creature, as a card. */
function openRace(api: GameApi, race: KnownRace, subtitle: string): void {
  api.sheets.open({
    title: titleName(race.name),
    subtitle,
    badge: itemGlyph(api, race),
    body: recallParagraphs(raceRecallLines(api.engine, api.palette(), race.r), 'You know nothing more about this creature.'),
    kind: 'card',
    className: 'sheet-monster',
  });
}

/** A knowledge panel that is built afresh from the engine each time it is reopened. */
function panel(api: GameApi, build: (k: Knowledge) => SheetContent): SheetContent | null {
  const knowledge = api.engine.knowledge();
  if (!knowledge) return null;
  const content = build(knowledge);
  return { ...content, rebuild: () => panel(api, build) };
}

function openPanel(api: GameApi, build: (k: Knowledge) => SheetContent): void {
  const content = panel(api, build);
  if (content) api.sheets.open(content);
}

const level = (race: KnownRace) => `Level ${race.level}`;

function artifacts(api: GameApi, k: Knowledge): SheetContent {
  const rows = k.artifacts.map((a) => infoRow(itemGlyph(api, a), a.name));
  return {
    title: 'Artifacts found',
    subtitle: k.artifacts.length ? `${k.artifacts.length} found` : undefined,
    body: list(rows, 'No artifacts found yet. Each one you come across is listed here.'),
    className: 'sheet-knowledge',
  };
}

function uniques(api: GameApi, k: Knowledge): SheetContent {
  const { slain, alive } = uniqueGroups(k);
  const body = el('div', 'knowledge');
  if (slain.length) body.append(section('Slain, latest first', list(slain.map((u) => raceRow(api, u, level(u))), '')));
  body.append(section('Still at large', list(alive.map((u) => raceRow(api, u, level(u))), 'Every creature of legend has fallen.')));
  return { title: 'Unique creatures', subtitle: `${slain.length} slain of ${k.uniques.length}`, body, className: 'sheet-knowledge' };
}

function kills(api: GameApi, k: Knowledge): SheetContent {
  const { kills: rows, total } = killList(k);
  return {
    title: 'Kills',
    subtitle: total ? `${count(total)} creature${total === 1 ? '' : 's'} slain, mightiest first` : undefined,
    body: list(
      rows.map((r) => raceRow(api, r, level(r), r.unique ? 'Slain' : `× ${count(r.count)}`)),
      'You have slain no creatures yet.',
    ),
    className: 'sheet-knowledge',
  };
}

function recallDepths(_api: GameApi, k: Knowledge): SheetContent {
  const rows = recallList(k).map((d) =>
    infoRow(icon('↧'), d.dungeon, d.recall ? 'Word of Recall takes you here' : undefined, `${d.depth * FEET_PER_LEVEL} ft (L${d.depth})`),
  );
  return {
    title: 'Recall depths',
    subtitle: 'The deepest level reached in each dungeon',
    body: list(rows, 'Go down into a dungeon, and Word of Recall can take you back to the deepest level you reached there.'),
    className: 'sheet-knowledge',
  };
}

function towns(_api: GameApi, k: Knowledge): SheetContent {
  const rows = k.towns.map((t) => infoRow(icon('⌂'), t.dungeon, undefined, `${t.depth * FEET_PER_LEVEL} ft (L${t.depth})`));
  return { title: 'Dungeon towns', body: list(rows, 'You have found no towns within the dungeons yet.'), className: 'sheet-knowledge' };
}

function corruptions(api: GameApi, k: Knowledge): SheetContent {
  const rows = k.corruptions.map((c) => {
    const row = infoRow(icon('☣'), c.name, c.desc);
    const colour = api.palette()[c.attr];
    if (colour) (row.querySelector('.row-label') as HTMLElement).style.color = readableColour(colour);
    return row;
  });
  return { title: 'Corruptions', body: list(rows, 'You bear no corruptions.'), className: 'sheet-knowledge' };
}

function fates(_api: GameApi, k: Knowledge): SheetContent {
  const body = list(
    k.fates.map((f) => infoRow(icon('☯'), f)),
    k.fatesUnknown ? '' : 'You know of no fate awaiting you.',
  );
  if (k.fatesUnknown) body.append(el('p', 'muted', 'There is more to your fate that you do not yet know.'));
  return { title: 'Fates', body, className: 'sheet-knowledge' };
}

const NOTE_ICONS: Readonly<Record<NoteKind, string>> = { note: '✎', artifact: '★', level: '↑', unique: '♛', born: '✦', won: '♔' };

/** Writes a note with tome2's own command (`:`), which takes no time. */
function* noteMacro(text: string): Macro {
  const s = yield [KEY_BACKSLASH, ...keyCodes(':')];
  if (/Note:/.test(s.prompt)) yield typedAnswer(text, '');
}

function notes(api: GameApi, k: Knowledge): SheetContent {
  const rows = journal(k.notes).map((n) => infoRow(icon(NOTE_ICONS[n.kind]), n.text, noteWhen(n) || undefined));
  return {
    title: 'Notes',
    subtitle: 'Newest first',
    body: list(rows, 'No notes yet.'),
    className: 'sheet-knowledge',
    actions: [
      {
        id: 'note',
        label: 'Add a note',
        primary: true,
        unavailable: api.snapshot()?.atCommand ? null : NOT_NOW,
        run: async () => {
          const text = (await api.askText('Add a note', 'Your note'))?.trim();
          if (text) api.runMacro(noteMacro(text), true);
        },
      },
    ],
  };
}

/** What the hero knows, each list a panel of its own (Quests our quest log, Companions the companions and their orders); counts are taken afresh when it is reopened. */
export function openKnowledge(api: GameApi): void {
  const content = knowledgeMenu(api);
  if (content) api.sheets.open(content);
}

function knowledgeMenu(api: GameApi): SheetContent | null {
  const k = api.engine.knowledge();
  if (!k) return null;
  const { slain } = uniqueGroups(k);
  const { total } = killList(k);
  const companions = api.engine.companions()?.list.length ?? 0;
  const open = (build: (api: GameApi, k: Knowledge) => SheetContent) => () => openPanel(api, (fresh) => build(api, fresh));
  const questLog = () => {
    const log = api.engine.quests();
    if (log) openQuestLog(api.sheets, log);
  };
  const hint = (n: number, what: string, one = what) => (n ? `${count(n)} ${n === 1 ? one : what}` : 'None yet');
  const items: MenuItem[] = [
    { label: 'Artifacts found', icon: '★', hint: hint(k.artifacts.length, 'found'), run: open(artifacts) },
    { label: 'Unique creatures', icon: '♛', hint: `${slain.length} of ${k.uniques.length} slain`, run: open(uniques) },
    { label: 'Kills', icon: '⚔', hint: hint(total, 'slain'), run: open(kills) },
    { label: 'Recall depths', icon: '↧', hint: hint(k.recall.length, 'dungeons', 'dungeon'), run: open(recallDepths) },
    { label: 'Corruptions', icon: '☣', hint: k.corruptions.length ? String(k.corruptions.length) : 'None', run: open(corruptions) },
    { label: 'Companions', icon: '♥', hint: companions ? `${companions} with you` : 'None', run: () => openCompanions(api) },
    { label: 'Quests', icon: '⚑', run: questLog },
    { label: 'Fates', icon: '☯', hint: k.fates.length ? `${k.fates.length} known` : 'None known', run: open(fates) },
    { label: 'Dungeon towns', icon: '⌂', hint: hint(k.towns.length, 'found'), run: open(towns) },
    { label: 'Notes', icon: '✎', hint: hint(journal(k.notes).length, 'notes', 'note'), run: open(notes) },
  ];
  return { ...menuContent('Knowledge', items), rebuild: () => knowledgeMenu(api) };
}
