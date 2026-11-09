import type { PropertyCensus, PropertySource, PropertyState } from '../render/snapshot.ts';
import type { Effect } from './effects.ts';
import { godNamed } from './gods.ts';
import { capitalise, titleName } from './text.ts';

/**
 * The census of the hero's properties on the character sheet: every bonus,
 * resistance, protection, trait and sense tome2 gives a hero, laid out in
 * pages and groups, each with the hero's state now and what gives it (from
 * `web_properties_json`). What each does follows tome2's rules (`calc_bonuses`,
 * the damage functions in spells1.cc, `process_world`).
 */

export type PropertyPage = 'bonuses' | 'defences' | 'traits' | 'senses';

/**
 * How a property reads: an element's grade (immune, resisted twice or
 * once, vulnerable), something had or not, a drawback (had is bad), or an
 * amount.
 */
type Kind = 'grade' | 'flag' | 'drawback' | 'number';

interface PropertyDef {
  id: string;
  label: string;
  kind: Kind;
  does: string;
  /** An amount as shown: its value, and what one source adds ("+10", "+30 ft"). */
  unit?: { value: (n: number) => string; share: (n: number) => string };
  /** The amount is capped, so the sources need not add up to it (no "Other" for the difference). */
  capped?: boolean;
  /** What the amount the sources do not account for is ("Base", "Birth"); else *Other*. */
  rest?: string;
}

/** How one source counts for a property. */
export interface SourceShare {
  /** The source, or null for what the sources listed do not account for. */
  source: PropertySource | null;
  /** How it counts, in a word or two ("+3", "Immune", "Resist", "Vulnerable"). */
  detail: string;
  /** Its turns left, for a timed effect. */
  turns: number | null;
  /** It gives the property but something else undoes it (a resistance cancelling a vulnerability). */
  cancelled: boolean;
}

export interface PropertyRow {
  id: string;
  label: string;
  does: string;
  /** The hero's state in a word or an amount ("Immune", "+3", "Yes", "—"). */
  state: string;
  tone: 'good' | 'bad' | 'off';
  /** Only timed effects give it. */
  temporary: boolean;
  /** What else is true of it now (cancelled out, all minds sensed). */
  note: string | null;
  shares: SourceShare[];
}

export interface PropertyGroup {
  title: string;
  rows: PropertyRow[];
}

const NONE = '—';

function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

const PLAIN = { value: signed, share: signed };
const PERCENT = { value: (n: number) => `${signed(n)}%`, share: (n: number) => `${signed(n)}%` };
const FEET = { value: (n: number) => `${n} ft`, share: (n: number) => `${signed(n)} ft` };
const LEVEL = { value: String, share: signed };

const STAT_DOES = (stat: string) => `What your race, class, gear and more add to your ${stat} or take from it.`;
const SUSTAIN_DOES = (stat: string) => `Keeps your ${stat} from being drained by attacks, traps and curses.`;
const ESP_DOES = (kind: string) => `You sense the minds of ${kind} near you, even through walls.`;

const BONUSES: [string, PropertyDef[]][] = [
  [
    'Attributes',
    [
      { id: 'str', label: 'Strength', kind: 'number', does: STAT_DOES('Strength') },
      { id: 'int', label: 'Intelligence', kind: 'number', does: STAT_DOES('Intelligence') },
      { id: 'wis', label: 'Wisdom', kind: 'number', does: STAT_DOES('Wisdom') },
      { id: 'dex', label: 'Dexterity', kind: 'number', does: STAT_DOES('Dexterity') },
      { id: 'con', label: 'Constitution', kind: 'number', does: STAT_DOES('Constitution') },
      { id: 'chr', label: 'Charisma', kind: 'number', does: STAT_DOES('Charisma') },
    ],
  ],
  [
    'Speed and skill',
    [
      { id: 'speed', label: 'Speed', kind: 'number', does: 'How much faster than normal you act: +10 is twice as many turns as a normal creature. A heavy load slows you.' },
      { id: 'stealth', label: 'Stealth', kind: 'number', does: 'What your gear, tactic and way of moving add to your stealth, which lets you pass sleeping creatures without waking them.' },
      { id: 'tunnel', label: 'Tunnelling', kind: 'number', does: 'What your gear adds to digging through rubble, veins and walls.' },
      { id: 'luck', label: 'Luck', kind: 'number', rest: 'Birth', does: 'Luck tips many rolls in your favour, from finding better items to avoiding harm.' },
    ],
  ],
  [
    'Fighting and magic',
    [
      { id: 'blows', label: 'Blows', kind: 'number', unit: LEVEL, does: 'The blows you strike each round of melee. With a weapon, your Strength and Dexterity against its weight give the base, up to a limit for your class; gear, your class and weapon mastery add more.' },
      { id: 'crit', label: 'Critical hits', kind: 'number', unit: PERCENT, does: 'Added to the chance in a hundred that your blows and shots land critical hits.' },
      { id: 'shots', label: 'Shots', kind: 'number', unit: LEVEL, rest: 'Base', does: 'The shots you fire each round with your launcher: one, and more from gear and archery skill.' },
      { id: 'might', label: 'Extra might', kind: 'number', does: 'Added to your launcher’s multiplier, so each missile hits harder.' },
      { id: 'spell', label: 'Spell power', kind: 'number', does: 'Added to the power of the spells you cast.' },
      { id: 'mana', label: 'Mana', kind: 'number', unit: PERCENT, does: 'How much your gear and traits add to your mana.' },
      { id: 'life', label: 'Health', kind: 'number', unit: PERCENT, does: 'How much your gear and traits add to your health.' },
    ],
  ],
];

const RESIST_TWICE = 'with a temporary resistance as well, to a ninth';

const DEFENCES: [string, PropertyDef[]][] = [
  [
    'Elements',
    [
      { id: 'acid', label: 'Acid', kind: 'grade', does: `Acid burns, damages your armour and items, and may lower your Charisma. Resisting cuts its damage to a third (${RESIST_TWICE}, and your items are safe); immunity stops it.` },
      { id: 'elec', label: 'Lightning', kind: 'grade', does: `Lightning burns, destroys items and may lower your Dexterity. Resisting cuts its damage to a third (${RESIST_TWICE}, and your items are safe); immunity stops it.` },
      { id: 'fire', label: 'Fire', kind: 'grade', does: `Fire burns, destroys items and may lower your Strength. Resisting cuts its damage to a third (${RESIST_TWICE}, and your items are safe); immunity stops it. Vulnerability doubles it, unless anything resists fire.` },
      { id: 'cold', label: 'Cold', kind: 'grade', does: `Cold freezes, shatters potions and may lower your Strength. Resisting cuts its damage to a third (${RESIST_TWICE}, and your items are safe); immunity stops it.` },
      { id: 'pois', label: 'Poison', kind: 'grade', does: `Poison hurts, poisons you and may lower your Constitution. Resisting cuts its damage to a third (${RESIST_TWICE}) and keeps you from being poisoned. Nothing makes you immune.` },
    ],
  ],
  [
    'Higher resistances',
    [
      { id: 'lite', label: 'Light', kind: 'grade', does: 'Light can blind you. Resisting cuts its damage by about half or more and stops the blinding. A race hurt by light takes three times as much; a resistance and that weakness cancel out.' },
      { id: 'dark', label: 'Darkness', kind: 'grade', does: 'Darkness can blind you. Resisting cuts its damage by about half or more and stops the blinding.' },
      { id: 'sound', label: 'Sound', kind: 'grade', does: 'Sound stuns you. Resisting cuts its damage by about a quarter to a half and stops the stunning, also from water, force and plasma.' },
      { id: 'shards', label: 'Shards', kind: 'grade', does: 'Shards cut you and break items. Resisting cuts the damage by up to half and stops the cuts.' },
      { id: 'nether', label: 'Nether', kind: 'grade', does: 'Nether drains your experience. Resisting cuts its damage by up to half and saves your experience; immunity stops it.' },
      { id: 'nexus', label: 'Nexus', kind: 'grade', does: 'Nexus teleports you about and can swap your attributes. Resisting cuts its damage by up to half and stops its effects.' },
      { id: 'chaos', label: 'Chaos', kind: 'grade', does: 'Chaos confuses you, makes you see things and drains experience. Resisting cuts its damage by up to half, stops the visions and the draining, and resists confusion too.' },
      { id: 'disen', label: 'Disenchantment', kind: 'grade', does: 'Disenchantment strips the magic from your gear. Resisting cuts its damage by up to half and keeps your gear as it is.' },
      { id: 'time', label: 'Time and space', kind: 'flag', does: 'Time and space hold steady around you: time does much less harm and none of its other effects, and no teleportation works on you or the creatures you would send away, yours or theirs.' },
    ],
  ],
  [
    'Immunities',
    [
      { id: 'fear', label: 'Fear', kind: 'flag', does: 'You are never frightened, which would stop you fighting in melee.' },
      { id: 'conf', label: 'Confusion', kind: 'flag', does: 'You are never confused, which would send you stumbling and stop you reading; confusion attacks also hurt you less. Resisting chaos does this too.' },
      { id: 'blind', label: 'Blindness', kind: 'flag', does: 'You are never blinded, which would stop you seeing, reading and casting from books. Light and darkness still hurt.' },
      { id: 'paralysis', label: 'Paralysis', kind: 'flag', does: 'Free action: creatures cannot paralyse you, put you to sleep or slow you with spells. You can still faint from hunger, or from casting without enough mana.' },
      { id: 'stun', label: 'Stunning', kind: 'flag', does: 'You cannot be stunned. Roots only shake a stun off at once, so a blow to the head can still dull your mind.' },
      { id: 'cuts', label: 'Cuts', kind: 'flag', does: 'Your body cannot be cut and does not bleed.' },
    ],
  ],
  [
    'Sustains',
    [
      { id: 'sustStr', label: 'Strength', kind: 'flag', does: SUSTAIN_DOES('Strength') },
      { id: 'sustInt', label: 'Intelligence', kind: 'flag', does: SUSTAIN_DOES('Intelligence') },
      { id: 'sustWis', label: 'Wisdom', kind: 'flag', does: SUSTAIN_DOES('Wisdom') },
      { id: 'sustDex', label: 'Dexterity', kind: 'flag', does: SUSTAIN_DOES('Dexterity') },
      { id: 'sustCon', label: 'Constitution', kind: 'flag', does: SUSTAIN_DOES('Constitution') },
      { id: 'sustChr', label: 'Charisma', kind: 'flag', does: SUSTAIN_DOES('Charisma') },
    ],
  ],
  [
    'Other defences',
    [
      { id: 'holdLife', label: 'Hold life', kind: 'flag', does: 'When something drains your experience you usually keep it all, and otherwise lose much less.' },
      { id: 'blackBreathResist', label: 'Resist Black Breath', kind: 'flag', does: 'The Black Breath, if it takes you, saps your experience far less often.' },
      { id: 'reflect', label: 'Reflection', kind: 'flag', does: 'Bolts and arrows aimed at you may bounce back at whoever sent them.' },
      { id: 'regen', label: 'Regeneration', kind: 'flag', does: 'You heal faster (twice as fast when lasting), but grow hungry faster.' },
      { id: 'auraFire', label: 'Fiery aura', kind: 'flag', does: 'Creatures that strike you in melee are burned.' },
      { id: 'auraElec', label: 'Electric aura', kind: 'flag', does: 'Creatures that strike you in melee are shocked.' },
      { id: 'invis', label: 'Invisibility', kind: 'number', unit: LEVEL, does: 'Creatures may fail to notice you: the higher it is against a creature’s level, the likelier. Invisible creatures and those a quest is after are never fooled. It makes you hungrier.' },
      { id: 'antimagicField', label: 'Anti-magic field', kind: 'number', unit: { value: (n) => `${n}%`, share: PERCENT.share }, does: 'Spells creatures cast within its reach fail this often, and you cannot cast spells or use wands, staffs and rods yourself.' },
    ],
  ],
];

const TRAITS: [string, PropertyDef[]][] = [
  [
    'Movement and body',
    [
      { id: 'feather', label: 'Levitation', kind: 'flag', does: 'You fall gently: trap doors and pits do you no harm.' },
      { id: 'fly', label: 'Flight', kind: 'flag', does: 'You fly over terrain you could not otherwise cross, such as deep water and trees, and fall gently.' },
      { id: 'climb', label: 'Climbing', kind: 'flag', does: 'You can climb mountains.' },
      { id: 'wraith', label: 'Incorporeal', kind: 'flag', does: 'You pass through walls, darkness heals you and earthquakes cannot crush you. It makes you hungrier. A race that is half a wraith passes through walls too, but is hurt doing so.' },
      { id: 'waterBreath', label: 'Water breathing', kind: 'flag', does: 'You can breathe underwater.' },
      { id: 'magicBreath', label: 'Breathe anywhere', kind: 'flag', does: 'You need no air at all, so you can breathe underwater and in the void.' },
      { id: 'slowDigest', label: 'Slow digestion', kind: 'flag', does: 'You need food less often.' },
    ],
  ],
  [
    'Drawbacks',
    [
      { id: 'aggravate', label: 'Aggravation', kind: 'drawback', does: 'Wakes the creatures around you and angers them.' },
      { id: 'teleport', label: 'Random teleportation', kind: 'drawback', does: 'Now and then you are teleported away (gear that is not cursed asks first).' },
      { id: 'noTeleport', label: 'No teleportation', kind: 'drawback', does: 'Nothing can teleport you, not even your own magic; Word of Recall still works.' },
      { id: 'noMagic', label: 'Anti-magic shell', kind: 'drawback', does: 'You cannot cast spells or use magic arts such as Mindcraft, Necromancy or Mimicry, though your saving throw is at least 95%.' },
      { id: 'drainExp', label: 'Experience drain', kind: 'drawback', does: 'Your experience slowly drains away.' },
      { id: 'drainMana', label: 'Mana drain', kind: 'drawback', does: 'Your mana drains away.' },
      { id: 'drainLife', label: 'Health drain', kind: 'drawback', does: 'Your health drains away.' },
      { id: 'blackBreath', label: 'Black Breath', kind: 'drawback', does: 'Now and then it saps your experience and an attribute, until it is cured.' },
      { id: 'tyCurse', label: 'Ancient curse', kind: 'drawback', does: 'Now and then it wakes creatures, summons foes, drains experience and attributes, or turns you to stone for a while.' },
      { id: 'dgCurse', label: 'Morgoth’s curse', kind: 'drawback', does: 'Now and then it curses your gear, drains experience, brings the Black Breath, paralyses or confuses you, and curses its item again.' },
      { id: 'autoCurse', label: 'Recursing gear', kind: 'drawback', does: 'Now and then its item curses itself again.' },
      { id: 'neverBlow', label: 'No melee', kind: 'drawback', does: 'You cannot attack in melee.' },
      { id: 'immovable', label: 'Immovable', kind: 'drawback', does: 'You cannot walk or run: you can only fight and act where you stand.' },
    ],
  ],
];

const SENSES: [string, PropertyDef[]][] = [
  [
    'Sight',
    [
      { id: 'seeInvis', label: 'See invisible', kind: 'flag', does: 'You see invisible creatures.' },
      { id: 'infra', label: 'Infravision', kind: 'number', unit: FEET, does: 'You see warm creatures in the dark this far away.' },
      { id: 'light', label: 'Light radius', kind: 'number', unit: LEVEL, capped: true, does: 'How far around you is lit, at most 5 (less on the world map). Lights that burn fuel give none once empty.' },
      { id: 'precog', label: 'Precognition', kind: 'flag', does: 'You are told what each new level holds: its special rooms and vaults, the uniques on it and its best items.' },
    ],
  ],
  [
    'Telepathy',
    [
      { id: 'esp', label: 'Telepathy', kind: 'flag', does: 'You sense the minds of every creature near you, even through walls (those without a mind stay hidden).' },
      { id: 'espOrc', label: 'Orcs', kind: 'flag', does: ESP_DOES('orcs') },
      { id: 'espTroll', label: 'Trolls', kind: 'flag', does: ESP_DOES('trolls') },
      { id: 'espGiant', label: 'Giants', kind: 'flag', does: ESP_DOES('giants') },
      { id: 'espDragon', label: 'Dragons', kind: 'flag', does: ESP_DOES('dragons') },
      { id: 'espDemon', label: 'Demons', kind: 'flag', does: ESP_DOES('demons') },
      { id: 'espUndead', label: 'Undead', kind: 'flag', does: ESP_DOES('the undead') },
      { id: 'espEvil', label: 'Evil', kind: 'flag', does: ESP_DOES('evil creatures') },
      { id: 'espGood', label: 'Good', kind: 'flag', does: ESP_DOES('good creatures') },
      { id: 'espAnimal', label: 'Animals', kind: 'flag', does: ESP_DOES('animals') },
      { id: 'espSpider', label: 'Spiders', kind: 'flag', does: ESP_DOES('spiders') },
      { id: 'espThunderlord', label: 'Thunderlords', kind: 'flag', does: ESP_DOES('Thunderlords') },
      { id: 'espNonliving', label: 'Non-living', kind: 'flag', does: ESP_DOES('non-living things') },
      { id: 'espUnique', label: 'Uniques', kind: 'flag', does: ESP_DOES('unique beings') },
    ],
  ],
];

const PAGES: Readonly<Record<PropertyPage, [string, PropertyDef[]][]>> = { bonuses: BONUSES, defences: DEFENCES, traits: TRAITS, senses: SENSES };

/* The timed elemental resistances, which the hero's effects list as one. */
const ELEMENT_EFFECTS = new Set(['resistAcid', 'resistElec', 'resistFire', 'resistCold', 'resistPois']);

/** The partial senses telepathy covers, left out while the hero has it. */
const PARTIAL_SENSES = /^esp./;

/** The hero's effect a source stands for: its timed effect (the elemental resistances are one), a form's, a body's. */
export function sourceEffect(source: PropertySource | null, effects: readonly Effect[]): Effect | undefined {
  const id = source?.effect;
  if (!id) return undefined;
  return effects.find((e) => e.id === id || (e.id === 'resistance' && ELEMENT_EFFECTS.has(id)));
}

/** A source by name, as the player reads it: the item without its article, the effect by its name, a form as a form. */
export function sourceName(source: PropertySource | null, effects: readonly Effect[]): string {
  if (!source) return 'Other';
  const name = source.name ?? '';
  switch (source.kind) {
    case 'item':
      return titleName(name);
    case 'effect':
      return sourceEffect(source, effects)?.name ?? capitalise(source.effect ?? '');
    case 'god':
      return godNamed(name)?.title ?? name;
    case 'form':
      return source.effect === 'body' ? `Body of ${name}` : `${capitalise(name)} form`;
    case 'tactic':
      return `Tactic: ${capitalise(name)}`;
    case 'movement':
      return `Movement: ${capitalise(name)}`;
    default:
      return capitalise(name);
  }
}

function gradeState(now: number): [string, PropertyRow['tone']] {
  if (now >= 3) return ['Immune', 'good'];
  if (now === 2) return ['Resist ×2', 'good'];
  if (now === 1) return ['Resist', 'good'];
  if (now < 0) return ['Vulnerable', 'bad'];
  return [NONE, 'off'];
}

function row(def: PropertyDef, state: PropertyState | undefined, census: PropertyCensus): PropertyRow {
  const from = state?.from ?? [];
  const sourceOf = (s: number) => census.sources[s] ?? null;
  const turnsOf = (s: number) => sourceOf(s)?.turns ?? null;
  const timed = (s: number) => sourceOf(s)?.kind === 'effect';
  const base = { id: def.id, label: def.label, does: def.does, temporary: false, note: null as string | null };

  if (def.kind === 'number') {
    const unit = def.unit ?? PLAIN;
    const shares: SourceShare[] = from.map((f) => ({ source: sourceOf(f.s), detail: unit.share(f.n ?? 0), turns: turnsOf(f.s), cancelled: false }));
    const sum = from.reduce((total, f) => total + (f.n ?? 0), 0);
    const value = state?.now ?? sum;
    if (state?.now !== undefined && !def.capped && value !== sum) shares.push({ source: def.rest ? { kind: 'stats', name: def.rest } : null, detail: unit.share(value - sum), turns: null, cancelled: false });
    const temporary = value !== 0 && from.length > 0 && from.every((f) => timed(f.s));
    if (def.id === 'blows' && census.blowsLimit !== undefined) {
      const raised = census.blowsRaised ? `, raised by ${census.blowsRaised === 1 ? 'an Extra Max Blow ability' : 'your Extra Max Blow abilities'}` : '';
      base.note = `Strength and Dexterity give you at most ${census.blowsLimit} blows with a weapon${raised}.`;
    }
    if (def.id === 'antimagicField' && value && census.antimagicRadius !== undefined) base.note = `It reaches ${census.antimagicRadius} grid${census.antimagicRadius === 1 ? '' : 's'} around you.`;
    return { ...base, temporary, state: value === 0 && !shares.length ? NONE : unit.value(value), tone: value > 0 ? 'good' : value < 0 ? 'bad' : 'off', shares };
  }

  const now = state?.now ?? 0;
  if (def.kind === 'grade') {
    const [text, tone] = gradeState(now);
    const resisting = from.filter((f) => f.as !== 'vulnerable');
    const weakened = from.some((f) => f.as === 'vulnerable');
    const shares = from.map((f): SourceShare => {
      const vulnerable = f.as === 'vulnerable';
      return {
        source: sourceOf(f.s),
        detail: f.as === 'immune' ? 'Immune' : vulnerable ? 'Vulnerable' : 'Resist',
        turns: turnsOf(f.s),
        cancelled: vulnerable ? now > 0 || (now === 0 && resisting.length > 0) : now === 0 && weakened,
      };
    });
    const cancelled = now === 0 && resisting.length > 0 && weakened;
    return {
      ...base,
      state: cancelled ? 'Cancelled' : text,
      tone,
      temporary: now === 1 && resisting.length > 0 && resisting.every((f) => timed(f.s)),
      note: cancelled ? 'Your resistance and your weakness cancel out.' : now > 0 && weakened ? 'Your resistance undoes your weakness.' : null,
      shares,
    };
  }

  const shares: SourceShare[] = from.map((f) => ({ source: sourceOf(f.s), detail: '', turns: turnsOf(f.s), cancelled: now === 0 }));
  if (now && !shares.length) shares.push({ source: null, detail: '', turns: null, cancelled: false });
  return {
    ...base,
    state: now ? 'Yes' : NONE,
    tone: now ? (def.kind === 'drawback' ? 'bad' : 'good') : 'off',
    temporary: !!now && from.length > 0 && from.every((f) => timed(f.s)),
    note: !now && from.length ? 'Not in force now.' : null,
    shares,
  };
}

/** A page of the census: its groups, each property with the hero's state and what gives it. Partial senses give way to telepathy. */
export function propertyGroups(census: PropertyCensus, page: PropertyPage): PropertyGroup[] {
  const states = new Map(census.props.map((p) => [p.id, p]));
  const telepathic = (states.get('esp')?.now ?? 0) > 0;
  return PAGES[page].map(([title, defs]) => ({
    title,
    rows: defs
      .filter((def) => !(telepathic && PARTIAL_SENSES.test(def.id)))
      .map((def) => {
        const built = row(def, states.get(def.id), census);
        if (def.id === 'esp' && telepathic) built.note = 'You sense every kind of mind.';
        return built;
      }),
  }));
}
