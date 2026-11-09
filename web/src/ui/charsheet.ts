import type { PropertyPage } from '../play/properties.ts';
import { rowText, type TermRow } from './termparse.ts';
import { el, section, stat } from './dom.ts';

/* tome2 colours on the character sheet. */
const TERM_RED = 4;
const TERM_L_RED = 12;
const GOOD_COLOURS = new Set([5, 6, 10, 13, 14]);

/* tome2's pages of its sheet: its summary, then four pages of flags, which the census shows instead. */
export const SHEET_PAGES = ['Stats', 'Bonuses', 'Defences', 'Traits', 'Senses'] as const;

/** The census page shown for each of tome2's pages of flags. */
export const CENSUS_PAGES: Readonly<Record<1 | 2 | 3 | 4, PropertyPage>> = { 1: 'bonuses', 2: 'defences', 3: 'traits', 4: 'senses' };

interface SheetStat {
  label: string;
  value: string;
  tone: 'good' | 'bad' | '';
}

interface SheetGroup {
  title: string;
  stats: SheetStat[];
}

export type FullSheet =
  | { page: 0; groups: SheetGroup[]; tactic: string; movement: string }
  | { page: 1 | 2 | 3 | 4 };

const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/ ?\/ ?/g, ' / ').trim();

const LABELS: Readonly<Record<string, string>> = {
  'To Melee Hit': 'Melee to-hit',
  'To Melee Damage': 'Melee damage',
  'To Ranged Hit': 'Ranged to-hit',
  'To Ranged Damage': 'Ranged damage',
  AC: 'Armour',
  'Max Exp': 'Best experience',
  'Exp to Adv.': 'Next level at',
  'Spell Points': 'Mana',
  'Hit Points': 'Health',
  'Bows/Throw': 'Shooting',
  'Saving Throw': 'Saving throw',
  'Magic Device': 'Magic devices',
  'Blows/Round': 'Blows per round',
  'Shots/Round': 'Shots per round',
  'Mel.dmg/Rnd': 'Melee damage per round',
  'Infra-Vision': 'Infravision',
};

const label = (raw: string) => LABELS[raw.trim()] ?? raw.trim();

/** Splits "Label   value" or "Label: value" into its parts. */
function pair(text: string): [string, string] | null {
  const m = /^\s*\+?\s*([A-Za-z][A-Za-z./ -]*?)\s*(?::\s*|\s{2,})(\S.*?)\s*$/.exec(text);
  return m ? [m[1], m[2]] : null;
}

function toneAt(row: TermRow | undefined, x: number): SheetStat['tone'] {
  const attr = row?.attrs[x] ?? 0;
  return attr === TERM_RED || attr === TERM_L_RED ? 'bad' : GOOD_COLOURS.has(attr) ? 'good' : '';
}

function summary(rows: readonly TermRow[]): FullSheet {
  const identity: SheetStat[] = [];
  const stats: SheetStat[] = [];
  const progress: SheetStat[] = [];
  const combat: SheetStat[] = [];
  const skills: SheetStat[] = [];
  let tactic = '';
  let movement = '';
  for (let y = 2; y <= 7; y++) {
    const text = rowText(rows[y]);
    const who = pair(text.slice(0, 55));
    if (who) identity.push({ label: who[0], value: who[1], tone: '' });
    const stat = /^\s*(\w{3}):?\s*(.+?)\s*$/.exec(text.slice(55));
    if (stat) stats.push({ label: stat[1].toUpperCase(), value: tidy(stat[2]), tone: stat[1] === stat[1].toUpperCase() ? '' : 'bad' });
  }
  for (let y = 8; y <= 12; y++) {
    const text = rowText(rows[y]);
    for (const [x0, x1, into] of [
      [0, 28, combat],
      [28, 50, progress],
      [50, 80, progress],
    ] as const) {
      const p = pair(text.slice(x0, x1));
      if (p) into.push({ label: label(p[0]), value: tidy(p[1]), tone: '' });
    }
  }
  for (let y = 14; y <= 21; y++) {
    const row = rows[y];
    const text = rowText(row);
    const left = pair(text.slice(0, 54));
    if (left) skills.push({ label: label(left[0]), value: left[1], tone: toneAt(row, text.indexOf(left[1], 14)) });
    const right = pair(text.slice(54));
    if (!right) continue;
    if (right[0] === 'Tactic') tactic = right[1];
    else if (right[0] === 'Explor') movement = right[1];
    else if (/Infra/.test(right[0])) skills.push({ label: label(right[0]), value: right[1], tone: '' });
    else combat.push({ label: label(right[0]), value: right[1], tone: '' });
  }
  const groups: SheetGroup[] = [
    { title: 'Character', stats: identity },
    { title: 'Attributes', stats },
    { title: 'Combat', stats: combat },
    { title: 'Skills', stats: skills },
    { title: 'Progress', stats: progress },
  ].filter((g) => g.stats.length);
  return { page: 0, groups, tactic, movement };
}

/** Reads tome2's full character sheet (rows of the whole terminal), or null. */
export function parseFullSheet(rows: readonly TermRow[]): FullSheet | null {
  const footer = rows.slice(-3).map(rowText).join(' ');
  if (!/'p' for previous, 'n' for next/.test(footer)) return null;
  if (/^\s*Name\s*:/.test(rowText(rows[2]))) return summary(rows);
  const first = rowText(rows[4]).slice(0, 10).trim();
  return { page: first.startsWith('Add Str') ? 1 : first.startsWith('Sust Str') ? 2 : first.startsWith('Aura') ? 3 : 4 };
}

/** n-presses from one sheet page to another (pages cycle forwards). */
export function sheetPageKeys(from: number, to: number): string {
  return 'n'.repeat((to - from + SHEET_PAGES.length) % SHEET_PAGES.length);
}

interface FullSheetHandlers {
  /** Sends keys to the sheet. */
  send(keys: string): void;
}

function statGrid(stats: SheetStat[]): HTMLElement {
  const grid = el('div', 'stat-grid');
  for (const s of stats) grid.append(stat(s.label, s.value, s.tone));
  return grid;
}

function stepper(title: string, value: string, back: string, next: string, handlers: FullSheetHandlers): HTMLElement {
  const row = el('div', 'sheet-stepper');
  row.append(el('span', 'stat-label', title));
  const prev = el('button', 'stepper-button', '‹');
  prev.type = 'button';
  prev.dataset.nav = '';
  prev.dataset.key = `${back}-back`;
  prev.setAttribute('aria-label', `Previous ${title.toLowerCase()}`);
  prev.addEventListener('click', () => handlers.send(back));
  const after = el('button', 'stepper-button', '›');
  after.type = 'button';
  after.dataset.nav = '';
  after.dataset.key = `${next}-next`;
  after.setAttribute('aria-label', `Next ${title.toLowerCase()}`);
  after.addEventListener('click', () => handlers.send(next));
  row.append(prev, el('span', 'stepper-value', value), after);
  return row;
}

/** Elements for tome2's summary page of the full character sheet. */
export function fullSheetElements(sheet: Extract<FullSheet, { page: 0 }>, handlers: FullSheetHandlers): HTMLElement[] {
  const out = sheet.groups.map((group) => section(group.title, statGrid(group.stats)));
  const style: HTMLElement[] = [];
  if (sheet.tactic) style.push(stepper('Tactic', sheet.tactic, 't', 'T', handlers));
  if (sheet.movement) style.push(stepper('Movement', sheet.movement, 'e', 'E', handlers));
  if (style.length) out.push(section('Style', ...style));
  return out;
}
