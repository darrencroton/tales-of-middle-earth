import type { ScoreEntry } from '../render/snapshot.ts';
import { rowText, type TermRow } from './termparse.ts';
import { el, section } from './dom.ts';

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

/** Elements for the native end-of-game view. */
export function tombElements(tomb: Tomb): HTMLElement[] {
  const hero = el('div', 'gameover-hero');
  hero.append(
    el('p', 'gameover-name', tomb.name),
    el('p', 'gameover-title', [tomb.title, tomb.cls].filter(Boolean).join(' · ')),
  );
  const grid = el('div', 'stat-grid');
  const stats: [string, string][] = [
    ['Level', tomb.level],
    ['Experience', tomb.exp],
    ['Gold', tomb.gold],
    ['Depth', tomb.depth ? `${tomb.depth * 50} ft` : 'Town'],
    ['Cause', tomb.cause],
  ];
  for (const [label, value] of stats) {
    const node = el('div', 'stat');
    node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
    grid.append(node);
  }
  return [hero, section('Summary', grid), el('p', 'gameover-date', tomb.date)];
}

/** tome2's Hall of Fame screen, shown after the summary when a hero dies. */
export function isHallOfFame(rows: readonly TermRow[]): boolean {
  return rows.length > 0 && /Hall of Fame/.test(rowText(rows[0])) && rows.some((r) => /Press ESC to quit/.test(rowText(r)));
}

/** Where a hero fell, in words: "in the town", "on a quest", "at 250 ft". */
export function fellWhere(entry: Pick<ScoreEntry, 'depth' | 'quest'>): string {
  if (entry.quest) return 'on a quest';
  return entry.depth > 0 ? `at ${entry.depth * 50} ft` : 'in the town';
}

/** "Killed by a Cave spider at 250 ft", or "Retired" for a hero who chose to stop. */
export function fateText(entry: Pick<ScoreEntry, 'how' | 'depth' | 'quest'>): string {
  if (/^Quitting$/i.test(entry.how)) return `Retired ${fellWhere(entry)}`;
  if (/^Ripe Old Age$/i.test(entry.how)) return 'Lived to a ripe old age';
  return `Killed by ${entry.how || 'something unknown'} ${fellWhere(entry)}`;
}

/** Index of the entry recorded for this run (same name, level and final game turn), or -1. */
export function heroEntry(entries: readonly ScoreEntry[], hero: { name: string; level: number; turns: number } | null): number {
  if (!hero) return -1;
  return entries.findIndex((e) => e.name === hero.name && e.level === hero.level && e.turns === hero.turns);
}

/** Elements for the native Hall of Fame: one tappable row per hero, best first. */
export function hallOfFameElements(entries: readonly ScoreEntry[], highlight = -1): HTMLElement[] {
  if (entries.length === 0) {
    return [el('p', 'fame-empty', 'No heroes have fallen yet. Those who do are remembered here.')];
  }
  const list = el('ol', 'fame-list');
  entries.forEach((entry, i) => {
    const item = el('li');
    const row = el('button', `fame-row${i === highlight ? ' current' : ''}`);
    row.type = 'button';
    row.dataset.nav = '';
    row.setAttribute('aria-expanded', 'false');
    const main = el('span', 'fame-main');
    const who = [entry.race, entry.cls].filter(Boolean).join(' ');
    main.append(
      el('span', 'fame-name', entry.name),
      el('span', 'fame-who', `${who ? `${who} · ` : ''}Level ${entry.level}`),
      el('span', 'fame-fate', fateText(entry)),
    );
    const details = el('span', 'fame-details');
    details.hidden = true;
    const facts: string[] = [`${entry.gold} gold`, `turn ${entry.turns}`];
    if (entry.maxDepth > entry.depth) facts.push(`deepest ${entry.maxDepth * 50} ft`);
    if (entry.maxLevel > entry.level) facts.push(`highest level ${entry.maxLevel}`);
    if (entry.day) facts.push(entry.day);
    details.textContent = facts.join(' · ');
    main.append(details);
    row.append(el('span', 'fame-rank', String(i + 1)), main, el('span', 'fame-points', entry.points.toLocaleString('en-GB')));
    row.addEventListener('click', () => {
      details.hidden = !details.hidden;
      row.setAttribute('aria-expanded', String(!details.hidden));
    });
    item.append(row);
    list.append(item);
  });
  return [list];
}
