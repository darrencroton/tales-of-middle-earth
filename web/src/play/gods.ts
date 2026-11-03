/**
 * The gods of ToME as their followers meet them: what each grants and at what
 * piety, what pleases and angers them, and what following them costs. In our
 * words, from tome2's rules (xtra1.cc calc_gods and calc_mana, dungeon.cc,
 * xtra2.cc, melee1.cc, cmd1.cc, cmd2.cc, spells6.cc); the altar, the tome of
 * prayers and the prayers themselves come from the engine (`GodData`). Also
 * the altar's macros: worship, and Melkor's offerings.
 */

import { KEY_BACKSLASH, keyCodes } from '../input/keys.ts';
import type { Macro, MacroScreen } from './macro.ts';

export interface GodGift {
  text: string;
  /** The piety it needs; none when following is enough. */
  piety?: number;
  /** Only while praying. */
  praying?: boolean;
}

export interface God {
  /** tome2's name. */
  name: string;
  /** The name as our UI writes it. */
  title: string;
  /** Who they are, in a line. */
  epithet: string;
  gifts: GodGift[];
  /** What comes with following them, whatever the piety. */
  burdens: string[];
  pleases: string[];
  angers: string[];
  /** Schools of magic their followers' Prayer skill lends levels in: [school, share of the Prayer skill]. */
  schools: [string, string][];
}

/** The One Ring ends the worship of every god but Melkor. */
const forsaken = (who: string) => `Wearing the One Ring: ${who} forsakes you, and your piety is lost.`;

export const GODS: readonly God[] = [
  {
    name: 'Eru Iluvatar',
    title: 'Eru Ilúvatar',
    epithet: 'The One, who made the world and most who dwell in it.',
    gifts: [
      {
        text: 'More mana as piety grows, up to 35% more at 35,000',
        piety: 100,
      },
      { text: 'Wisdom +1, rising to +3 at 30,000', piety: 10000 },
      {
        text: 'May turn aside the blows of evil creatures, more often as piety grows',
        praying: true,
        piety: 1,
      },
      {
        text: 'May raise you from death (a 70% chance)',
        praying: true,
        piety: 100000,
      },
    ],
    burdens: ['Swords, axes and polearms that are not blessed: −15 to hit and to damage, and spells fail more often.', 'Below nothing, piety shrinks your mana instead.', forsaken('Eru')],
    pleases: ['Time spent adventuring while not praying: piety grows by itself, faster with more Wisdom (not while resting or on the world map).'],
    angers: ['Slaying good creatures.', 'Destroying blessed items.'],
    schools: [
      ['Mana', '½'],
      ['Divination', '⅔'],
      ['Mind', '⅓'],
    ],
  },
  {
    name: 'Manwe Sulimo',
    title: 'Manwë Súlimo',
    epithet: 'King of the Valar, lord of the winds and of the eagles.',
    gifts: [
      { text: 'Feather fall', piety: 2000 },
      {
        text: 'Speed +1 for every 5,000 piety, up to +7',
        praying: true,
        piety: 5000,
      },
      { text: 'Free action', praying: true, piety: 7000 },
      { text: 'Flight', praying: true, piety: 15000 },
    ],
    burdens: [forsaken('Manwë')],
    pleases: ['Slaying evil creatures while praying.'],
    angers: ['Time in the dungeon: piety slowly fades, faster while praying, slower with more Wisdom and for Elves.', 'Slaying good creatures.'],
    schools: [
      ['Air', '⅔'],
      ['Conveyance', '½'],
      ['Meta', '⅓'],
    ],
  },
  {
    name: 'Tulkas',
    title: 'Tulkas',
    epithet: 'The champion of the Valar, who delights in wrestling and in strength.',
    gifts: [
      { text: 'Constitution +1, rising to +3 at 15,000', piety: 5000 },
      { text: 'Strength +1, rising to +3 at 20,000', piety: 10000 },
      {
        text: 'Your blows strike harder, and his hand may double their force',
        praying: true,
      },
    ],
    burdens: [forsaken('Tulkas')],
    pleases: ['Slaying evil creatures, more so while praying.', 'Slaying demons while praying, most of all.'],
    angers: ['Praying in the dungeon: piety fades while you pray, slower with more Wisdom.'],
    schools: [['Earth', '⅘']],
  },
  {
    name: 'Melkor Bauglir',
    title: 'Melkor Bauglir',
    epithet: 'Morgoth, the Dark Enemy, once the mightiest of the Valar.',
    gifts: [
      { text: 'Resistance to fire' },
      { text: 'Udun, his dark school of magic, opens to you' },
      {
        text: 'Strength, Constitution and Charisma +1, rising to +3 at 30,000',
        piety: 10000,
      },
      { text: 'Invisibility', praying: true, piety: 5000 },
      { text: 'Immunity to fire', praying: true, piety: 15000 },
      {
        text: 'May curse the foes you strike, once his Curse is at level 10',
        praying: true,
        piety: 5000,
      },
      {
        text: 'May call demons or the undead to your aid when you are badly hurt',
        praying: true,
        piety: 5000,
      },
    ],
    burdens: ['As piety grows, Intelligence and Wisdom fall with it, by up to 3.', 'Destroying the One Ring: he forsakes you. One who wears it cannot begin to follow him.'],
    pleases: ['Slaying any creature, good ones above all.', 'Offerings at his altar: corpses, books of other magic, and your own life, for piety or for lasting strength.'],
    angers: ['Time in the dungeon: piety drains quickly, faster while praying, slower with more Wisdom, faster for Elves.'],
    schools: [['Mind', '⅓']],
  },
  {
    name: 'Yavanna Kementari',
    title: 'Yavanna Kementári',
    epithet: 'Queen of the Earth and giver of fruits, who made the plants and beasts and woke the Ents.',
    gifts: [
      { text: 'Heal far faster standing on grass', praying: true },
      { text: 'Walk through trees', praying: true, piety: 9000 },
    ],
    burdens: [forsaken('Yavanna')],
    pleases: ['Slaying the undead, demons and nonliving things.', 'Charming or taming animals that are not evil.', 'Freeing Mirkwood of its spiders.'],
    angers: [
      'Time in the dungeon: piety slowly fades, slower with more Wisdom.',
      'Slaying anything while praying; animals far worse.',
      'Burning or destroying trees.',
      'Your animal companions turning against you.',
    ],
    schools: [
      ['Water', '½'],
      ['Earth', '½'],
      ['Nature', '½'],
      ['Temporal', '⅙'],
    ],
  },
];

/** tome2's name for having no god. */
export const NO_GOD = 'Nobody';

export function godNamed(name: string | undefined): God | null {
  return GODS.find((g) => g.name === name) ?? null;
}

/** A god's name as our UI writes it ("No god" for tome2's Nobody, and its birth screen's No God). */
export function godTitle(name: string): string {
  return name === NO_GOD || /^no god$/i.test(name) ? 'No god' : (godNamed(name)?.title ?? name);
}

/** The hero's standing with their god. */
export interface Faith {
  piety: number;
  praying: boolean;
}

/** Whether a gift is the hero's now. */
export function giftActive(gift: GodGift, faith: Faith): boolean {
  return (!gift.praying || faith.praying) && faith.piety >= (gift.piety ?? Number.NEGATIVE_INFINITY);
}

const MELKOR = 'Melkor Bauglir';

/** What an altar offers the hero: worship for one without a god, offerings for Melkor's followers at his; tome2 does nothing at any other. */
export function altarAction(altarGod: string | undefined, heroGod: string, faithless: boolean): 'worship' | 'offer' | null {
  if (!altarGod) return null;
  if (!heroGod) return faithless ? null : 'worship';
  return heroGod === altarGod && altarGod === MELKOR ? 'offer' : null;
}

/** Follows the god of the altar underfoot: tome2 tells of them, then asks. */
export function* worshipMacro(): Macro {
  const s: MacroScreen = yield [KEY_BACKSLASH, ...keyCodes('O')];
  if (/^Do you want to worship/.test(s.prompt)) yield keyCodes('y');
}

export type Offering = 'item' | 'piety' | 'strength';

/** An offering at Melkor's altar: an item (tome2's item question follows), or 10 of the hero's health for piety or for might; tome2 asks of their life only when they have more than 10. */
export function* offeringMacro(kind: Offering): Macro {
  const s: MacroScreen = yield [KEY_BACKSLASH, ...keyCodes('O')];
  if (!/sacrifice a part of yourself/.test(s.prompt)) return;
  const next: MacroScreen = yield keyCodes(kind === 'item' ? 'n' : 'y');
  if (kind !== 'item' && /more piety instead of damage/.test(next.prompt)) yield keyCodes(kind === 'piety' ? 'y' : 'n');
}
