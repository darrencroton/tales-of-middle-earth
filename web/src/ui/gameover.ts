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
