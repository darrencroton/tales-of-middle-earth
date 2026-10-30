import { birthDetails } from '../flow/birthinfo.ts';
import type { BirthStep } from '../flow/birth.ts';
import { findTopic, HELP, searchHelp, type HelpBlock, type HelpTopic } from '../help/topics.ts';
import type { BirthData, BirthEntry } from '../render/snapshot.ts';
import { birthCard } from './birthcard.ts';
import { el, iconText, navButton, section } from './dom.ts';
import type { Sheets } from './sheet.ts';

export interface HelpDeps {
  sheets: Sheets;
  /** Races, modifiers and classes, once the game's data is loaded. */
  birthData(): BirthData | null;
  /** Opens the original ToME manual; absent when no game is running. */
  openManual?: () => void;
}

/** Text with *bold* runs. */
function inline(text: string): Node[] {
  return text.split(/\*([^*]+)\*/).map((part, i) => (i % 2 ? el('strong', undefined, part) : document.createTextNode(part)));
}

function paragraph(className: string | undefined, text: string): HTMLElement {
  const p = el('p', className);
  p.append(...inline(text));
  return p;
}

function renderBlock(block: HelpBlock): HTMLElement {
  if (typeof block === 'string') return paragraph(undefined, block);
  if ('heading' in block) return el('h3', undefined, block.heading);
  if ('tip' in block) return paragraph('help-tip', block.tip);
  if ('terms' in block) {
    const list = el('dl', 'help-terms');
    for (const [term, text] of block.terms) {
      const dt = el('dt');
      dt.append(...inline(term));
      list.append(dt);
      if (text) {
        const dd = el('dd');
        dd.append(...inline(text));
        list.append(dd);
      }
    }
    return list;
  }
  const list = el('steps' in block ? 'ol' : 'ul');
  for (const item of 'steps' in block ? block.steps : block.list) {
    const li = el('li');
    li.append(...inline(item));
    list.append(li);
  }
  return list;
}

function topicRow(topic: HelpTopic, open: (topic: HelpTopic) => void): HTMLButtonElement {
  const row = navButton(topic.title, { icon: topic.icon, hint: topic.summary, onClick: () => open(topic) });
  row.dataset.key = topic.id;
  return row;
}

const BIRTH_SECTIONS: [string, string, BirthStep, keyof BirthData][] = [
  ['Races', 'Race', 'race', 'races'],
  ['Race modifiers', 'Race modifier', 'modifier', 'mods'],
  ['Classes', 'Class', 'class', 'classes'],
];

/** Details of a race, modifier or class, with a class's specialisations below it. */
function openBirthEntry(sheets: Sheets, kind: string, entry: BirthEntry, step: BirthStep): void {
  const details = birthDetails(entry, step);
  const body = el('div', 'help-birth');
  body.append(birthCard(details.title, details, [], details.experimental ? 'Experimental: unfinished and possibly unbalanced.' : null));
  for (const spec of entry.specs ?? []) body.append(birthCard(spec.title, birthDetails(spec, 'specialisation'), [], null));
  sheets.open({ title: kind, body, kind: 'card', className: 'sheet-help-birth' });
}

/**
 * The game's help (docs/ui-system.md): topics in groups, a search over all
 * of them, and each topic as a page of its own with related topics at its
 * foot. Opens at a topic when given one.
 */
export function openHelp(deps: HelpDeps, topicId?: string): void {
  const { sheets } = deps;
  const available = (topic: HelpTopic) => topic.special !== 'manual' || !!deps.openManual;

  const openTopic = (topic: HelpTopic) => {
    const body = el('article', 'help-topic prose');
    body.append(...topic.body.map(renderBlock));
    if (topic.special === 'races') {
      const data = deps.birthData();
      for (const [title, kind, step, key] of BIRTH_SECTIONS) {
        /* tome2's tables hold a blank first race modifier (no modifier: Classical), empty slots and placeholders. */
        const entries = ((data?.[key] ?? []) as BirthEntry[]).filter((e, i) => (e.title.trim() || i === 0) && !/^x+$/i.test(e.title.trim()));
        if (!entries.length) continue;
        const list = el('div', 'menu-list');
        for (const entry of entries) {
          list.append(navButton(entry.title.trim() || 'Classical', { onClick: () => openBirthEntry(sheets, kind, entry, step) }));
        }
        body.append(section(title, list));
      }
      if (!data?.races.length) body.append(paragraph('muted', 'The list appears once the game has finished loading.'));
    }
    const see = (topic.see ?? []).map(findTopic).filter((t): t is HelpTopic => !!t && available(t));
    if (see.length) {
      const list = el('div', 'menu-list');
      for (const t of see) list.append(topicRow(t, openTopic));
      body.append(section('See also', list));
    }
    const actions = topic.special === 'manual' && deps.openManual ? [{ label: 'Open the manual', primary: true, run: deps.openManual }] : [];
    sheets.open({
      title: topic.title,
      subtitle: topic.summary,
      badge: el('span', 'help-badge', iconText(topic.icon)),
      body,
      actions,
      className: 'sheet-help',
    });
  };

  const body = el('div', 'help');
  const search = el('input', 'help-search');
  search.type = 'search';
  search.placeholder = 'Search help';
  search.setAttribute('aria-label', 'Search help');
  search.enterKeyHint = 'search';
  const results = el('div', 'help-results');
  body.append(search, results);

  const render = () => {
    const query = search.value.trim();
    results.replaceChildren();
    if (!query) {
      for (const group of HELP) {
        const topics = group.topics.filter(available);
        if (!topics.length) continue;
        const list = el('div', 'menu-list');
        for (const topic of topics) list.append(topicRow(topic, openTopic));
        results.append(section(group.title, list));
      }
      return;
    }
    const found = searchHelp(query).filter(available);
    if (!found.length) {
      results.append(paragraph('muted help-none', `Nothing found for “${query}”. Try another word, or browse the topics.`));
      return;
    }
    const list = el('div', 'menu-list');
    for (const topic of found) list.append(topicRow(topic, openTopic));
    results.append(section(`${found.length} ${found.length === 1 ? 'topic' : 'topics'}`, list));
  };
  search.addEventListener('input', render);
  const onKey = (e: KeyboardEvent): boolean => {
    /* ArrowUp from the first row goes back to the field. */
    const first = results.querySelector<HTMLElement>('[data-nav]');
    if (e.key !== 'ArrowUp' || !first?.classList.contains('is-active')) return false;
    first.classList.remove('is-active');
    search.focus();
    return true;
  };
  search.addEventListener('keydown', (e) => {
    const first = results.querySelector<HTMLElement>('[data-nav]');
    if (e.key === 'Enter' && search.value.trim() && first) {
      e.preventDefault();
      first.click();
    } else if (e.key === 'ArrowDown' && first) {
      /* The list takes over from the field: the key is handed to the sheet's navigation. */
      e.preventDefault();
      const panel = search.closest<HTMLElement>('.sheet');
      search.blur();
      panel?.focus({ preventScroll: true });
      panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
  });
  render();

  sheets.open({ title: 'Help', subtitle: 'How to play, and where to find things', body, className: 'sheet-help', onKey });
  const topic = topicId ? findTopic(topicId) : null;
  if (topic && available(topic)) openTopic(topic);
}
