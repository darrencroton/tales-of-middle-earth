import type { Engine } from '../engine.ts';
import type { MemorialLine } from '../play/memorial.ts';
import { readableColour } from '../render/colour.ts';
import type { ItemDamage, ItemInfo, ItemProp, PowerInfo, SpellBasics, SpellInfo } from '../render/snapshot.ts';
import { capitalise, type GameApi } from './api.ts';
import { el, section, stat } from './dom.ts';

/*
 * Inspecting items, spells and powers: one way to show what the hero knows of
 * each, wherever it is opened (the pack, a shop, the floor, a fallen hero's
 * gear, a spell book, the Magic panel). Only what tome2's examining tells is
 * shown, so an unidentified item keeps its secrets.
 */

/** The stat names tome2 numbers 0–5. */
export const STAT_NAMES = ['Strength', 'Intelligence', 'Wisdom', 'Dexterity', 'Constitution', 'Charisma'] as const;

const GROUPS: readonly [ItemProp['group'], string][] = [
  ['stat', 'Bonuses'],
  ['attack', 'Attacks'],
  ['immune', 'Immunities'],
  ['resist', 'Resistances'],
  ['sustain', 'Sustains'],
  ['ability', 'Abilities'],
  ['drawback', 'Drawbacks'],
];

/** A known item's properties under their headings, in a fixed order, leaving out empty groups. */
export function propGroups(props: readonly ItemProp[]): { title: string; group: ItemProp['group']; props: ItemProp[] }[] {
  return GROUPS.map(([group, title]) => ({ title, group, props: props.filter((p) => p.group === group) })).filter((g) => g.props.length > 0);
}

/** A property as its chip reads: a bonus with its sign and unit ("+3 Speed", "-20% Mana"), else its label. */
export function propText(prop: ItemProp): string {
  if (prop.value === undefined) return prop.label;
  return `${prop.value > 0 ? '+' : ''}${prop.value}${prop.unit ?? ''} ${prop.label}`;
}

/** Whom a damage figure is against, as tome2's examining names them, in plain words. */
export function damageLabel(against: string): string {
  const text = against.trim().replace(/\bundeads\b/, 'undead');
  if (text === 'all monsters') return 'Any creature';
  if (text === 'other monsters') return 'Other creatures';
  const resisting = /^non (\w+) resistant creatures$/.exec(text);
  if (resisting) return `Not resisting ${resisting[1]}`;
  const susceptible = /^(\w+) susceptible creatures$/.exec(text);
  if (susceptible) return `Hurt by ${susceptible[1]}`;
  return capitalise(text);
}

/**
 * tome2's text as prose: its wrapped lines joined, and its key hints read as
 * words ("'E'ating this mushroom" → "Eating this mushroom", "You can 'f'ire
 * it" → "You can fire it").
 */
export function loreText(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/(^|[.!?]\s+|\s)'([A-Za-z])'(?=[a-z])/g, (_, before: string, key: string) => before + (before === '' || /[.!?]/.test(before) ? key.toUpperCase() : key.toLowerCase()))
    .trim();
}

/** A spell's description lines (tome2 shows each on a line of its own, often without a full stop) as sentences. */
export function spellText(desc: string): string {
  return desc
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join(' ');
}

/** tome2's short note of what a spell does now ("dam 6d8 rad 2"), in words. */
export function effectText(info: string): string {
  return info
    .replace(/\bdam\b/g, 'damage')
    .replace(/\bdur\b/g, 'duration')
    .replace(/\brad\b/g, 'radius')
    .replace(/\bdist\b/g, 'distance')
    .replace(/\bAC\b/g, 'armour')
    .trim();
}

/** tome2's coloured runs of a creature's recall (tome2's white, colour 1, left to the text colour; no colour without a palette). */
function recallRuns(runs: readonly [number, string][], palette?: readonly string[]): MemorialLine[] {
  return runs.map(([attr, text]) => ({ text, colour: attr === 1 || !palette ? '' : (palette[attr] ?? '') }));
}

/** A visible creature's recall from tome2, as coloured runs. */
export function recallLines(engine: Engine, palette: readonly string[], id: number): MemorialLine[] {
  return recallRuns(engine.monsterRecall(id)?.text ?? [], palette);
}

/** A creature's recall as paragraphs (tome2 breaks them with newlines), or `empty` when nothing is known. */
export function recallParagraphs(lines: readonly MemorialLine[], empty: string): HTMLElement {
  const body = el('div', 'description recall');
  let paragraph = el('p');
  for (const run of lines) {
    run.text.split('\n').forEach((piece, i) => {
      if (i > 0 && paragraph.textContent?.trim()) {
        body.append(paragraph);
        paragraph = el('p');
      }
      if (!piece) return;
      const span = el('span', undefined, piece);
      if (run.colour) span.style.color = readableColour(run.colour);
      paragraph.append(span);
    });
  }
  if (paragraph.textContent?.trim()) body.append(paragraph);
  if (!body.childElementCount) body.append(el('p', 'muted', empty));
  return body;
}

/** A spell's figures for the hero as they are now: level, cost, failure. */
export function spellMeta(spell: SpellInfo): string {
  if (spell.level <= 0) return 'Not yet learnt';
  return [`Level ${spell.level}`, `${spell.mana} ${spell.piety ? 'piety' : 'mana'}`, `${spell.fail}% fail`].join(' · ');
}

/** What a spell needs and how it grows, beyond the hero's figures now. */
export function spellNotes(spell: SpellBasics & Partial<SpellInfo>, device = false): string[] {
  const notes: string[] = [];
  const school = spell.school.replace(/\//g, ' and ');
  if (device) {
    if (spell.skill > 0) notes.push(`Its spell level rises with Magic Device skill from ${spell.skill}.`);
  } else {
    if (spell.skill > 0) notes.push(`Learnt at ${school} skill ${spell.skill}${school.includes(' and ') ? ' (their average)' : ''}.`);
    if (spell.stat !== undefined && STAT_NAMES[spell.stat]) notes.push(`Cast with ${STAT_NAMES[spell.stat]}: the higher it is, the less often it fails.`);
    if (spell.manaMin !== undefined && spell.manaMax !== undefined && spell.manaMax > spell.manaMin) {
      notes.push(`Costs ${spell.manaMin} ${spell.piety ? 'piety' : 'mana'} at spell level 1, rising to ${spell.manaMax} at level 50.`);
    } else if (spell.piety) {
      notes.push('Cast with piety rather than mana.');
    }
    if (spell.instrument) notes.push(`Needs an instrument of power ${spell.instrument} or more.`);
  }
  if (spell.blind && spell.confused) notes.push('Can be cast while blind or confused.');
  else if (spell.blind) notes.push('Can be cast while blind.');
  else if (spell.confused) notes.push('Can be cast while confused.');
  return notes;
}

/** A spell's figures now as a grid: its level, cost and failure for the hero, and what it does at that level. */
function spellFigures(spell: SpellBasics & Partial<SpellInfo>): HTMLElement {
  const grid = el('div', 'stat-grid');
  if (spell.level <= 0) grid.append(stat('Level', 'Not learnt', 'bad'));
  else grid.append(stat('Level', String(spell.level)));
  if (spell.mana !== undefined) grid.append(stat(spell.piety ? 'Piety' : 'Mana', String(spell.mana), spell.short ? 'bad' : ''));
  if (spell.level > 0) grid.append(stat('Fail', `${spell.fail}%`, spell.fail >= 50 ? 'bad' : ''));
  if (spell.info.trim()) grid.append(stat('Now', effectText(spell.info), 'wide'));
  return grid;
}

/** A spell's whole story: its figures for the hero now, what it does, then what it needs and how it grows. */
export function spellDetails(spell: SpellBasics & Partial<SpellInfo>, device = false): HTMLElement {
  const body = el('div', 'inspect');
  body.append(spellFigures(spell));
  const text = el('div', 'description');
  text.append(el('p', undefined, spellText(spell.desc) || 'No more is known of this spell.'));
  body.append(text);
  const notes = spellNotes(spell, device);
  if (notes.length) {
    const list = el('ul', 'inspect-notes');
    for (const note of notes) list.append(el('li', undefined, note));
    body.append(list);
  }
  return body;
}

/** What a power's use takes, from tome2's power list (cost, stat and difficulty), in words. */
export function powerNotes(power: PowerInfo): string[] {
  const notes: string[] = [];
  if (power.cost) notes.push(`Costs hit points instead when your mana runs short.`);
  if (power.cost && STAT_NAMES[power.stat]) notes.push(`Succeeds by ${STAT_NAMES[power.stat]}, against a difficulty of ${power.diff} that eases as you gain levels.`);
  return notes;
}

/** A spell as a row of a list: name and school, the hero's figures and what it does now; `className` adds a state. */
export function spellRow(spell: SpellInfo, className = ''): HTMLButtonElement {
  const button = el('button', `spell-row ${className}`.trim());
  button.type = 'button';
  button.dataset.nav = '';
  button.dataset.key = `spell-${spell.name}`;
  const main = el('span', 'spell-main');
  main.append(el('span', 'spell-name', spell.name), el('span', 'spell-school', spell.school));
  const meta = el('span', 'spell-meta');
  meta.append(el('span', undefined, spellMeta(spell)));
  if (spell.info) meta.append(el('span', 'spell-info', effectText(spell.info)));
  button.append(main, meta);
  return button;
}

function damageTable(damage: ItemDamage, heading: string, extra: HTMLElement[] = []): HTMLElement {
  const grid = el('div', 'stat-grid damage-grid');
  if (damage.blows !== undefined) grid.append(stat('Blows a turn', String(damage.blows)));
  for (const row of damage.rows) grid.append(stat(damageLabel(row.against), row.damage, Number(row.damage) > 0 ? '' : 'bad'));
  grid.append(...extra);
  return section(heading, grid);
}

function chips(props: readonly ItemProp[], tone: string): HTMLElement {
  const list = el('div', 'prop-chips');
  for (const prop of props) {
    const bad = tone === 'bad' || (prop.value !== undefined && prop.value < 0);
    list.append(el('span', `prop-chip${bad ? ' bad' : prop.value !== undefined ? ' good' : ''}`, propText(prop)));
  }
  return list;
}

export interface ItemDetailsOptions {
  /** Shown when nothing at all is known. */
  fallback: string;
  /** Opens a spell of the item (a book's, a stored one) in its card; without it the spells are listed only. */
  openSpell?(spell: SpellInfo): void;
  /** A palette to colour a corpse's or totem's creature recall. */
  palette?: readonly string[];
}

/**
 * What the hero knows of an item, organised: its lore, what it does in a
 * fight, its properties by group, its activation, a device's or book's
 * spells, a corpse's creature, what such things are and where it was found.
 */
export function itemDetails(info: ItemInfo | null, options: ItemDetailsOptions): HTMLElement {
  const body = el('div', 'inspect');
  if (!info) {
    body.append(el('p', 'muted', options.fallback));
    return body;
  }

  const lore = el('div', 'description lore');
  for (const text of info.lore ?? []) lore.append(el('p', undefined, loreText(text)));
  if (info.set) lore.append(el('p', 'set', loreText(info.set)));
  if (lore.childElementCount) body.append(lore);

  if (info.melee) body.append(damageTable(info.melee, 'Average damage a turn'));
  const missile = info.missile ?? info.thrown;
  if (missile) {
    const extra: HTMLElement[] = [];
    if (info.breaks !== undefined) extra.push(stat('Breaks', info.breaks ? `${info.breaks}%` : 'Never', info.breaks ? '' : 'good'));
    if (info.explosion) extra.push(stat('Explodes', capitalise(info.explosion)));
    body.append(damageTable(missile, info.thrown ? 'Average damage a throw' : 'Average damage a shot, with your launcher', extra));
  }

  for (const group of propGroups(info.props ?? [])) {
    body.append(section(group.title, chips(group.props, group.group === 'drawback' ? 'bad' : '')));
  }

  if (info.activation || info.power) {
    const text = el('div', 'description');
    if (info.activation) text.append(el('p', undefined, `Activate for ${info.activation}${info.worn ? ', while worn' : ''}.`));
    if (info.power) text.append(el('p', undefined, `Grants the power of ${info.power} while worn.`));
    body.append(section(info.activation ? 'Activation' : 'Power', text));
  }

  if (info.device) {
    body.append(section(`Spell · ${info.device.name}`, spellDetails(info.device, true)));
  }

  if (info.spells?.length) {
    const list = el('div', 'menu-list');
    for (const spell of info.spells) {
      const row = spellRow(spell, spell.ok ? '' : 'unavailable');
      const open = options.openSpell;
      if (open) row.addEventListener('click', () => open(spell));
      else row.disabled = true;
      list.append(row);
    }
    body.append(section(info.spells.length > 1 ? 'Spells' : 'Spell', list));
  }

  if (info.recall?.length) body.append(section('The creature', recallParagraphs(recallRuns(info.recall, options.palette), '')));

  const about = el('div', 'description');
  if (!info.known) about.append(el('p', undefined, 'Not yet identified: identify it to learn what it does.'));
  if (info.kind) about.append(el('p', 'muted', loreText(info.kind)));
  if (info.found) about.append(el('p', 'muted found', info.found));
  if (about.childElementCount) body.append(about);

  if (body.childElementCount === 0) body.append(el('p', 'muted', options.fallback));
  return body;
}

/** An item's details for a card, opening its spells over it (Cast offered when `cast` is given and the spell can be cast). */
export function itemCardBody(api: GameApi, info: ItemInfo | null, fallback: string, cast?: (spell: SpellInfo, anyway: boolean) => void): HTMLElement {
  return itemDetails(info, {
    fallback,
    palette: api.palette(),
    openSpell: (spell) => openSpellCard(api, spell, cast),
  });
}

/** A spell's card: its details, with Cast (or Try anyway, short of mana) when `cast` is given and the hero can cast it. */
export function openSpellCard(api: GameApi, spell: SpellInfo, cast?: (spell: SpellInfo, anyway: boolean) => void): void {
  const body = spellDetails(spell);
  const why = spell.ok
    ? null
    : spell.instrument
      ? 'This instrument is not powerful enough for it.'
      : spell.level === 0
        ? 'Your skills are not yet high enough to cast it.'
        : 'You cannot cast it yet.';
  if (why) body.append(el('p', 'muted', why));
  else if (spell.short && cast) body.append(el('p', 'muted', 'You do not have the mana for it. You may try anyway, at a much greater risk of failure.'));
  api.sheets.open({
    title: spell.name,
    subtitle: spell.school,
    body,
    kind: 'card',
    className: 'sheet-item',
    actions: !spell.ok || !cast
      ? []
      : spell.short
        ? [{ id: 'cast', label: 'Try anyway', unavailable: api.refusal('m'), run: () => cast(spell, true) }]
        : [{ id: 'cast', label: `Cast ${spell.name}`, primary: true, unavailable: api.refusal('m'), run: () => cast(spell, false) }],
  });
}
