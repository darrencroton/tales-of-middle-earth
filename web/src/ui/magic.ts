import { MKEY_SCHOOL, recentKey, recentLabel, recentSource, rememberRecent, validRecent, type RecentAction } from '../play/recent.ts';
import type { SpellInfo, SpellState } from '../render/snapshot.ts';
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

/** Whether a recent spell or power can be used now (the spell is in a book carried, the skill or power is known). */
export function recentUsable(entry: RecentAction, spells: SpellState | null): boolean {
  if (entry.kind === 'spell') return !!spells?.books.some((b) => b.spells.some((s) => s.ok && s.name === entry.name));
  if (entry.kind === 'path' && entry.command === 'm') return !!spells?.powers.some((p) => p.label === entry.steps[0]);
  if (entry.kind === 'path') return !!spells?.bonus.some((p) => p.name === entry.steps[0]);
  return false;
}

/** Spells and powers recently used that can be used now. */
export function usableRecents(recents: readonly RecentAction[], spells: SpellState | null): RecentAction[] {
  return recents.filter((e) => recentUsable(e, spells));
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

/**
 * Magic: recent spells first, then every spell in the books carried, then
 * the other skills that can be used. One tap casts.
 */
export function openMagic(api: GameApi, recents: readonly RecentAction[], handlers: MagicHandlers): void {
  const spells = api.engine.spells();
  const player = api.state()?.player;
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

  for (const book of spells?.books ?? []) {
    const list = el('div', 'spell-list');
    for (const spell of book.spells) list.append(spellRow(api, spell, handlers));
    body.append(section(book.name.replace(/^(a|an|the) /i, ''), list));
  }

  const bonus = spells?.bonus ?? [];
  if (bonus.length) {
    const list = el('div', 'menu-list');
    for (const power of bonus) {
      const hint = [power.level > 1 ? `Level ${power.level}` : '', power.cost ? `${power.cost} mana` : ''].filter(Boolean).join(' · ');
      list.append(rowButton(power.name, hint, '❂', `bonus-${power.name}`, () => handlers.run({ kind: 'path', command: 'U', steps: [power.name] })));
    }
    body.append(section('Powers', list));
  }

  const skills = (spells?.powers ?? []).filter((p) => p.mkey !== MKEY_SCHOOL);
  if (skills.length) {
    const list = el('div', 'menu-list');
    for (const skill of skills) {
      list.append(rowButton(skill.label, '', '✧', `skill-${skill.label}`, () => handlers.run({ kind: 'path', command: 'm', steps: [skill.label] })));
    }
    body.append(section('Skills', list));
  }

  if (!body.childElementCount) {
    body.append(el('p', 'empty', 'You know no magic or powers yet. Spell books, skills such as Mindcraft or Necromancy, and some races bring spells and powers to use here.'));
  }

  api.sheets.open({
    title: 'Magic',
    subtitle: player && player.msp > 0 ? `Mana ${player.csp} / ${player.msp}` : undefined,
    body,
    className: 'sheet-magic',
  });
}
