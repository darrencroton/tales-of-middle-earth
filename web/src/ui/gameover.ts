import type { Chronicle } from '../play/chronicle.ts';
import { dayOf, type Memorial, type MemorialFoe } from '../play/memorial.ts';
import type { ScoreEntry } from '../render/snapshot.ts';
import { titleName } from './api.ts';
import { el, navButton, section } from './dom.ts';
import { deedChips, fateLine, fateText, fellWhereWhen, foeChip, gearStrip, lastWordsList, type FallenTab } from './memorial.ts';
import { rowText, type TermRow } from './termparse.ts';

export { fateText, fellWhere } from './memorial.ts';

export interface Tomb {
  name: string;
  title: string;
  cls: string;
  level: string;
  exp: string;
  gold: string;
  depth: number;
  cause: string;
  date: string;
}

/** Reads tome2's end-of-game summary (rows of the whole terminal), or null. */
export function parseTomb(rows: readonly TermRow[]): Tomb | null {
  if (!rows.some((r) => /You may now dump a character record/.test(rowText(r)))) return null;
  const at = (y: number) => rowText(rows[y]).slice(11, 42).trim();
  const after = (y: number, label: RegExp) => at(y).replace(label, '').trim();
  return {
    name: at(6),
    title: at(8),
    cls: at(10),
    level: after(11, /^Level:/),
    exp: after(12, /^Exp:/),
    gold: after(13, /^AU:/),
    depth: Number(/(\d+)\s*$/.exec(at(14))?.[1] ?? 0),
    cause: after(15, /^by/).replace(/\.$/, ''),
    date: at(17),
  };
}

/** "28 October 2026", or the text as given when it is not a date. */
export function longDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export interface TombExtras {
  memorial: Memorial | null;
  tale: Chronicle | null;
  /** Advice for the next hero. */
  tip: string;
  /** Opens the fallen hero's sheet on a tab. */
  onHero(tab: FallenTab): void;
  onFoe(foe: MemorialFoe): void;
}

/** Elements for the native end-of-game view: the epitaph, the last fight, the tale and what was carried. */
export function tombElements(tomb: Tomb, extras: TombExtras): HTMLElement[] {
  const m = extras.memorial;
  const hero = el('div', 'gameover-hero');
  hero.append(
    el('p', 'gameover-name', tomb.name),
    el('p', 'gameover-title', [m ? `Level ${m.level} ${m.race} ${m.cls}`.trim() : tomb.cls, tomb.title].filter(Boolean).join(' · ')),
    el('p', 'gameover-fate', fateLine(m?.cause ?? tomb.cause)),
    el(
      'p',
      'gameover-where',
      [m ? fellWhereWhen(m) : tomb.depth ? `at ${(tomb.depth * 50).toLocaleString('en-GB')} ft` : 'on the surface', m ? longDate(m.date) : tomb.date]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  const parts: HTMLElement[] = [hero];

  if (m && (m.foe || m.lastWords.length)) {
    const fight = el('div', 'gameover-fight');
    if (m.foe) {
      const foe = m.foe;
      fight.append(foeChip(foe, () => extras.onFoe(foe)));
    }
    fight.append(lastWordsList(m.lastWords.slice(-8)));
    parts.push(section(m.foe ? 'The last fight' : 'The last moments', fight));
  }

  const grid = el('div', 'stat-grid');
  const stats: [string, string][] = [
    ['Level', tomb.level],
    ['Experience', tomb.exp],
    ['Gold', tomb.gold],
  ];
  const tale = m?.tale ?? extras.tale;
  if (tale) {
    stats.push(['Creatures slain', tale.kills.toLocaleString('en-GB')]);
    if (tale.uniques.length) stats.push(['Legends slain', String(tale.uniques.length)]);
    stats.push(['Deepest', tale.deepestFeet ? `${tale.deepestFeet.toLocaleString('en-GB')} ft` : 'The surface']);
    if (tale.mightiest) stats.push(['Mightiest foe', titleName(tale.mightiest.name)]);
  }
  if (m) stats.push(['Days survived', String(dayOf(m.turn))]);
  for (const [label, value] of stats) {
    const node = el('div', 'stat');
    node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
    grid.append(node);
  }
  parts.push(section('Your tale', grid));
  if (tale?.uniques.length) {
    parts.push(el('p', 'tale-legends', `Slew ${tale.uniques.slice(0, 4).join(', ')}${tale.uniques.length > 4 ? ' and more' : ''}.`));
  }
  const deeds = tale ? deedChips(tale) : null;
  if (deeds) parts.push(section('Deeds', deeds));

  if (m) {
    const look = el('div', 'gameover-look');
    if (m.equipment.length) look.append(gearStrip(m.equipment, () => extras.onHero('gear')));
    look.append(
      navButton('Look back on your hero', { className: 'action-button primary', onClick: () => extras.onHero('hero') }),
    );
    parts.push(section('Carried to the end', look));
  }

  const tip = el('p', 'tale-tip');
  tip.append(el('strong', undefined, 'Next time: '), document.createTextNode(extras.tip));
  parts.push(tip);
  return parts;
}

/** tome2's Hall of Fame screen, shown after the summary when a hero dies. */
export function isHallOfFame(rows: readonly TermRow[]): boolean {
  return rows.length > 0 && /Hall of Fame/.test(rowText(rows[0])) && rows.some((r) => /Press ESC to quit/.test(rowText(r)));
}

/** Index of the entry recorded for this run (same name, level and final game turn), or -1. */
export function heroEntry(entries: readonly ScoreEntry[], hero: { name: string; level: number; turns: number } | null): number {
  if (!hero) return -1;
  return entries.findIndex((e) => e.name === hero.name && e.level === hero.level && e.turns === hero.turns);
}

/** Elements for the native Hall of Fame: one tappable row per hero, best first; a tap opens the hero. */
export function hallOfFameElements(
  entries: readonly ScoreEntry[],
  highlight: number,
  onOpen: (entry: ScoreEntry, index: number) => void,
): HTMLElement[] {
  if (entries.length === 0) {
    return [el('p', 'fame-empty', 'No heroes have fallen yet. Those who do are remembered here.')];
  }
  const list = el('ol', 'fame-list');
  entries.forEach((entry, i) => {
    const item = el('li');
    const row = el('button', `fame-row${i === highlight ? ' current' : ''}`);
    row.type = 'button';
    row.dataset.nav = '';
    const main = el('span', 'fame-main');
    const who = [entry.race, entry.cls].filter(Boolean).join(' ');
    main.append(
      el('span', 'fame-name', entry.name),
      el('span', 'fame-who', `${who ? `${who} · ` : ''}Level ${entry.level}`),
      el('span', 'fame-fate', fateText(entry)),
    );
    row.append(
      el('span', 'fame-rank', String(i + 1)),
      main,
      el('span', 'fame-points', entry.points.toLocaleString('en-GB')),
      el('span', 'fame-open', '›'),
    );
    row.addEventListener('click', () => onOpen(entry, i));
    item.append(row);
    list.append(item);
  });
  return [list];
}
