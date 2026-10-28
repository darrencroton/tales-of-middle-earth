import { rowText, type TermRow } from './termparse.ts';
import type { AbilityTable, SkillTable } from '../render/snapshot.ts';
import { el } from './dom.ts';

/* tome2 colours on the skills screen. */
const TERM_L_DARK = 8;
const TERM_ORANGE = 3;
const TERM_L_BLUE = 14;
const TERM_L_RED = 12;
const TERM_YELLOW = 11;

export interface SkillRow {
  row: number;
  depth: number;
  name: string;
  /** Has sub-skills: open (shown) or closed. */
  branch: 'open' | 'closed' | null;
  value: number;
  /** Gain per point invested. */
  mod: number;
  selected: boolean;
  state: 'normal' | 'untrained' | 'learnable' | 'max' | 'hidden';
}

export interface SkillsScreen {
  points: number;
  description: string;
  skills: SkillRow[];
}

const SKILL_ROW = /^(\s*)(\[|\s)?([.+-])(\]|\s)?(\S.*?)\s+(-?)(\d+)\.(\d{3}) \[(\d)\.(\d{3})\]\s*$/;

/** Reads tome2's skills screen (rows of the whole terminal), or null. */
export function parseSkills(rows: readonly TermRow[]): SkillsScreen | null {
  if (!/Skills Screen/.test(rowText(rows[0] ?? { chars: [], attrs: [] }))) return null;
  const points = Number(/Skill points left:\s*(-?\d+)/.exec(rowText(rows[2]))?.[1] ?? 0);
  const description = rows
    .slice(3, 7)
    .filter((r) => r.attrs[0] === TERM_YELLOW || Array.prototype.some.call(r.attrs, (a: number) => a === TERM_YELLOW))
    .map((r) => rowText(r).trim())
    .filter(Boolean)
    .join(' ');
  const skills: SkillRow[] = [];
  rows.forEach((r, y) => {
    if (y < 7) return;
    const text = rowText(r);
    const m = SKILL_ROW.exec(text);
    if (!m) return;
    const indent = m[1].length + (m[2] === '[' ? 0 : m[2] ? 1 : 0);
    const col = text.search(/\S/);
    const attr = r.attrs[col] ?? 1;
    const selected = m[2] === '[';
    const value = (m[6] ? -1 : 1) * (Number(m[7]) + Number(m[8]) / 1000);
    const mod = Number(m[9]) + Number(m[10]) / 1000;
    const state =
      attr === TERM_L_DARK ? 'untrained' : attr === TERM_ORANGE ? 'learnable' : attr === TERM_L_BLUE ? 'max' : attr === TERM_L_RED ? 'hidden' : 'normal';
    skills.push({
      row: y,
      depth: Math.round(indent / 4),
      name: m[5].trim(),
      branch: m[3] === '-' ? 'open' : m[3] === '+' ? 'closed' : null,
      value,
      mod,
      selected,
      state: selected ? 'normal' : state,
    });
  });
  return skills.length ? { points, description, skills } : null;
}

/** Cursor keys from the selected skill to another row. */
export function skillMoveKeys(screen: SkillsScreen, target: SkillRow): string {
  const from = screen.skills.findIndex((s) => s.selected);
  const to = screen.skills.indexOf(target);
  if (from < 0 || to < 0 || from === to) return '';
  return (to > from ? '2' : '8').repeat(Math.abs(to - from));
}

function formatValue(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Rows for the native skills panel; `onTap` receives the tapped skill. */
export function skillsElements(screen: SkillsScreen, onTap: (skill: SkillRow) => void): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (screen.description) out.push(el('p', 'skill-description', screen.description));
  for (const skill of screen.skills) {
    const button = el('button', `skill-row ${skill.state}${skill.selected ? ' current' : ''}`);
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = `skill-${skill.row}`;
    button.style.paddingLeft = `calc(0.7rem + ${skill.depth * 1.1}rem)`;
    button.append(el('span', 'skill-branch', skill.branch === 'open' ? '▾' : skill.branch === 'closed' ? '▸' : ''));
    button.append(el('span', 'skill-name', skill.name));
    const value = el('span', 'skill-value');
    value.append(el('span', 'skill-level', formatValue(skill.value)));
    if (skill.mod > 0) value.append(el('span', 'skill-mod', `+${formatValue(skill.mod)}/pt`));
    button.append(value);
    button.addEventListener('click', () => onTap(skill));
    out.push(button);
  }
  return out;
}

const TERM_L_GREEN = 13;

export interface AbilityRow {
  row: number;
  name: string;
  /** Skill points needed, or null once known. */
  cost: number | null;
  selected: boolean;
  state: 'known' | 'learnable' | 'locked';
}

export interface AbilitiesScreen {
  points: number;
  description: string;
  abilities: AbilityRow[];
}

const ABILITY_ROW = /^([[ ])\.([\] ])(\S.*?)\s{2,}(\d+|Known)\s*$/;

/** Reads tome2's abilities screen (rows of the whole terminal), or null. */
export function parseAbilities(rows: readonly TermRow[]): AbilitiesScreen | null {
  if (!/Abilities Screen/.test(rowText(rows[0] ?? { chars: [], attrs: [] }))) return null;
  const points = Number(/Skill points left:\s*(-?\d+)/.exec(rowText(rows[2]))?.[1] ?? 0);
  const description = rows
    .slice(3, 7)
    .map((r) => rowText(r).trim())
    .filter(Boolean)
    .join(' ');
  const abilities: AbilityRow[] = [];
  rows.forEach((r, y) => {
    if (y < 7) return;
    const m = ABILITY_ROW.exec(rowText(r));
    if (!m) return;
    const attr = r.attrs[0] ?? 1;
    const known = m[4] === 'Known';
    const selected = m[1] === '[' || attr === TERM_L_GREEN;
    abilities.push({
      row: y,
      name: m[3].trim(),
      cost: known ? null : Number(m[4]),
      selected,
      state: known ? 'known' : attr === TERM_L_DARK ? 'locked' : selected && points < Number(m[4]) ? 'locked' : 'learnable',
    });
  });
  return abilities.length ? { points, description, abilities } : null;
}

/** Cursor keys from the selected ability to another row. */
export function abilityMoveKeys(screen: AbilitiesScreen, target: AbilityRow): string {
  const from = screen.abilities.findIndex((a) => a.selected);
  const to = screen.abilities.indexOf(target);
  if (from < 0 || to < 0 || from === to) return '';
  return (to > from ? '2' : '8').repeat(Math.abs(to - from));
}

/** Rows for the native abilities panel; `onTap` receives the tapped ability. */
export function abilitiesElements(screen: AbilitiesScreen, onTap: (ability: AbilityRow) => void): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (screen.description) out.push(el('p', 'skill-description', screen.description));
  for (const ability of screen.abilities) {
    const state = ability.state === 'known' ? 'max' : ability.state === 'locked' ? 'untrained' : 'normal';
    const button = el('button', `skill-row ${state}${ability.selected ? ' current' : ''}`);
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = `ability-${ability.row}`;
    button.append(el('span', 'skill-name', ability.name));
    const value = el('span', 'skill-value');
    value.append(el('span', 'skill-level', ability.cost === null ? 'Known' : `${ability.cost} pt${ability.cost === 1 ? '' : 's'}`));
    button.append(value);
    button.addEventListener('click', () => onTap(ability));
    out.push(button);
  }
  return out;
}

/** Keys that move tome2's list cursor from one row to another (the lists keep tome2's order). */
export function cursorKeys(from: number, to: number): string {
  if (from < 0 || to < 0 || from === to) return '';
  return (to > from ? '2' : '8').repeat(Math.abs(to - from));
}

/** Row of the whole skill list that tome2's cursor is on: the selected row it shows, matched by name and depth. */
export function selectedSkill(table: SkillTable, screen: SkillsScreen): number {
  const shown = screen.skills.find((s) => s.selected);
  if (!shown) return -1;
  return table.skills.findIndex((s) => s.name === shown.name && s.depth === shown.depth);
}

/** Row of the whole abilities list that tome2's cursor is on. */
export function selectedAbility(table: AbilityTable, screen: AbilitiesScreen): number {
  const shown = screen.abilities.find((a) => a.selected);
  return shown ? table.abilities.findIndex((a) => a.name === shown.name) : -1;
}

/** Fixed-height details of the selected row, above the list, so the rows never move as the cursor does. */
function detail(title: string, lines: string[]): HTMLElement {
  const box = el('div', 'skill-detail');
  box.append(el('p', 'skill-detail-title', title));
  for (const line of lines.filter(Boolean)) box.append(el('p', undefined, line));
  return box;
}

/** The whole skill list with the selected skill's description; `onTap` receives a row index. */
export function skillTableElements(table: SkillTable, selected: number, onTap: (index: number) => void): HTMLElement[] {
  const current = table.skills[selected];
  const out: HTMLElement[] = [detail(current?.name ?? '', [current?.desc ?? ''])];
  table.skills.forEach((skill, i) => {
    const button = el('button', `skill-row ${skill.state}${i === selected ? ' current' : ''}`);
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = `skill-${skill.depth}-${skill.name}`;
    button.style.paddingLeft = `calc(0.7rem + ${skill.depth * 1.1}rem)`;
    button.append(el('span', 'skill-branch', skill.branch === 2 ? '▾' : skill.branch === 1 ? '▸' : ''));
    button.append(el('span', 'skill-name', skill.name));
    const value = el('span', 'skill-value');
    value.append(el('span', 'skill-level', formatValue(skill.value / 1000)));
    if (skill.mod > 0 && !skill.misc) value.append(el('span', 'skill-mod', `+${formatValue(skill.mod / 1000)}/pt`));
    button.append(value);
    button.addEventListener('click', () => onTap(i));
    out.push(button);
  });
  return out;
}

/** The whole abilities list with the selected ability's description and what it needs. */
export function abilityTableElements(table: AbilityTable, selected: number, onTap: (index: number) => void): HTMLElement[] {
  const current = table.abilities[selected];
  const needs = current && !current.known && current.needs.length && !/prereq/i.test(current.desc) ? `Needs ${current.needs.join(', ')}.` : '';
  const out: HTMLElement[] = [detail(current?.name ?? '', [current?.desc ?? '', needs])];
  table.abilities.forEach((ability, i) => {
    const state = ability.known ? 'max' : ability.learnable ? 'normal' : 'untrained';
    const button = el('button', `skill-row ${state}${i === selected ? ' current' : ''}`);
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = `ability-${ability.name}`;
    button.append(el('span', 'skill-name', ability.name));
    const value = el('span', 'skill-value');
    value.append(el('span', 'skill-level', ability.known ? 'Known' : `${ability.cost} pt${ability.cost === 1 ? '' : 's'}`));
    button.append(value);
    button.addEventListener('click', () => onTap(i));
    out.push(button);
  });
  return out;
}
