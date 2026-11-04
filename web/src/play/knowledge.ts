import { FEET_PER_LEVEL } from '../render/snapshot.ts';

/** A creature race as the knowledge lists show it: its index (for its recall), name, glyph and level. */
export interface KnownRace {
  r: number;
  name: string;
  ch: number;
  attr: number;
  level: number;
}

/** What tome2's knowledge menu lists (`web_knowledge_json`). */
export interface Knowledge {
  /** Artifacts found, in tome2's order (by kind). */
  artifacts: { name: string; ch: number; attr: number }[];
  /** Every unique tome2 lists, by level, slain or not. */
  uniques: (KnownRace & { dead: number })[];
  /** Each kind of creature slain, with how many (a unique once). */
  kills: (KnownRace & { count: number; unique: number })[];
  /** Dungeons with a recall depth; `recall` marks the one Word of Recall leads to. */
  recall: { dungeon: string; depth: number; recall: number }[];
  /** Dungeon towns found. */
  towns: { dungeon: string; depth: number }[];
  corruptions: { name: string; attr: number; desc: string }[];
  /** Fates known, as tome2 tells them; `fatesUnknown` when there are others. */
  fates: string[];
  fatesUnknown: number;
  /** The lines of the hero's notes file. */
  notes: string[];
}

/** What a note records: the player's own, an artifact identified, a level reached, a unique slain, the hero's birth or victory. */
export type NoteKind = 'note' | 'artifact' | 'level' | 'unique' | 'born' | 'won';

export interface Note {
  kind: NoteKind;
  text: string;
  /** Game turn, and depth (0 on the surface); unknown for the birth and victory. */
  turn?: number;
  depth?: number;
}

const NOTE_CODES: Readonly<Record<string, NoteKind>> = { ' ': 'note', A: 'artifact', L: 'level', U: 'unique' };

/* tome2's add_note: "Turn %12ld" padded to 20, "  Town" or "Lev%3d", the code, then the text. */
const NOTE_LINE = /^Turn\s+(\d+)\s+(?:Town|Lev\s*(\d+))\s(.):\s?(.*)$/;

/**
 * The notes file as notes, oldest first: dated lines, the hero's birth and a
 * victory; session banners left out. tome2 keeps one file for a name, so a
 * hero begun under the name of an earlier one shares it: only what follows
 * the last birth is this hero's.
 */
export function parseNotes(file: readonly string[]): Note[] {
  let born = file.length;
  while (born > 0 && !/^Born on /.test(file[born - 1])) born--;
  const lines = file.slice(Math.max(0, born - 2));
  const notes: Note[] = [];
  lines.forEach((line, i) => {
    const m = NOTE_LINE.exec(line);
    if (m) {
      notes.push({ kind: NOTE_CODES[m[3]] ?? 'note', text: m[4].trim(), turn: Number(m[1]), depth: Number(m[2] ?? 0) });
    } else if (/^Born on /.test(line) && i > 0 && lines[i - 1].trim()) {
      notes.push({ kind: 'born', text: `${lines[i - 1].trim()} is born.` });
    } else if (/ slew Morgoth on /.test(line)) {
      notes.push({ kind: 'won', text: line.replace(/ on .*$/, '.').trim() });
    }
  });
  return notes;
}

/* Game turns in a day, and the turn the clock starts from (tome2's DAY, DAY_START and bst). */
const DAY_TURNS = 10 * 11520;
const START_TURNS = 10 * 2880;

/** The day of the adventure a game turn falls on (the first is day 1). */
export function adventureDay(turn: number): number {
  return Math.floor((turn + START_TURNS) / DAY_TURNS) + 1;
}

/** When and where a note was written: "Day 2 · 150 ft", "Day 1 · on the surface". */
export function noteWhen(note: Note): string {
  if (note.turn === undefined) return '';
  const where = note.depth ? `${note.depth * FEET_PER_LEVEL} ft` : 'on the surface';
  return `Day ${adventureDay(note.turn)} · ${where}`;
}

/** Notes newest first, as a journal is read back. */
export function journal(lines: readonly string[]): Note[] {
  return parseNotes(lines).reverse();
}

/**
 * Uniques as the player looks for them: those slain, the latest first (tome2
 * notes each kill of a unique), then those still at large, by level as the
 * engine lists them (tome2's order, Morgoth last).
 */
export function uniqueGroups(knowledge: Pick<Knowledge, 'uniques' | 'notes'>): { slain: Knowledge['uniques']; alive: Knowledge['uniques'] } {
  const killed = new Map<string, number>();
  parseNotes(knowledge.notes).forEach((note, i) => {
    if (note.kind === 'unique') killed.set(note.text.replace(/^Killed /, ''), i);
  });
  const when = (name: string) => killed.get(name) ?? -1;
  const slain = knowledge.uniques.filter((u) => u.dead).sort((a, b) => when(b.name) - when(a.name) || b.level - a.level);
  return { slain, alive: knowledge.uniques.filter((u) => !u.dead) };
}

/** Kills, mightiest first (tome2 keeps no time for them), and how many creatures that makes. */
export function killList(knowledge: Pick<Knowledge, 'kills'>): { kills: Knowledge['kills']; total: number } {
  const kills = [...knowledge.kills].sort((a, b) => b.level - a.level || b.count - a.count || a.name.localeCompare(b.name));
  return { kills, total: kills.reduce((n, k) => n + k.count, 0) };
}

/** Recall depths, the dungeon Word of Recall leads to first. */
export function recallList(knowledge: Pick<Knowledge, 'recall'>): Knowledge['recall'] {
  return [...knowledge.recall].sort((a, b) => b.recall - a.recall);
}
