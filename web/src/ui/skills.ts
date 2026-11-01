import { rowText, type TermRow } from './termparse.ts';
import type { AbilityTable, SkillEntry, SkillTable } from '../render/snapshot.ts';
import { el } from './dom.ts';

/** A row of tome2's skills screen, as far as finding its cursor needs. */
export interface SkillRow {
  depth: number;
  name: string;
  selected: boolean;
}

/** The rows tome2's skills screen shows (a window of the whole list, which comes from `web_skills_json`). */
export interface SkillsScreen {
  skills: SkillRow[];
}

const SKILL_ROW = /^(\s*)(\[|\s)?[.+-](\]|\s)?(\S.*?)\s+-?\d+\.\d{3} \[\d\.\d{3}\]\s*$/;

/** Reads tome2's skills screen (rows of the whole terminal), or null. */
export function parseSkills(rows: readonly TermRow[]): SkillsScreen | null {
  if (!/Skills Screen/.test(rowText(rows[0] ?? { chars: [], attrs: [] }))) return null;
  const skills: SkillRow[] = [];
  rows.forEach((r, y) => {
    if (y < 7) return;
    const m = SKILL_ROW.exec(rowText(r));
    if (!m) return;
    const indent = m[1].length + (m[2] === '[' ? 0 : m[2] ? 1 : 0);
    skills.push({ depth: Math.round(indent / 4), name: m[4].trim(), selected: m[2] === '[' });
  });
  return skills.length ? { skills } : null;
}

function formatValue(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/* tome2's colour for the abilities screen's cursor row. */
const TERM_L_GREEN = 13;

/** A row of tome2's abilities screen, as far as finding its cursor needs. */
export interface AbilityRow {
  name: string;
  selected: boolean;
}

export interface AbilitiesScreen {
  abilities: AbilityRow[];
}

const ABILITY_ROW = /^([[ ])\.[\] ](\S.*?)\s{2,}(?:\d+|Known)\s*$/;

/** Reads tome2's abilities screen (rows of the whole terminal), or null. */
export function parseAbilities(rows: readonly TermRow[]): AbilitiesScreen | null {
  if (!/Abilities Screen/.test(rowText(rows[0] ?? { chars: [], attrs: [] }))) return null;
  const abilities: AbilityRow[] = [];
  rows.forEach((r, y) => {
    if (y < 7) return;
    const m = ABILITY_ROW.exec(rowText(r));
    if (m) abilities.push({ name: m[2].trim(), selected: m[1] === '[' || r.attrs[0] === TERM_L_GREEN });
  });
  return abilities.length ? { abilities } : null;
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

/** Why a point cannot be put into a skill now, in words; null when it can. */
export function raiseRefusal(skill: Pick<SkillEntry, 'raise' | 'misc'>, most: number, level: number): string | null {
  switch (skill.raise) {
    case 'points':
      return 'No skill points left to spend.';
    case 'fixed':
      return skill.misc ? 'Raise the skills within this group instead.' : 'Points cannot raise this skill.';
    case 'max':
      return 'Mastered: it can go no higher.';
    case 'level':
      return `At level ${level} a skill can go no higher than ${most}.`;
    default:
      return null;
  }
}

/** The whole skill list with the selected skill's description; rows with unsaved points show how many; `onTap` receives a row index. */
export function skillTableElements(table: SkillTable, selected: number, pending: ReadonlyMap<string, number>, onTap: (index: number) => void): HTMLElement[] {
  const current = table.skills[selected];
  const out: HTMLElement[] = [detail(current?.name ?? '', [current?.desc ?? ''])];
  table.skills.forEach((skill, i) => {
    const added = pending.get(skill.name) ?? 0;
    const button = el('button', `skill-row ${skill.state}${i === selected ? ' current' : ''}${added ? ' pending' : ''}`);
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = `skill-${skill.depth}-${skill.name}`;
    button.style.paddingLeft = `calc(0.7rem + ${skill.depth * 1.1}rem)`;
    button.append(el('span', 'skill-branch', skill.branch === 2 ? '▾' : skill.branch === 1 ? '▸' : ''));
    button.append(el('span', 'skill-name', skill.name));
    const value = el('span', 'skill-value');
    if (added) value.append(el('span', 'skill-pending', `+${added} pt${added === 1 ? '' : 's'}`));
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
