import { parseRows, type ChoiceBlock, type TermRow } from '../ui/termparse.ts';

/** tome2 colour indices used on the birth screens. */
const TERM_SLATE = 2;
const TERM_BLUE = 6;
const TERM_YELLOW = 11;

export type BirthStep = 'race' | 'modifier' | 'class' | 'specialisation' | 'god';

export interface BirthOption {
  key: string;
  label: string;
  current: boolean;
  /** Drawn greyed out by tome2: experimental, or not suited to the race. */
  unusual: boolean;
}

export interface BirthChoiceScreen {
  step: BirthStep;
  options: BirthOption[];
  /** Description of the option under tome2's cursor. */
  description: string[];
  /** Name, race and class chosen so far. */
  summary: { label: string; value: string }[];
}

const STEPS: [RegExp, BirthStep][] = [
  [/Choose a race modifier/, 'modifier'],
  [/Choose a race \(/, 'race'],
  [/Choose a class specialisation/, 'specialisation'],
  [/Choose a class \(/, 'class'],
  [/Choose a god/, 'god'],
];

export const STEP_TITLES: Record<BirthStep, string> = {
  race: 'Choose your race',
  modifier: 'Choose a race modifier',
  class: 'Choose your class',
  specialisation: 'Choose a specialisation',
  god: 'Choose a god',
};

/** Recognises a tome2 birth menu (race, class, god...) and reads its options. */
export function parseBirthChoice(rows: readonly TermRow[], screen: string): BirthChoiceScreen | null {
  const step = STEPS.find(([pattern]) => pattern.test(screen))?.[1];
  if (!step) return null;
  const lines = screen.split('\n');
  const promptRow = lines.findIndex((line) => /Choose a /.test(line));
  if (promptRow < 0) return null;

  const blocks = parseRows(rows.slice(promptRow + 1), promptRow + 1, 0, 79);
  const options: BirthOption[] = blocks
    .filter((b): b is ChoiceBlock => b.kind === 'choice')
    .map((c) => {
      const attr = c.label.runs[0]?.attr ?? 1;
      return { key: c.key, label: c.label.text.trim(), current: c.current, unusual: attr === TERM_SLATE || attr === TERM_BLUE };
    });
  if (options.length === 0) return null;

  const description: string[] = [];
  let paragraph = '';
  for (let y = 9; y < promptRow; y++) {
    const row = rows[y];
    let text = '';
    let yellow = false;
    for (let x = 0; x < 80; x++) {
      const ch = row.chars[x];
      if (ch === 0x20 || ch === 0) {
        text += ' ';
        continue;
      }
      if (row.attrs[x] === TERM_YELLOW) yellow = true;
      text += String.fromCharCode(ch);
    }
    text = text.trim();
    if (!yellow || !text) {
      if (paragraph) description.push(paragraph);
      paragraph = '';
      continue;
    }
    paragraph = paragraph ? `${paragraph} ${text}` : text;
  }
  if (paragraph) description.push(paragraph);

  const summary: { label: string; value: string }[] = [];
  for (const line of lines.slice(0, 8)) {
    const m = /^\s*(Name|Race|Class|God)\s*:\s*(.*?)\s*$/.exec(line.slice(0, 40));
    if (m && m[2]) summary.push({ label: m[1], value: m[2] });
  }

  return { step, options, description, summary };
}

/** Cursor keys that move tome2's selection from the current option to `target` ('6' steps forward and wraps). */
export function cursorKeysTo(options: readonly BirthOption[], target: string): string {
  const from = options.findIndex((o) => o.current);
  const to = options.findIndex((o) => o.key === target);
  if (from < 0 || to < 0 || from === to) return '';
  const n = options.length;
  const forward = (to - from + n) % n;
  const back = (from - to + n) % n;
  return forward <= back ? '6'.repeat(forward) : '4'.repeat(back);
}

export interface SavefileEntry {
  letter: string;
  name: string;
}

/** Saved characters listed on tome2's "New Character / Load Savefile" screen. */
export function parseSavefileScreen(rows: readonly TermRow[], screen: string): SavefileEntry[] | null {
  if (!/To play you will need a character/.test(screen)) return null;
  return parseRows(rows.slice(6), 6, 0, 79)
    .filter((b): b is ChoiceBlock => b.kind === 'choice')
    .map((c) => ({ letter: c.key, name: c.label.text.trim() }))
    .filter((e) => e.name !== 'New Character' && e.name !== 'Load Savefile');
}

export interface SaveRecord {
  module: string;
  alive: boolean;
  base: string;
  description: string;
}

/** Parses tome2's global.svg savefile index ("module@1base@description" per line). */
export function parseSaveIndex(text: string): SaveRecord[] {
  const records: SaveRecord[] = [];
  for (const line of text.split('\n')) {
    const m = /^(?:([^@]*)@)?([01])([^@]*)@(.*)$/.exec(line.trim());
    if (!m) continue;
    records.push({ module: m[1] ?? 'ToME', alive: m[2] === '1', base: m[3], description: m[4] });
  }
  return records;
}

/** True when a savefile index description ("Grodon, the Ent Warrior is dead") is of this race and class. */
export function describesHero(description: string, race: string, cls: string): boolean {
  return description.includes(`, the ${`${race} ${cls}`.trim()} is `);
}

/** Savefile names: up to 15 characters that make a valid file name. */
export function validCharacterName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Please enter a name.';
  if (trimmed.length > 15) return 'Names can be at most 15 characters.';
  if (!/^[A-Za-z][A-Za-z0-9 '\-]*$/.test(trimmed)) return 'Use letters, digits, spaces, hyphens or apostrophes, starting with a letter.';
  return null;
}
