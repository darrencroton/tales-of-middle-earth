import { inPlace } from '../hud.ts';
import { DEEDS, type Chronicle, type Deed } from '../play/chronicle.ts';
import { returnsText } from '../play/lives.ts';
import { ABANDONED, dayOf, skillValue, type Memorial, type MemorialFoe, type MemorialItem, type MemorialLine } from '../play/memorial.ts';
import { readableColour } from '../render/colour.ts';
import { FEET_PER_LEVEL, type ScoreEntry } from '../render/snapshot.ts';
import { titleName } from './api.ts';
import { count, el, glyph, iconText, section, signed, stat } from './dom.ts';
import { itemDetails, recallParagraphs } from './inspect.ts';
import type { SheetContent, Sheets, SheetTab } from './sheet.ts';

type FellAt = Pick<Memorial, 'feet' | 'place' | 'quest'>;

/** Where a remembered hero fell: "at 250 ft in Mirkwood", "at 250 ft on the quest “Thieves!”", "in the shallows", "in Bree". */
function memorialWhere(m: FellAt): string {
  const where = m.quest ? `on the quest “${m.quest}”` : m.place ? inPlace(m.place) : '';
  return [m.feet ? `at ${count(m.feet)} ft` : '', where].filter(Boolean).join(' ');
}

/** Where a hero fell, as remembered on this device, else from tome2's score, which keeps no place on the land: "at 250 ft", "on a quest", "on the surface". */
function fellWhere(entry: Pick<ScoreEntry, 'depth' | 'quest'>, memorial: FellAt | null): string {
  const remembered = memorial ? memorialWhere(memorial) : '';
  if (remembered) return remembered;
  if (entry.quest) return 'on a quest';
  return entry.depth > 0 ? `at ${count(entry.depth * FEET_PER_LEVEL)} ft` : 'on the surface';
}

/** "Killed by a Cave spider at 250 ft in Mirkwood", "Abandoned in Bree", or "Retired" for a winner who chose to stop. */
export function fateText(entry: Pick<ScoreEntry, 'how' | 'depth' | 'quest'>, memorial: FellAt | null = null): string {
  const where = fellWhere(entry, memorial);
  if (entry.how === ABANDONED) return `Abandoned ${where}`;
  if (/^Quitting$/i.test(entry.how)) return `Retired ${where}`;
  if (/^Ripe Old Age$/i.test(entry.how)) return 'Lived to a ripe old age';
  return `Killed by ${entry.how || 'something unknown'} ${where}`;
}

export type FallenTab = 'hero' | 'gear' | 'skills' | 'end';

/** A hero in the Hall of Fame: what tome2 recorded and, for heroes whose adventure ended here, what was remembered. */
export interface FallenHero {
  memorial: Memorial | null;
  entry: ScoreEntry | null;
}

const TABS: [FallenTab, string][] = [
  ['hero', 'Hero'],
  ['gear', 'Gear'],
  ['skills', 'Skills'],
  ['end', 'Last moments'],
];

/** "Killed by Smaug the Golden", "Adventure abandoned", "Retired", "Starved to death". */
export function fateLine(cause: string): string {
  if (cause === ABANDONED) return 'Adventure abandoned';
  if (/^Quitting$/i.test(cause)) return 'Retired from adventuring';
  if (/^Ripe Old Age$/i.test(cause)) return 'Lived to a ripe old age';
  if (/^starvation$/i.test(cause)) return 'Starved to death';
  return cause ? `Killed by ${cause}` : 'Fell in the dark';
}

/** Where and when: "at 1,500 ft in Erebor · day 12". */
export function fellWhereWhen(m: FellAt & Pick<Memorial, 'turn'>): string {
  return [memorialWhere(m), `day ${dayOf(m.turn)}`].filter(Boolean).join(' · ');
}

/** The creature that killed the hero, as a tappable chip. */
export function foeChip(foe: MemorialFoe, onOpen: () => void): HTMLButtonElement {
  const button = el('button', 'entity foe fallen-foe');
  button.type = 'button';
  button.dataset.nav = '';
  button.append(glyph(foe.ch, foe.colour), el('span', `label${foe.unique ? ' unique' : ''}`, titleName(foe.name)));
  if (foe.level) button.append(el('span', 'tags', `Level ${foe.level}`));
  button.addEventListener('click', onOpen);
  return button;
}

/** The last messages before the end, oldest first, the final ones brightest. */
export function lastWordsList(lines: readonly MemorialLine[]): HTMLElement {
  const list = el('ol', 'last-words');
  lines.forEach((line, i) => {
    const item = el('li', i >= lines.length - 3 ? 'final' : undefined, line.text);
    if (line.colour) item.style.color = readableColour(line.colour);
    list.append(item);
  });
  if (!lines.length) list.append(el('li', 'muted', 'Nothing was written of the end.'));
  return list;
}

/** Kills, legends, depth and deeds from the hero's chronicle. */
function taleGrid(tale: Chronicle): HTMLElement {
  const grid = el('div', 'stat-grid');
  grid.append(stat('Creatures slain', count(tale.kills)), stat('Deepest', tale.deepestFeet ? `${count(tale.deepestFeet)} ft` : 'The surface'));
  if (tale.mightiest) grid.append(stat('Mightiest foe', titleName(tale.mightiest.name)));
  if (tale.uniques.length) grid.append(stat('Legends slain', String(tale.uniques.length)));
  if (tale.peakGold) grid.append(stat('Most gold', count(tale.peakGold)));
  if (tale.returns) grid.append(stat('Returned from death', returnsText(tale.returns)));
  return grid;
}

export function deedChips(tale: Chronicle): HTMLElement | null {
  const deeds = tale.deeds.map((id) => DEEDS.find((d) => d.id === id)).filter((d): d is Deed => !!d);
  if (!deeds.length) return null;
  const list = el('div', 'deed-chips');
  for (const deed of deeds) list.append(el('span', 'deed-chip', `${iconText('★')} ${deed.title}`));
  return list;
}

function tabBar(current: FallenTab, open: (tab: FallenTab) => void, tabs: FallenTab[]): SheetTab[] {
  return TABS.filter(([tab]) => tabs.includes(tab)).map(([tab, label]) => ({ id: tab, label, active: tab === current, run: () => open(tab) }));
}

function openItem(sheets: Sheets, item: MemorialItem): void {
  const body = itemDetails(item.info, { fallback: 'Nothing more was known of it.' });
  sheets.open({
    title: titleName(item.name),
    subtitle: item.slot ? `Worn · ${item.slot}` : 'Carried',
    badge: glyph(item.ch, item.colour),
    body,
    kind: 'card',
    className: 'sheet-item',
  });
}

export function openFoe(sheets: Sheets, foe: MemorialFoe): void {
  const body = recallParagraphs(foe.recall, 'Little was known of this creature.');
  sheets.open({
    title: titleName(foe.name),
    subtitle: [foe.level ? `Level ${foe.level}` : '', foe.unique ? 'a creature of legend' : ''].filter(Boolean).join(' · ') || undefined,
    badge: glyph(foe.ch, foe.colour),
    body,
    kind: 'card',
    className: 'sheet-monster',
  });
}

function itemRows(sheets: Sheets, items: readonly MemorialItem[]): HTMLElement {
  const list = el('div', 'item-list');
  for (const item of items) {
    const button = el('button', 'item-row');
    button.type = 'button';
    button.dataset.nav = '';
    if (item.slot) button.append(el('span', 'item-slot', item.slot));
    button.append(glyph(item.ch, item.colour), el('span', 'item-name', item.name));
    button.addEventListener('click', () => openItem(sheets, item));
    list.append(button);
  }
  return list;
}

function heroTab(sheets: Sheets, hero: FallenHero): HTMLElement[] {
  const m = hero.memorial;
  const e = hero.entry;
  const parts: HTMLElement[] = [];
  const fate = el('div', 'fallen-fate');
  fate.append(el('p', 'fallen-cause', m ? fateLine(m.cause) : e ? fateText(e) : ''));
  if (m) fate.append(el('p', 'fallen-where', fellWhereWhen(m)));
  if (m?.foe) {
    const foe = m.foe;
    fate.append(foeChip(foe, () => openFoe(sheets, foe)));
  }
  parts.push(fate);
  if (m) {
    const stats = el('div', 'stat-grid six');
    for (const s of m.stats) stats.append(stat(s.name, s.value));
    if (m.stats.length) parts.push(section('Attributes', stats));
    const combat = el('div', 'stat-grid');
    combat.append(
      stat('To hit', signed(m.combat.toHit)),
      stat('To damage', signed(m.combat.toDam)),
      stat('Armour', `${m.combat.ac} ${signed(m.combat.toAc)}`),
      stat('Blows', String(m.combat.blows)),
      stat('Health', String(m.mhp)),
      stat('Speed', m.speed === 0 ? 'Normal' : signed(m.speed)),
    );
    parts.push(section('At the end', combat));
  }
  const progress = el('div', 'stat-grid');
  const level = m?.level ?? e?.level ?? 0;
  progress.append(stat('Level', String(level)));
  if (e && e.maxLevel > level) progress.append(stat('Highest level', String(e.maxLevel)));
  if (m) progress.append(stat('Experience', count(m.exp)));
  progress.append(stat('Gold', count(m?.gold ?? e?.gold ?? 0)));
  if (e) progress.append(stat('Score', count(e.points)));
  if (e && e.maxDepth > 0) progress.append(stat('Deepest', `${count(e.maxDepth * FEET_PER_LEVEL)} ft`));
  if (m?.god && m.god !== 'Nobody') progress.append(stat('God', m.god));
  parts.push(section('Progress', progress));
  if (m?.tale) {
    parts.push(section('Their tale', taleGrid(m.tale)));
    const deeds = deedChips(m.tale);
    if (deeds) parts.push(section('Deeds', deeds));
  }
  return parts;
}

function build(sheets: Sheets, hero: FallenHero, tab: FallenTab): HTMLElement[] {
  const m = hero.memorial;
  if (tab === 'gear' && m) {
    const parts = [section('Equipment', m.equipment.length ? itemRows(sheets, m.equipment) : el('p', 'empty', 'Nothing worn.'))];
    if (m.pack.length) parts.push(section('Pack', itemRows(sheets, m.pack)));
    return parts;
  }
  if (tab === 'skills' && m) {
    const list = el('dl', 'skill-values');
    for (const s of m.skills) list.append(el('dt', undefined, s.name), el('dd', undefined, skillValue(s.value)));
    const parts = [section('Skills', m.skills.length ? list : el('p', 'empty', 'No skills were learnt.'))];
    if (m.abilities.length) {
      const chips = el('div', 'deed-chips');
      for (const a of m.abilities) chips.append(el('span', 'deed-chip', a));
      parts.push(section('Abilities', chips));
    }
    return parts;
  }
  if (tab === 'end' && m) {
    const parts: HTMLElement[] = [];
    if (m.foe) {
      const foe = m.foe;
      parts.push(section('The foe', foeChip(foe, () => openFoe(sheets, foe))));
    }
    parts.push(section('The last moments', lastWordsList(m.lastWords)));
    return parts;
  }
  return heroTab(sheets, hero);
}

/** A fallen hero's sheet: who they were, what they carried, what they knew, and how they fell. */
export function openFallen(sheets: Sheets, hero: FallenHero, tab: FallenTab = 'hero', replace = false): void {
  const m = hero.memorial;
  const e = hero.entry;
  const tabs: FallenTab[] = m ? ['hero', 'gear', 'skills', 'end'] : ['hero'];
  const body = el('div', 'fallen');
  body.append(...build(sheets, hero, tab));
  const name = m?.name ?? e?.name ?? 'A hero';
  const race = m?.race ?? e?.race ?? '';
  const cls = m?.cls ?? e?.cls ?? '';
  const level = m?.level ?? e?.level ?? 0;
  const content: SheetContent = {
    title: name,
    subtitle: [`${race} ${cls}`.trim(), m?.title ?? '', level ? `Level ${level}` : ''].filter(Boolean).join(' · '),
    body,
    tabs: tabs.length > 1 ? tabBar(tab, (next) => openFallen(sheets, hero, next, true), tabs) : undefined,
    className: 'sheet-fallen',
  };
  if (replace) sheets.replace(content);
  else sheets.open(content);
}

/** Equipment worn at the end, as small glyph chips (for the end-of-game summary). */
export function gearStrip(items: readonly MemorialItem[], onOpen: () => void): HTMLElement {
  const strip = el('button', 'gear-strip');
  strip.type = 'button';
  strip.dataset.nav = '';
  for (const item of items.slice(0, 12)) {
    const g = glyph(item.ch, item.colour);
    g.title = item.name;
    strip.append(g);
  }
  strip.append(el('span', 'gear-strip-label', `${items.length} item${items.length === 1 ? '' : 's'} worn · see all`));
  strip.addEventListener('click', onOpen);
  return strip;
}
