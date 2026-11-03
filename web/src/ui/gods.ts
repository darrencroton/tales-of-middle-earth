import { commandKeys } from '../play/actions.ts';
import { altarAction, giftActive, GODS, godNamed, godTitle, offeringMacro, worshipMacro, type Faith, type God, type Offering } from '../play/gods.ts';
import type { GodData, PlayerState } from '../render/snapshot.ts';
import { NOT_NOW, type GameApi } from './api.ts';
import { count, el, iconText, navButton } from './dom.ts';
import type { RecentAction } from '../play/recent.ts';
import { spellText } from './inspect.ts';
import { magicSpellRow } from './magic.ts';
import type { SheetAction, Sheets } from './sheet.ts';

/** Melkor's offerings at his altar, as Sacrifice offers them. */
const OFFERINGS: readonly [Offering, string][] = [
  ['item', 'Offer an item'],
  ['piety', 'Give life for piety'],
  ['strength', 'Give life for might'],
];

/* tome2 lets the hero give of their life only above 10 health, current and most. */
const LIFE_GIVEN = 10;

function list(className: string, items: readonly string[]): HTMLElement {
  const node = el('ul', `god-list ${className}`);
  for (const text of items) node.append(el('li', undefined, text));
  return node;
}

interface GodCardOptions {
  /** The hero's standing with this god, their own: the gifts they have now are lit. */
  faith?: Faith | null;
  /** The god's name heads the card (not in a sheet, whose header has it). */
  titled?: boolean;
  /** The hero's own prayers in the books they carry, as rows to pray them from, by name. */
  prayable?: ReadonlyMap<string, HTMLElement>;
}

/**
 * Who a god is and what following them means: their gifts and the piety each
 * needs (with `faith`, those the hero has now are lit), what comes with them,
 * what pleases and angers them, the prayers of their tome (those the hero can
 * pray from a book they carry as rows to pray them from, the others where they
 * are written) and the schools of magic they lend levels in.
 */
export function godCard(god: God, data: GodData | null, options: GodCardOptions = {}): HTMLElement {
  const { faith = null, titled = true, prayable } = options;
  const card = el('article', 'birth-card god-card');
  if (titled) card.append(el('h3', undefined, god.title));
  card.append(el('p', 'god-epithet', god.epithet));

  const gifts = el('ul', 'birth-traits god-gifts');
  for (const gift of god.gifts) {
    const item = el('li', !faith || giftActive(gift, faith) ? 'good' : 'dim');
    const piety = gift.piety && gift.piety > 1 ? count(gift.piety) : '';
    item.append(el('span', 'trait-level', piety || (gift.praying ? 'Praying' : 'Always')), el('span', 'trait-text', gift.text));
    if (gift.praying && piety) item.append(el('span', 'trait-detail', 'While praying'));
    gifts.append(item);
  }
  card.append(el('h4', undefined, faith ? 'Gifts · lit when yours' : 'Gifts · piety needed'), gifts);
  card.append(el('h4', undefined, 'Following them'), list('bad', god.burdens));
  card.append(el('h4', undefined, 'Pleased by'), list('good', god.pleases));
  if (god.angers.length) card.append(el('h4', undefined, 'Angered by'), list('bad', god.angers));

  if (data?.prayers?.length) {
    card.append(el('h4', undefined, 'Prayers'));
    const rows = data.prayers.map((p) => prayable?.get(p.name)).filter((row): row is HTMLElement => !!row);
    if (rows.length) {
      const list = el('div', 'menu-list god-prayers');
      list.append(...rows);
      card.append(list);
    }
    const others = data.prayers.filter((p) => !prayable?.has(p.name));
    if (others.length) {
      const prayers = el('ul', 'birth-traits');
      for (const prayer of others) {
        const item = el('li');
        item.append(el('span', 'trait-level', `Level ${prayer.skill}`), el('span', 'trait-text', prayer.name));
        const text = spellText(prayer.desc);
        if (text) item.append(el('span', 'trait-detail', text));
        prayers.append(item);
      }
      const where = data.book ? `the ${data.book}` : 'their tome';
      const note = !prayable
        ? `Written in ${where}. Prayers are cast with piety and grow with the Prayer skill.`
        : rows.length
          ? `Not in a book you carry: written in ${where}, or in a book of a single prayer.`
          : `You carry no book of these prayers: they are written in ${where}, or in a book of a single prayer. Prayers are cast with piety and grow with the Prayer skill.`;
      card.append(el('p', 'god-note', note), prayers);
    }
  }
  const schools = god.schools.map(([school, share]) => `${school} (${share})`).join(', ');
  card.append(el('h4', undefined, 'Magic'), el('p', 'god-note', `Your Prayer skill also lends levels in ${schools}: the share of it shown, spells cast with mana.`));
  return card;
}

/** The card for having no god, at the start or in help. */
export function godlessCard(): HTMLElement {
  const card = el('article', 'birth-card god-card');
  card.append(
    el('h3', undefined, 'No god'),
    el('p', undefined, 'Begin without a god. You may kneel at an altar later and follow the god it is raised to, unless you have learnt Antimagic.'),
    el('p', undefined, 'A god, once followed, is yours for good: only the One Ring or Antimagic ends it.'),
  );
  return card;
}

function godData(data: readonly GodData[] | undefined, name: string): GodData | null {
  return data?.find((g) => g.name === name) ?? null;
}

interface GodSheet {
  faith?: Faith | null;
  prayable?: ReadonlyMap<string, HTMLElement>;
  subtitle?: string;
  /** Said under the details. */
  note?: string;
  actions?: SheetAction[];
}

function openGodSheet(sheets: Sheets, god: God, data: GodData | null, options: GodSheet = {}): void {
  const body = el('div', 'help-birth');
  body.append(godCard(god, data, { faith: options.faith, titled: false, prayable: options.prayable }));
  if (options.note) body.append(el('p', 'god-note', options.note));
  sheets.open({
    title: god.title,
    subtitle: options.subtitle,
    badge: el('span', 'help-badge', iconText('☼')),
    body,
    kind: 'card',
    className: 'sheet-god',
    actions: options.actions ?? [],
  });
}

/** Every god of the game, each a row opening their card (help). */
export function godRows(sheets: Sheets, data: readonly GodData[] | undefined): HTMLElement[] {
  return GODS.map((god) =>
    navButton(god.title, {
      icon: '☼',
      hint: god.epithet,
      onClick: () => openGodSheet(sheets, god, godData(data, god.name)),
    }),
  );
}

/** The hero's standing with their god, or null without one. */
function heroFaith(api: GameApi): { god: God; faith: Faith } | null {
  const p = api.state()?.player;
  const god = godNamed(p?.god);
  return p && god ? { god, faith: { piety: p.piety ?? 0, praying: p.pray === 2 } } : null;
}

/* The gods' altars, tomes and prayers, which do not change: read once. */
let godsData: readonly GodData[] | undefined;

function engineGod(api: GameApi, name: string): GodData | null {
  godsData ??= api.engine.birthData()?.gods;
  return godData(godsData, name);
}

/** How the hero stands with their god, in a line: "1,234 piety · praying". */
export function faithLine(faith: Faith): string {
  return `${count(faith.piety)} piety · ${faith.praying ? 'praying' : 'not praying'}`;
}

/** Why the hero cannot give tome2 a command now, from a card: busy with something else, on the world map or controlling a creature. */
function heroRefusal(api: GameApi, command: string): string | null {
  return api.snapshot()?.atCommand ? api.refusal(command) : NOT_NOW;
}

function prayAction(api: GameApi, praying: boolean): SheetAction {
  return {
    id: 'pray',
    label: praying ? 'Stop praying' : 'Pray',
    icon: '☼',
    unavailable: heroRefusal(api, 'p'),
    run: () => api.send(commandKeys({ command: 'p' })),
  };
}

/** The hero's prayers to `god` in the books they carry, as the Magic panel's rows (a tap prays, ⓘ opens the card), by name. */
function prayableRows(api: GameApi, god: God): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  const handlers = { run: (entry: RecentAction, anyway?: boolean) => api.cast(entry, anyway) };
  for (const spell of api.engine.spells()?.books.flatMap((b) => b.spells) ?? []) {
    if (spell.god === god.name && !rows.has(spell.name)) rows.set(spell.name, magicSpellRow(api, spell, handlers));
  }
  return rows;
}

/** The hero's god (from the character sheet and the HUD): what they grant now, the prayers they can pray now, and Pray or Stop praying. */
export function openHeroGod(api: GameApi): void {
  const hero = heroFaith(api);
  if (!hero) return;
  openGodSheet(api.sheets, hero.god, engineGod(api, hero.god.name), {
    faith: hero.faith,
    prayable: prayableRows(api, hero.god),
    subtitle: `Your god · ${faithLine(hero.faith)}`,
    actions: [prayAction(api, hero.faith.praying)],
  });
}

/* Why a hero cannot follow a god (tome2: a race that worships none, or any Antimagic). */
const FAITHLESS: Readonly<Record<NonNullable<PlayerState['faithless']>, string>> = {
  race: 'Your people worship no gods.',
  antimagic: 'You do not believe in gods: Antimagic has closed that road.',
};

/**
 * The god of an altar (the look card, and Kneel at altar where the hero
 * stands): their card, with Worship for a hero without a god, Melkor's
 * offerings for his followers at his altar (each only `here`, on the altar),
 * and why nothing else can be done.
 */
export function openAltarGod(api: GameApi, name: string, here: boolean): void {
  const god = godNamed(name);
  const p = api.state()?.player;
  if (!god || !p) return;
  const data = engineGod(api, god.name);
  const mine = p.god === god.name;
  const faith = mine ? { piety: p.piety ?? 0, praying: p.pray === 2 } : null;
  const subtitle = `${data?.altar ?? 'Altar'}${faith ? ` · ${faithLine(faith)}` : ''}`;
  const sheet: GodSheet = { faith, subtitle, prayable: mine ? prayableRows(api, god) : undefined };
  const action = altarAction(name, p.god ?? '', !!p.faithless);
  const refused = heroRefusal(api, 'O');
  if (!p.god && p.faithless) {
    sheet.note = FAITHLESS[p.faithless];
  } else if (action && !here) {
    sheet.note = action === 'worship' ? `Stand on the altar to worship ${god.title}.` : 'Stand on his altar to make offerings.';
  } else if (action === 'worship') {
    sheet.note = 'Your piety begins a little below nothing and grows as you please them. A god, once followed, is yours for good: only the One Ring or Antimagic ends it.';
    sheet.actions = [{ id: 'worship', label: `Worship ${god.title}`, icon: '☼', primary: true, unavailable: refused, run: () => api.runMacro(worshipMacro()) }];
  } else if (action === 'offer') {
    const weak = p.chp <= LIFE_GIVEN || p.mhp <= LIFE_GIVEN ? 'You have too little life left to give.' : null;
    sheet.note = `Each gift of life takes ${LIFE_GIVEN} health for good: for piety (more with Wisdom), or for might, a lasting gain in damage. An item may be a corpse or a book holding no Udun spells.`;
    sheet.actions = OFFERINGS.map(([kind, label]) => ({
      id: `offer-${kind}`,
      label,
      unavailable: refused ?? (kind === 'item' ? null : weak),
      run: () => api.runMacro(offeringMacro(kind)),
    }));
  } else if (mine) {
    sheet.note = `${god.title} asks no offerings at the altar.`;
  } else if (p.god) {
    sheet.note = `You follow ${godTitle(p.god)}. A god, once followed, is yours for good.`;
  }
  if (mine && !sheet.actions) sheet.actions = [prayAction(api, p.pray === 2)];
  openGodSheet(api.sheets, god, data, sheet);
}
