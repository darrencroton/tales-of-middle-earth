import { displayName, hasMagic, hasPowers, magicArts, recentKey, recentLabel, recentSource, rememberRecent, skillActionName, techniques, usableRecents, validRecent, type RecentAction } from '../play/recent.ts';
import type { PowerInfo, SpellInfo, SpellState } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { el, iconText, section } from './dom.ts';

const STORAGE_KEY = 'tome2mobile.recent.v1';

/**
 * Recently cast spells, used powers and used items, per hero, kept in this
 * browser (a convenience, so it is not part of the savefile).
 */
export class RecentStore {
  private all: Record<string, RecentAction[]> = {};

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === 'object') this.all = parsed as Record<string, RecentAction[]>;
    } catch {
      this.all = {};
    }
  }

  list(hero: string): RecentAction[] {
    const list = this.all[hero];
    return Array.isArray(list) ? list.filter(validRecent) : [];
  }

  remember(hero: string, entry: RecentAction): void {
    if (!hero) return;
    this.all[hero] = rememberRecent(this.list(hero), entry);
    this.store();
  }

  forget(hero: string): void {
    delete this.all[hero];
    this.store();
  }

  private store(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.all));
    } catch {
      /* Storage is unavailable; recents last for this session only. */
    }
  }
}

export interface MagicHandlers {
  /** Casts a spell or uses a power (and remembers it); `anyway` tries a spell the hero lacks the mana for. */
  run(entry: RecentAction, anyway?: boolean): void;
}

function spellMeta(spell: SpellInfo): string {
  if (spell.level < 0) return 'Not yet learnt';
  return [`Level ${spell.level}`, `${spell.mana} mana`, `${spell.fail}% fail`].join(' · ');
}

/** A school spell as a tappable row: name, school, cost and what it does. */
function spellRow(api: GameApi, spell: SpellInfo, handlers: MagicHandlers): HTMLElement {
  const row = el('div', 'spell-line');
  const button = el('button', `spell-row${spell.ok ? '' : ' unavailable'}${spell.short ? ' short' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  button.dataset.key = `spell-${spell.name}`;
  const main = el('span', 'spell-main');
  main.append(el('span', 'spell-name', spell.name), el('span', 'spell-school', spell.school));
  const meta = el('span', 'spell-meta');
  meta.append(el('span', undefined, spellMeta(spell)));
  if (spell.info) meta.append(el('span', 'spell-info', spell.info));
  button.append(main, meta);
  button.addEventListener('click', () => {
    if (spell.ok) handlers.run({ kind: 'spell', name: spell.name });
    else openSpell(api, spell, handlers);
  });
  const info = el('button', 'tv-info', 'i');
  info.type = 'button';
  info.setAttribute('aria-label', `About ${spell.name}`);
  info.addEventListener('click', () => openSpell(api, spell, handlers));
  row.append(button, info);
  return row;
}

/** What a spell does, with Cast at the foot. */
export function openSpell(api: GameApi, spell: SpellInfo, handlers: MagicHandlers): void {
  const body = el('div', 'description');
  body.append(el('p', 'muted', spellMeta(spell) + (spell.info ? ` · ${spell.info}` : '')));
  body.append(el('p', undefined, spell.desc || 'No more is known of this spell.'));
  if (!spell.ok) body.append(el('p', 'muted', spell.level < 0 ? 'Your skills are not yet high enough to cast it.' : 'You cannot cast it from this book.'));
  else if (spell.short) body.append(el('p', 'muted', 'You do not have the mana for it. You may try anyway, at a much greater risk of failure.'));
  const entry: RecentAction = { kind: 'spell', name: spell.name };
  api.sheets.open({
    title: spell.name,
    subtitle: spell.school,
    body,
    kind: 'card',
    className: 'sheet-item',
    actions: !spell.ok
      ? []
      : spell.short
        ? [{ id: 'cast', label: 'Try anyway', run: () => handlers.run(entry, true) }]
        : [{ id: 'cast', label: `Cast ${spell.name}`, primary: true, run: () => handlers.run(entry) }],
  });
}

function recentDetail(entry: RecentAction, spells: SpellState | null): string {
  if (entry.kind === 'spell') {
    const spell = spells?.books.flatMap((b) => b.spells).find((s) => s.name === entry.name);
    return spell ? `${spell.mana} mana · ${spell.fail}%` : 'Spell';
  }
  return recentSource(entry);
}

function rowButton(label: string, hint: string, icon: string, key: string, run: () => void): HTMLButtonElement {
  const button = el('button', 'row-button');
  button.type = 'button';
  button.dataset.nav = '';
  button.dataset.key = key;
  button.append(el('span', 'row-icon', iconText(icon)), el('span', 'row-label', label));
  if (hint) button.append(el('span', 'row-hint', hint));
  button.addEventListener('click', run);
  return button;
}

/** The Magic panel's two views: spells and magic arts, and powers and techniques. */
export type MagicTab = 'magic' | 'powers';

const SOURCE_ORDER: readonly PowerInfo['source'][] = ['race', 'class', 'form', 'gear', 'corruption', 'other'];

/** The heading a power is listed under: what grants it. */
function powerHeading(power: PowerInfo): string {
  switch (power.source) {
    case 'race':
    case 'class':
      return power.from;
    case 'form':
      return `${displayName(power.from)} form`;
    case 'gear':
      return 'Gear';
    case 'corruption':
      return 'Corruptions';
    default:
      return 'Other powers';
  }
}

function powerMeta(power: PowerInfo): string {
  return [power.level > 1 ? `Level ${power.level}` : '', power.cost ? `${power.cost} mana` : ''].filter(Boolean).join(' · ');
}

/** What a power does and what grants it, with Use at the foot. */
function openPower(api: GameApi, power: PowerInfo, handlers: MagicHandlers): void {
  const body = el('div', 'description');
  const meta = [powerMeta(power), power.source === 'gear' ? `From ${power.from}` : ''].filter(Boolean).join(' · ');
  if (meta) body.append(el('p', 'muted', meta));
  body.append(el('p', undefined, power.desc || 'No more is known of this power.'));
  api.sheets.open({
    title: displayName(power.name),
    subtitle: powerHeading(power),
    body,
    kind: 'card',
    className: 'sheet-item',
    actions: [{ id: 'use', label: `Use ${displayName(power.name)}`, primary: true, run: () => handlers.run({ kind: 'path', command: 'U', steps: [power.name] }) }],
  });
}

/** A power as a tappable row (one tap uses it), with ⓘ for what it does. */
function powerRow(api: GameApi, power: PowerInfo, handlers: MagicHandlers): HTMLElement {
  const row = el('div', 'spell-line');
  const hint = power.source === 'gear' ? [powerMeta(power), power.from].filter(Boolean).join(' · ') : powerMeta(power);
  row.append(rowButton(displayName(power.name), hint, '❂', `bonus-${power.name}`, () => handlers.run({ kind: 'path', command: 'U', steps: [power.name] })));
  const info = el('button', 'tv-info', 'i');
  info.type = 'button';
  info.setAttribute('aria-label', `About ${displayName(power.name)}`);
  info.addEventListener('click', () => openPower(api, power, handlers));
  row.append(info);
  return row;
}

/** Entries of tome2's "use a skill" menu as rows, named for the player. */
function skillList(entries: SpellState['powers'], icon: string, handlers: MagicHandlers): HTMLElement {
  const list = el('div', 'menu-list');
  for (const entry of entries) {
    list.append(rowButton(skillActionName(entry.label), '', icon, `skill-${entry.label}`, () => handlers.run({ kind: 'path', command: 'm', steps: [entry.label] })));
  }
  return list;
}

/**
 * Magic and Powers, one panel with a tab each (only the tabs with something
 * in them). Both start with every spell and power recently used, so a repeat
 * is one tap from either. Magic: each spell book, then the magic arts
 * (Necromancy, Mindcraft, Copy a spell…). Powers: the powers of the hero's
 * race, class, form, gear and corruptions, each under what grants them, then
 * techniques (Piercing shots, Mimicry, Forge ammo…). One tap casts or uses.
 */
export function openMagic(api: GameApi, recents: readonly RecentAction[], handlers: MagicHandlers, tab: MagicTab = 'magic', replace = false): void {
  const spells = api.engine.spells();
  const player = api.state()?.player;
  const shown: MagicTab[] = [...(hasMagic(spells) ? ['magic' as const] : []), ...(hasPowers(spells) ? ['powers' as const] : [])];
  const current = shown.includes(tab) ? tab : (shown[0] ?? tab);
  const body = el('div', 'magic');

  const recent = usableRecents(recents, spells);
  if (recent.length) {
    const grid = el('div', 'action-grid recent-grid');
    for (const entry of recent) {
      const button = el('button', 'action-button recent-button');
      button.type = 'button';
      button.dataset.nav = '';
      button.dataset.key = recentKey(entry);
      button.append(el('span', 'row-label', recentLabel(entry)), el('span', 'row-hint', recentDetail(entry, spells)));
      button.addEventListener('click', () => handlers.run(entry));
      grid.append(button);
    }
    body.append(section('Recent', grid));
  }

  if (current === 'magic') {
    for (const book of spells?.books ?? []) {
      const list = el('div', 'spell-list');
      for (const spell of book.spells) list.append(spellRow(api, spell, handlers));
      body.append(section(book.name.replace(/^(a|an|the) /i, ''), list));
    }
    const arts = magicArts(spells);
    if (arts.length) body.append(section('Magic arts', skillList(arts, '✧', handlers)));
  } else {
    const bonus = [...(spells?.bonus ?? [])].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
    const groups = new Map<string, PowerInfo[]>();
    for (const power of bonus) groups.set(powerHeading(power), [...(groups.get(powerHeading(power)) ?? []), power]);
    for (const [heading, powers] of groups) {
      const list = el('div', 'menu-list');
      for (const power of powers) list.append(powerRow(api, power, handlers));
      body.append(section(heading, list));
    }
    const moves = techniques(spells);
    if (moves.length) body.append(section('Techniques', skillList(moves, '✪', handlers)));
  }

  if (!shown.length) {
    body.append(el('p', 'empty', 'You know no magic or powers yet. Spell books, skills such as Mindcraft or Necromancy, and some races, classes and items bring spells and powers to use here.'));
  }

  const content = {
    title: current === 'magic' ? 'Magic' : 'Powers',
    subtitle: player && player.msp > 0 ? `Mana ${player.csp} / ${player.msp}` : undefined,
    body,
    tabs:
      shown.length > 1
        ? shown.map((id) => ({ id, label: id === 'magic' ? 'Magic' : 'Powers', icon: id === 'magic' ? '✦' : '❂', active: id === current, run: () => openMagic(api, recents, handlers, id, true) }))
        : undefined,
    className: 'sheet-magic',
  };
  if (replace) api.sheets.replace(content);
  else api.sheets.open(content);
}
