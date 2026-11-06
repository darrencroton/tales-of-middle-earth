import type { EffectState, PlayerState } from '../render/snapshot.ts';

/** An ailment, a blessing (timed or conditional) or a power the hero keeps going. */
export type EffectKind = 'bane' | 'boon' | 'sustained';

export type EffectUnit = 'turn' | 'blow' | 'step' | 'kill';

/** An effect as the player reads it: the HUD's chip, the character summary's row and the effect's card. */
export interface Effect {
  /** Unique among the hero's effects. */
  key: string;
  id: string;
  kind: EffectKind;
  icon: string;
  /** Two letters for the HUD's tile ("DS", "Ha"). */
  abbr: string;
  name: string;
  /** How much is left, when it counts down. */
  left: { count: number; unit: EffectUnit } | null;
  /** How strong it is, in a few words ("Armour −290", "Speed +10"). */
  strength: string | null;
  /** What it does. */
  does: string;
  /** What ends it. */
  ends: string;
  /** A blessing about to run out. */
  fading: boolean;
  /** An ailment that is dangerous now. */
  severe: boolean;
}

/** A blessing with this many turns (or blows, or steps) left or fewer is fading. */
export const FADING = 5;

/* tome2's thresholds (defines.hpp), and its names for cuts and stuns (prt_cut, prt_stun). */
const FOOD_HUNGRY = 2000;
const FOOD_WEAK = 1000;
const FOOD_FAINT = 500;
const FOOD_STARVE = 100;
const MORTAL_WOUND = 1000;
const KNOCKED_OUT = 100;
const HEAVY_STUN = 50;
const CUTS: [number, string][] = [
  [MORTAL_WOUND, 'Mortal wound'],
  [200, 'Deep gash'],
  [100, 'Severe cut'],
  [50, 'Nasty cut'],
  [25, 'Bad cut'],
  [10, 'Light cut'],
  [0, 'Graze'],
];

const ELEMENTS: Readonly<Record<string, string>> = {
  resistAcid: 'acid',
  resistElec: 'lightning',
  resistFire: 'fire',
  resistCold: 'cold',
  resistPois: 'poison',
};

function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

function listed(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A count with its unit: "1 turn", "3 blows". */
export function countText(count: number, unit: EffectUnit): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function cutName(level: number): string {
  return CUTS.find(([above]) => level > above)?.[1] ?? 'Graze';
}

function stunName(level: number): string {
  return level > KNOCKED_OUT ? 'Knocked out' : level > HEAVY_STUN ? 'Heavy stun' : 'Stunned';
}

/** A name's initials: "Doom shield" → "DS". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

/** What a shield is, by what it does: Doom Shield alone lowers armour, Armor of Fear alone frightens, Fiery Shield alone burns. */
function shieldName(e: EffectState): string {
  if ((e.armour ?? 0) < 0) return 'Doom shield';
  if (e.aura === 'fear') return 'Armour of fear';
  if (e.aura === 'fire' || e.aura === 'greatFire') return 'Fiery shield';
  return 'Mystic shield';
}

function shieldDoes(e: EffectState): string {
  const armour = e.armour ?? 0;
  const parts = [armour < 0 ? `Lowers your armour by ${-armour}.` : `Raises your armour by ${armour}.`];
  if (e.aura === 'counter') parts.push(`Creatures that strike you in melee are bashed for ${e.dice} damage.`);
  if (e.aura === 'fire') parts.push(`Creatures that strike you in melee are burned for ${e.dice} damage, unless fire cannot hurt them.`);
  if (e.aura === 'greatFire') parts.push(`Creatures that strike you in melee are burned for ${e.dice} damage, even those fire cannot hurt.`);
  if (e.aura === 'fear') parts.push('Creatures that strike you in melee may flee in fear (never uniques).');
  return parts.join(' ');
}

interface Entry {
  kind: EffectKind;
  /** Two letters for the HUD's tile. */
  abbr: string | ((e: EffectState) => string);
  icon: string;
  name: string | ((e: EffectState) => string);
  strength?: (e: EffectState) => string | null;
  does: string | ((e: EffectState) => string);
  ends: string | ((e: EffectState) => string);
  severe?: (e: EffectState) => boolean;
}

const TIMED_OUT = 'It wears off in time.';

/** Every effect tome2 can put on the hero, in the order they are listed: ailments first, the most pressing at the top. */
const CATALOGUE: Readonly<Record<string, Entry>> = {
  paralyzed: { abbr: 'Pa', kind: 'bane', icon: '■', name: 'Paralysed', does: 'You cannot move or act.', ends: TIMED_OUT, severe: () => true },
  stun: {
    abbr: (e) => ((e.level ?? 0) > KNOCKED_OUT ? 'KO' : 'St'),
    kind: 'bane',
    icon: '✶',
    name: (e) => stunName(e.level ?? 0),
    strength: (e) => ((e.level ?? 0) > HEAVY_STUN ? 'To hit −20, damage −20' : 'To hit −5, damage −5'),
    does: (e) =>
      (e.level ?? 0) > KNOCKED_OUT
        ? 'You are knocked out and cannot act. Your blows land worse and do less harm.'
        : 'Your blows land worse and do less harm. A heavier stun can knock you out.',
    ends: 'It wears off, faster with good Constitution; healing magic ends it.',
    severe: (e) => (e.level ?? 0) > KNOCKED_OUT,
  },
  cut: {
    abbr: 'Cu',
    kind: 'bane',
    icon: '♥',
    name: (e) => cutName(e.level ?? 0),
    does: 'You lose health each turn while the wound bleeds, more for a worse wound.',
    ends: (e) =>
      (e.level ?? 0) > MORTAL_WOUND
        ? 'A mortal wound never closes by itself: only healing magic can close it.'
        : 'It closes by itself, faster with good Constitution; healing magic closes it.',
    severe: (e) => (e.level ?? 0) > 200,
  },
  hunger: {
    abbr: 'Hu',
    kind: 'bane',
    icon: '◔',
    name: (e) => ((e.level ?? 0) < FOOD_STARVE ? 'Starving' : (e.level ?? 0) < FOOD_FAINT ? 'Fainting' : (e.level ?? 0) < FOOD_WEAK ? 'Weak' : 'Hungry'),
    does: (e) => {
      const food = e.level ?? 0;
      if (food < FOOD_STARVE) return 'Hunger is killing you: you lose health each turn and do not heal.';
      if (food < FOOD_FAINT) return 'You heal slowly and may faint from hunger, helpless for a few turns.';
      if (food < FOOD_WEAK) return 'You heal more slowly. Soon you will faint from hunger.';
      return 'You need to eat soon.';
    },
    ends: 'Eat something.',
    severe: (e) => (e.level ?? 0) < FOOD_FAINT,
  },
  blind: { abbr: 'Bl', kind: 'bane', icon: '◌', name: 'Blind', does: 'You cannot see, read scrolls or cast most spells.', ends: TIMED_OUT },
  confused: { abbr: 'Cf', kind: 'bane', icon: '✺', name: 'Confused', does: 'You may stumble the wrong way, and cannot read scrolls or cast most spells.', ends: TIMED_OUT },
  afraid: { abbr: 'Af', kind: 'bane', icon: '!', name: 'Afraid', does: 'You are too frightened to fight in melee.', ends: TIMED_OUT },
  poisoned: {
    abbr: 'Po',
    kind: 'bane',
    icon: '☣',
    name: 'Poisoned',
    does: 'You lose a little health each turn.',
    ends: 'It wears off, faster with good Constitution; curing magic ends it.',
  },
  hallucinating: { abbr: 'Hl', kind: 'bane', icon: '◎', name: 'Hallucinating', does: 'You see creatures and things as they are not.', ends: TIMED_OUT },
  slow: { abbr: 'Sl', kind: 'bane', icon: '↓', name: 'Slowed', strength: () => 'Speed −10', does: 'You act more slowly than usual.', ends: TIMED_OUT },
  blackBreath: {
    abbr: 'BB',
    kind: 'bane',
    icon: '☁',
    name: 'Black Breath',
    does: 'Now and then it drains your experience and an attribute.',
    ends: 'It lasts until cured.',
    severe: () => true,
  },
  parasite: {
    abbr: 'Ps',
    kind: 'bane',
    icon: '✱',
    name: 'Something grows within',
    does: 'Something is growing inside you.',
    ends: 'When its time comes it will most likely burst out as a hostile creature, unless something cures you first.',
  },
  drained: {
    abbr: (e) => `${(e.stat ?? '?').charAt(0)}−`,
    kind: 'bane',
    icon: '▽',
    name: (e) => `Weakened ${e.stat ?? ''}`.trim(),
    does: (e) => `Your ${e.stat ?? 'attribute'} is lowered for a time.`,
    ends: 'It returns by itself when this runs out.',
  },
  undead: {
    abbr: 'Ud',
    kind: 'bane',
    icon: '☠',
    name: 'Undead form',
    does: 'Your health is death points: you lose one each turn, cannot rest, and die when they run out.',
    ends: (e) => `Slay ${e.kills ?? 0} more creature${e.kills === 1 ? '' : 's'} to be brought back to life.`,
    severe: () => true,
  },

  invuln: {
    abbr: 'In',
    kind: 'boon',
    icon: '◉',
    name: 'Invulnerable',
    strength: () => 'Armour +100',
    does: 'Almost nothing can hurt you.',
    ends: 'It breaks at once when you attack, shoot, throw, or use a skill or power.',
  },
  disruption: {
    abbr: 'Dr',
    kind: 'boon',
    icon: '◇',
    name: 'Disruption shield',
    does: 'Harm is taken from your mana instead of your health, two mana for each point.',
    ends: 'It breaks at once when you attack, shoot, throw, or use a skill or power.',
  },
  shield: { abbr: (e) => initials(shieldName(e)), kind: 'boon', icon: '◈', name: shieldName, strength: (e) => `Armour ${signed(e.armour ?? 0)}`, does: shieldDoes, ends: TIMED_OUT },
  lightspeed: { abbr: 'LS', kind: 'boon', icon: '↯', name: 'Light speed', strength: () => 'Speed +50', does: 'Time all but stops around you.', ends: TIMED_OUT },
  fast: { abbr: 'Ha', kind: 'boon', icon: '»', name: 'Hasted', strength: (e) => `Speed ${signed(e.speed ?? 10)}`, does: 'You act faster than usual.', ends: TIMED_OUT },
  wraith: {
    abbr: 'Wr',
    kind: 'boon',
    icon: '◐',
    name: 'Wraith form',
    does: 'You pass through walls; your armour rises (by 50, or by 10 when disembodied) and, in a body, you reflect bolts.',
    ends: TIMED_OUT,
  },
  shero: {
    abbr: 'Bz',
    kind: 'boon',
    icon: '⚔',
    name: 'Berserk',
    strength: () => 'To hit +24, armour −10',
    does: 'A battle rage: your blows land better, you gain 30 health and know no fear, but are easier to hit.',
    ends: TIMED_OUT,
  },
  hero: { abbr: 'He', kind: 'boon', icon: '✪', name: 'Heroism', strength: () => 'To hit +12', does: 'Your blows land better, you gain 10 health and know no fear.', ends: TIMED_OUT },
  blessed: { abbr: 'Bs', kind: 'boon', icon: '✚', name: 'Blessed', strength: () => 'To hit +10, armour +5', does: 'Your blows land better and you are harder to hit.', ends: TIMED_OUT },
  holy: { abbr: 'Ho', kind: 'boon', icon: '☀', name: 'Holy aura', strength: () => 'Luck +5', does: 'Your life cannot be drained, your light reaches further and luck is on your side.', ends: TIMED_OUT },
  strike: { abbr: 'TS', kind: 'boon', icon: '➹', name: 'True strike', strength: () => 'To hit +15, damage +15', does: 'Your attacks land better and harder.', ends: TIMED_OUT },
  deadly: { abbr: 'Dl', kind: 'boon', icon: '✸', name: 'Deadly blows', does: 'Each blow that lands is a great hit, three times as hard.', ends: 'It is spent blow by blow.' },
  protevil: {
    abbr: 'PE',
    kind: 'boon',
    icon: '✠',
    name: 'Protection from evil',
    does: 'Evil creatures no stronger than you are often repelled when they strike you in melee.',
    ends: TIMED_OUT,
  },
  reflect: { abbr: 'Rf', kind: 'boon', icon: '↩', name: 'Reflection', does: 'Bolts aimed at you are often turned back.', ends: TIMED_OUT },
  resistance: {
    abbr: 'Rs',
    kind: 'boon',
    icon: '❂',
    name: 'Resistance',
    does: (e) => `You resist ${e.element}: the harm is cut to a third, or a ninth with a lasting resistance as well.`,
    ends: TIMED_OUT,
  },
  resistChaos: { abbr: 'RC', kind: 'boon', icon: '❂', name: 'Resist chaos', does: 'You resist chaos and cannot be confused.', ends: TIMED_OUT },
  roots: {
    abbr: 'Rt',
    kind: 'boon',
    icon: '♣',
    name: 'Roots',
    strength: (e) => `Armour ${signed(e.armour ?? 0)}, damage ${signed(e.damage ?? 0)}`,
    does: 'You are rooted to the spot and cannot move or be stunned, but strike harder in melee and are harder to hit.',
    ends: TIMED_OUT,
  },
  project: {
    abbr: (e) => `${(e.element || 'M').charAt(0).toUpperCase()}b`,
    kind: 'boon',
    icon: '✧',
    name: (e) => `${capitalise(e.element || 'Magic')} blows`,
    strength: (e) => `${e.damage} damage${(e.radius ?? 0) > 0 ? `, radius ${e.radius}` : ''}`,
    does: (e) => `Each blow that lands also strikes with ${e.element || 'magic'} for ${e.damage} damage${(e.radius ?? 0) > 0 ? ` around it (radius ${e.radius})` : ''}.`,
    ends: TIMED_OUT,
  },
  poisonHands: { abbr: 'PB', kind: 'boon', icon: '☣', name: 'Poisoned blows', does: 'Your blows poison creatures that poison can hurt.', ends: TIMED_OUT },
  thunder: {
    abbr: 'Th',
    kind: 'boon',
    icon: '↯',
    name: 'Thunderstorm',
    strength: (e) => `${e.dice} damage`,
    does: (e) => `Each turn lightning strikes a foe in sight for ${e.dice} damage, as lightning, light and sound.`,
    ends: TIMED_OUT,
  },
  regen: { abbr: 'Rg', kind: 'boon', icon: '❦', name: 'Regeneration', strength: (e) => `Power ${e.power}`, does: 'You heal much faster, and grow hungry faster.', ends: TIMED_OUT },
  absorbSoul: { abbr: 'AS', kind: 'boon', icon: '❖', name: 'Absorb soul', does: 'Each living creature you slay heals you.', ends: TIMED_OUT },
  invisible: {
    abbr: 'Iv',
    kind: 'boon',
    icon: '◌',
    name: 'Invisible',
    strength: (e) => `Power ${e.power}`,
    does: 'Creatures weaker than its power may not see you (dragons, demons, undead and animals see better). You grow hungry faster.',
    ends: TIMED_OUT,
  },
  probability: {
    abbr: 'PT',
    kind: 'boon',
    icon: '⇵',
    name: 'Probability travel',
    does: 'Walking into a wall takes you through to the other side; stairs are not needed to go up or down.',
    ends: TIMED_OUT,
  },
  flight: { abbr: 'Fl', kind: 'boon', icon: '⤒', name: 'Flying', does: 'You fly over some terrain, such as water and lava, and falls do you no harm.', ends: TIMED_OUT },
  levitation: { abbr: 'Lv', kind: 'boon', icon: '⤒', name: 'Levitating', does: 'You float gently: falls do you no harm.', ends: TIMED_OUT },
  waterBreath: { abbr: 'WB', kind: 'boon', icon: '≈', name: 'Water breathing', does: 'You can breathe under water.', ends: TIMED_OUT },
  magicBreath: { abbr: 'MB', kind: 'boon', icon: '≈', name: 'Magical breathing', does: 'You can breathe anywhere, even without air or under water.', ends: TIMED_OUT },
  telepathy: { abbr: 'Tp', kind: 'boon', icon: '◎', name: 'Telepathy', does: 'You sense the minds of creatures around you, even unseen.', ends: TIMED_OUT },
  seeInvisible: { abbr: 'SI', kind: 'boon', icon: '◑', name: 'See invisible', does: 'You can see invisible creatures.', ends: TIMED_OUT },
  infravision: { abbr: 'If', kind: 'boon', icon: '◒', name: 'Infravision', strength: () => '+10 ft', does: 'You see warm creatures further in the dark.', ends: TIMED_OUT },
  light: { abbr: 'Br', kind: 'boon', icon: '☼', name: 'Brightness', strength: () => 'Light +2', does: 'Your light reaches further.', ends: TIMED_OUT },
  precognition: { abbr: 'Pc', kind: 'boon', icon: '☾', name: 'Precognition', does: 'You foresee the remarkable things made on each new level.', ends: TIMED_OUT },
  confusing: { abbr: 'CT', kind: 'boon', icon: '✦', name: 'Confusing touch', does: 'Your hands glow red: your next blow that lands confuses its target.', ends: 'It is spent by that blow.' },
  noBreeds: { abbr: 'Sy', kind: 'boon', icon: '⊘', name: 'Sterility', does: 'Creatures that breed cannot multiply.', ends: TIMED_OUT },
  tread: { abbr: 'DT', kind: 'boon', icon: '≈', name: 'Dripping tread', does: 'Each step you take leaves water behind you.', ends: 'It is spent step by step, or by casting it again.' },
  recall: {
    abbr: 'Rc',
    kind: 'boon',
    icon: '⇅',
    name: 'Recall',
    does: (e) => (e.up ? 'Word of Recall will lift you out of the dungeon to the surface.' : 'Word of Recall will take you down into the dungeon.'),
    ends: 'You are taken away when it runs out; reading Word of Recall again cancels it.',
  },
  mimicLegs: { abbr: 'XL', kind: 'boon', icon: '♙', name: 'Extra legs', does: 'Mimicry gives you another pair of legs, to wear more on them.', ends: TIMED_OUT },
  mimicArms: { abbr: 'XA', kind: 'boon', icon: '♙', name: 'Extra arms', does: 'Mimicry gives you another pair of arms, to wear more on them.', ends: TIMED_OUT },
  mimicWall: { abbr: 'WA', kind: 'boon', icon: '▦', name: 'Wall affinity', does: 'Mimicry lets you pass into walls.', ends: TIMED_OUT },

  praying: { abbr: 'Pr', kind: 'sustained', icon: '☼', name: 'Praying', does: 'Your god’s gifts that need prayer are with you while you pray.', ends: 'It lasts until you stop praying.' },
  song: {
    abbr: 'So',
    kind: 'sustained',
    icon: '♪',
    name: (e) => e.spell ?? 'Song',
    strength: (e) => `${e.mana} mana a turn`,
    does: (e) => `You keep singing ${e.spell ?? 'a song'}, its magic at work each turn.`,
    ends: 'It lasts until you stop singing, or your mana runs out.',
  },
  inertia: {
    abbr: 'IC',
    kind: 'sustained',
    icon: '↻',
    name: (e) => `Inertia control: ${e.spell ?? ''}`,
    strength: (e) => `${e.mana} mana held`,
    does: (e) => `${e.spell ?? 'A spell'} is cast for you every ${countText(e.every ?? 0, 'turn')} (the next in ${countText(e.next ?? 0, 'turn')}). It holds back ${e.mana} of your mana.`,
    ends: 'It lasts until you cast Inertia Control again to cancel it.',
  },
  spellbinder: {
    abbr: 'Sb',
    kind: 'sustained',
    icon: '❡',
    name: 'Spellbinder',
    strength: (e) => `At ${e.at}% health`,
    does: (e) => `${listed(e.spells ?? [])} will be cast at once when your health falls to ${e.at}% or below.`,
    ends: 'It is spent when it is released.',
  },
  mimic: { abbr: (e) => (e.form ?? 'Fo').slice(0, 2), kind: 'sustained', icon: '♞', name: (e) => `${e.form ?? 'Changed'} form`, does: (e) => `You have taken the shape of ${e.form ? `a ${e.form.toLowerCase()}` : 'another creature'}.`, ends: 'You change back when it runs out.' },
  body: { abbr: (e) => (e.form ?? 'Bo').slice(0, 2), kind: 'sustained', icon: '♞', name: (e) => e.form ?? 'Borrowed body', does: (e) => `You have taken over the body of ${e.form ?? 'a creature'}, with its powers and weaknesses.`, ends: 'It lasts until you leave the body.' },
};

const BOONS_FIRST: Readonly<Record<EffectKind, number>> = { bane: 0, boon: 1, sustained: 2 };

function describe(key: string, id: string, e: EffectState): Effect | null {
  const entry = CATALOGUE[id];
  if (!entry) return null;
  const count = e.turns ?? e.blows ?? e.steps ?? e.kills;
  const unit: EffectUnit = e.turns !== undefined ? 'turn' : e.blows !== undefined ? 'blow' : e.steps !== undefined ? 'step' : 'kill';
  const left = count !== undefined && count > 0 ? { count, unit } : null;
  const text = (value: string | ((e: EffectState) => string)) => (typeof value === 'string' ? value : value(e));
  return {
    key,
    id,
    kind: entry.kind,
    icon: entry.icon,
    abbr: text(entry.abbr),
    name: text(entry.name),
    left,
    strength: entry.strength?.(e) ?? null,
    does: text(entry.does),
    ends: text(entry.ends),
    fading: entry.kind !== 'bane' && left !== null && left.unit !== 'kill' && left.count <= FADING,
    severe: entry.severe?.(e) ?? false,
  };
}

/** The elemental resistances in force, as one: they come together (Resistance, a potion of resistance) and mean one thing; it lasts as long as the first to end. */
function resistance(effects: readonly EffectState[]): Effect | null {
  const found = effects.filter((e) => ELEMENTS[e.id]);
  if (!found.length) return null;
  const turns = Math.min(...found.map((e) => e.turns ?? 0));
  const effect = describe('resistance', 'resistance', { id: 'resistance', turns, element: listed(found.map((e) => ELEMENTS[e.id])) })!;
  if (found.some((e) => e.turns !== turns)) effect.ends = `Each wears off in time: ${listed(found.map((e) => `${ELEMENTS[e.id]} in ${countText(e.turns ?? 0, 'turn')}`))}.`;
  return effect;
}

/** The effects in force on the hero, as the player reads them: ailments (the dangerous first), then blessings, then what they keep going. */
export function heroEffects(player: Pick<PlayerState, 'effects' | 'pray'> & Partial<Pick<PlayerState, 'food'>>): Effect[] {
  const states = player.effects ?? [];
  const all: Effect[] = [];
  if (player.food !== undefined && isHungry({ food: player.food })) all.push(describe('hunger', 'hunger', { id: 'hunger', level: player.food })!);
  for (const e of states) {
    if (ELEMENTS[e.id]) continue;
    const effect = describe(e.stat ? `${e.id}:${e.stat}` : e.id, e.id, e);
    if (effect) all.push(effect);
  }
  const resist = resistance(states);
  if (resist) all.push(resist);
  if (player.pray === 2) all.push(describe('praying', 'praying', { id: 'praying' })!);
  const order = Object.keys(CATALOGUE);
  return all.sort((a, b) => BOONS_FIRST[a.kind] - BOONS_FIRST[b.kind] || Number(b.severe) - Number(a.severe) || order.indexOf(a.id) - order.indexOf(b.id));
}

/** Whether the hero needs to eat (tome2's Hungry, or worse). */
export function isHungry(player: Pick<PlayerState, 'food'>): boolean {
  return player.food < FOOD_HUNGRY;
}

/** Whether the hero is under an effect (by tome2's id: `confused`, `stun`, `hallucinating`…). */
export function hasEffect(player: Pick<PlayerState, 'effects'> | null | undefined, id: string): boolean {
  return !!player?.effects?.some((e) => e.id === id);
}

/** Blessings and sustained powers in `from` that are not in `to` (prayer left out: it has its own card): those begun, or those faded. */
export function blessingsGone(from: readonly Effect[], to: readonly Effect[]): Effect[] {
  const still = new Set(to.map((e) => e.key));
  return from.filter((e) => e.kind !== 'bane' && e.id !== 'praying' && !still.has(e.key));
}
