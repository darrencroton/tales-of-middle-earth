import type { BirthData, BirthEntry, BirthSkill } from '../render/snapshot.ts';
import type { BirthStep } from './birth.ts';

export const STAT_NAMES = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR'] as const;

export interface BirthTrait {
  /** Character level it is gained at (1 = from the start). */
  level: number;
  text: string;
  /** Explanation, for abilities and powers. */
  detail?: string;
  tone: 'good' | 'bad' | '';
}

export interface BirthDetails {
  title: string;
  paragraphs: string[];
  experimental: boolean;
  /** Stat adjustments, in STAT_NAMES order (empty when the step has none). */
  stats: { name: string; value: number }[];
  facts: { label: string; value: string; tone?: 'good' | 'bad' }[];
  traits: BirthTrait[];
  skills: { name: string; value: string; tone: 'good' | 'bad' | '' }[];
  /** Classes a race can take, or gods a specialisation can follow. */
  choices: { label: string; values: string[] } | null;
}

const OBJECT_FLAGS: Readonly<Record<string, string>> = {
  STR: 'Strength',
  INT: 'Intelligence',
  WIS: 'Wisdom',
  DEX: 'Dexterity',
  CON: 'Constitution',
  CHR: 'Charisma',
  SPEED: 'Speed',
  STEALTH: 'Stealth',
  INFRA: 'Infravision',
  LUCK: 'Luck',
  RES_LITE: 'Resists light',
  RES_DARK: 'Resists darkness',
  RES_BLIND: 'Resists blindness',
  RES_POIS: 'Resists poison',
  RES_DISEN: 'Resists disenchantment',
  RES_ELEC: 'Resists lightning',
  RES_COLD: 'Resists cold',
  RES_FIRE: 'Resists fire',
  RES_ACID: 'Resists acid',
  RES_NETHER: 'Resists nether',
  RES_NEXUS: 'Resists nexus',
  RES_SHARDS: 'Resists shards',
  RES_SOUND: 'Resists sound',
  RES_CHAOS: 'Resists chaos',
  RES_CONF: 'Resists confusion',
  RES_FEAR: 'Fearless',
  IM_ELEC: 'Immune to lightning',
  IM_FIRE: 'Immune to fire',
  IM_COLD: 'Immune to cold',
  IM_ACID: 'Immune to acid',
  IM_NETHER: 'Immune to nether',
  SUST_STR: 'Strength cannot be drained',
  SUST_INT: 'Intelligence cannot be drained',
  SUST_WIS: 'Wisdom cannot be drained',
  SUST_DEX: 'Dexterity cannot be drained',
  SUST_CON: 'Constitution cannot be drained',
  SUST_CHR: 'Charisma cannot be drained',
  FREE_ACT: 'Cannot be paralysed',
  HOLD_LIFE: 'Resists experience drain',
  SEE_INVIS: 'Sees invisible creatures',
  REGEN: 'Heals quickly',
  SLOW_DIGEST: 'Needs little food',
  FEATHER: 'Falls gently',
  FLY: 'Flies',
  LITE1: 'Gives off light',
  ESP_ORC: 'Senses orcs',
  ESP_TROLL: 'Senses trolls',
  ESP_EVIL: 'Senses evil',
  ESP_DRAGON: 'Senses dragons',
  ESP_GIANT: 'Senses giants',
  ESP_DEMON: 'Senses demons',
  ESP_UNDEAD: 'Senses undead',
  ESP_ANIMAL: 'Senses animals',
  ESP_ALL: 'Senses all minds',
  XTRA_MIGHT: 'Extra might with launchers',
  XTRA_SHOTS: 'Extra shots',
  CRIT: 'More critical hits',
  CLIMB: 'Climbs mountains',
  SENS_FIRE: 'Vulnerable to fire',
  IMMOVABLE: 'Cannot move',
  AGGRAVATE: 'Angers nearby creatures',
  DRAIN_EXP: 'Slowly loses experience',
  TELEPORT: 'Teleports at random',
  NO_TELE: 'Cannot teleport',
  BLACK_BREATH: 'Carries the Black Breath',
};

const BAD_FLAGS = new Set(['SENS_FIRE', 'IMMOVABLE', 'AGGRAVATE', 'DRAIN_EXP', 'TELEPORT', 'NO_TELE', 'BLACK_BREATH']);

/* Flags whose strength is the level's pval ("+1 speed"). */
const PVAL_FLAGS = new Set(['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR', 'SPEED', 'STEALTH', 'INFRA', 'LUCK']);

const RACE_FLAGS: Readonly<Record<string, [string, 'good' | 'bad' | '']>> = {
  RESIST_BLACK_BREATH: ['Resists the Black Breath', 'good'],
  NO_STUN: ['Cannot be stunned', 'good'],
  XTRA_MIGHT_BOW: ['Extra might with bows', 'good'],
  XTRA_MIGHT_XBOW: ['Extra might with crossbows', 'good'],
  XTRA_MIGHT_SLING: ['Extra might with slings', 'good'],
  AC_LEVEL: ['Armour improves with level', 'good'],
  HURT_LITE: ['Hurt by bright light', 'bad'],
  VAMPIRE: ['A vampire: drinks blood to live', ''],
  UNDEAD: ['Undead', ''],
  NO_CUT: ['Cannot bleed', 'good'],
  CORRUPT: ['Gains corruptions over time', ''],
  NO_FOOD: ['Gains little from food', ''],
  NO_GOD: ['Cannot worship a god', 'bad'],
  ELF: ['Elven', ''],
  SEMI_WRAITH: ['Passes through walls, at a cost', ''],
  GOD_FRIEND: ['Favoured by the gods', 'good'],
  EASE_STEAL: ['Gains experience by stealing', 'good'],
  ASTRAL: ['Begins as a spirit in the halls of Mandos', ''],
};

function humanise(flag: string): string {
  const text = flag.toLowerCase().replace(/_/g, ' ');
  return text[0].toUpperCase() + text.slice(1);
}

/** A tome2 object flag as a short phrase ("Resists light", "+1 Speed"). */
export function flagText(flag: string, pval: number): { text: string; tone: 'good' | 'bad' } {
  const name = OBJECT_FLAGS[flag] ?? humanise(flag);
  if (PVAL_FLAGS.has(flag) && pval) return { text: `${pval > 0 ? '+' : '−'}${Math.abs(pval)} ${name}`, tone: pval > 0 ? 'good' : 'bad' };
  return { text: name, tone: BAD_FLAGS.has(flag) ? 'bad' : 'good' };
}

/** A skill value in thousandths as tome2 shows it, trimmed ("1.5", "16"). */
export function skillNumber(thousandths: number): string {
  return (thousandths / 1000).toFixed(3).replace(/\.?0+$/, '');
}

function skillText(skill: BirthSkill): { value: string; tone: 'good' | 'bad' | '' } | null {
  const parts: string[] = [];
  let tone: 'good' | 'bad' | '' = '';
  if (skill.base) {
    const n = skillNumber(skill.base);
    if (skill.op === '-') {
      parts.push(`−${n}`);
      tone = 'bad';
    } else if (skill.op === '=') {
      parts.push(`set to ${n}`);
    } else if (skill.op === '%') {
      parts.push(`×${skill.base}%`);
    } else {
      parts.push(`+${n}`);
      tone = 'good';
    }
  }
  if (skill.mod) {
    const n = skillNumber(skill.mod);
    const per = skill.modOp === '-' ? `−${n}` : skill.modOp === '%' ? `×${skill.mod}%` : `+${n}`;
    parts.push(`${per} per point`);
    if (!tone) tone = skill.modOp === '-' ? 'bad' : 'good';
  }
  return parts.length ? { value: parts.join(' · '), tone } : null;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
}

/** The engine entry for a birth option, matched by its label. */
export function findBirthEntry(data: BirthData, step: BirthStep, label: string): BirthEntry | null {
  const same = (e: BirthEntry) => e.title.trim().toLowerCase() === label.trim().toLowerCase();
  switch (step) {
    case 'race':
      return data.races.find(same) ?? null;
    case 'modifier':
      return data.mods.find(same) ?? (label === 'Classical' ? (data.mods.find((m) => m.index === 0) ?? null) : null);
    case 'class':
      return data.classes.find(same) ?? null;
    case 'specialisation':
      for (const c of data.classes) {
        const spec = c.specs?.find(same);
        if (spec) return spec;
      }
      return null;
    default:
      return null;
  }
}

/** What a race, modifier, class or specialisation gives, ready to show. */
export function birthDetails(entry: BirthEntry, step: BirthStep): BirthDetails {
  const experimental = entry.flags.includes('EXPERIMENTAL');
  const stats = entry.stats?.some((v) => v !== 0) ? STAT_NAMES.map((name, i) => ({ name, value: entry.stats?.[i] ?? 0 })) : [];

  const facts: BirthDetails['facts'] = [];
  if (entry.hitDie) facts.push({ label: step === 'class' ? 'Extra hit dice' : 'Hit dice', value: `d${entry.hitDie}` });
  if (entry.exp) facts.push({ label: 'Experience needed', value: `${step === 'race' ? '' : '+'}${entry.exp}%`, tone: entry.exp > 150 ? 'bad' : undefined });
  if (entry.infra) facts.push({ label: 'Infravision', value: `${entry.infra * 10} ft`, tone: 'good' });
  if (entry.luck) facts.push({ label: 'Luck', value: signed(entry.luck), tone: entry.luck > 0 ? 'good' : 'bad' });
  if (entry.mana && entry.mana !== 100) facts.push({ label: 'Mana', value: `${entry.mana}%`, tone: entry.mana > 100 ? 'good' : 'bad' });
  if (entry.blows) facts.push({ label: 'Most blows', value: String(entry.blows + (entry.extraBlows ?? 0)) });

  const traits: BirthTrait[] = [];
  for (const flag of entry.flags) {
    const known = RACE_FLAGS[flag];
    if (known) traits.push({ level: 1, text: known[0], tone: known[1] });
  }
  for (const lf of entry.levelFlags ?? []) {
    for (const flag of lf.flags) {
      const { text, tone } = flagText(flag, lf.pval);
      traits.push({ level: Math.max(1, lf.level), text, tone });
    }
  }
  for (const power of entry.powers ?? []) traits.push({ level: 1, text: power.name, detail: power.desc, tone: 'good' });
  for (const ability of entry.abilities) traits.push({ level: Math.max(1, ability.level), text: ability.name, detail: ability.desc, tone: 'good' });
  traits.sort((a, b) => a.level - b.level);

  const skills: BirthDetails['skills'] = [];
  for (const skill of entry.skills) {
    const text = skillText(skill);
    if (text) skills.push({ name: skill.name, ...text });
  }
  skills.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'good' ? -1 : b.tone === 'good' ? 1 : a.tone === 'bad' ? 1 : -1));

  const choices = entry.classes?.length
    ? { label: 'Classes', values: entry.classes }
    : entry.gods?.length
      ? { label: 'Gods', values: entry.gods }
      : null;

  return {
    title: entry.title || 'Classical',
    paragraphs: paragraphs(entry.desc),
    experimental,
    stats,
    facts,
    traits,
    skills,
    choices,
  };
}
