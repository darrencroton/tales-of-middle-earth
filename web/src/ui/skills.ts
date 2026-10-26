import type { TermRow } from './termparse.ts';
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

function rowText(row: TermRow): string {
  let text = '';
  for (let x = 0; x < row.chars.length; x++) text += row.chars[x] === 0 ? ' ' : String.fromCharCode(row.chars[x]);
  return text;
}

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
