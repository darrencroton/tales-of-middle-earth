/**
 * Turns rows of the tome2 terminal into structured blocks (text, menu
 * choices, preformatted art) so they can be laid out as HTML at the app's
 * text size instead of being scaled to fit 80 columns.
 */

export interface Run {
  text: string;
  attr: number;
}

export interface Cell {
  /** Column of the first character. */
  col: number;
  text: string;
  runs: Run[];
}

export interface TextBlock {
  kind: 'text';
  row: number;
  indent: number;
  cells: Cell[];
}

export interface ChoiceBlock {
  kind: 'choice';
  row: number;
  key: string;
  /** tome2 marks its own cursor with brackets: "[a] Human". */
  current: boolean;
  /** Item symbol drawn after the key in item lists, e.g. "a) , Rations". */
  symbol: Run | null;
  label: Cell;
  meta: Cell[];
}

/** A tome2 option row, "Preserve artifacts      : yes  (preserve)". */
export interface OptionBlock {
  kind: 'option';
  row: number;
  label: string;
  value: boolean;
  name: string;
}

export interface GapBlock {
  kind: 'gap';
}

export interface PreBlock {
  kind: 'pre';
  rows: Run[][];
}

export type Block = TextBlock | ChoiceBlock | OptionBlock | GapBlock | PreBlock;

export interface TermRow {
  chars: ArrayLike<number>;
  attrs: ArrayLike<number>;
}

/** A row's characters as a string, with unset cells shown as spaces. */
export function rowText(row: TermRow | undefined): string {
  if (!row) return '';
  let text = '';
  for (let x = 0; x < row.chars.length; x++) text += row.chars[x] === 0 ? ' ' : String.fromCharCode(row.chars[x]);
  return text;
}

const SPACE = 0x20;
const OPTION_ROW = /^\s*(.+?)\s*:\s*(yes|no)\s+\(([\w-]+)\)\s*$/;
const CHOICE = /^(?:\[([a-zA-Z0-9])\]|\(([a-zA-Z0-9])\)|([a-zA-Z0-9])[)\]]|([a-zA-Z]) -)(?=\s|$)/;
const SYMBOL_ART = 0.42;
const JOIN_MIN_FRACTION = 0.6;

function isBlank(ch: number): boolean {
  return ch === SPACE || ch === 0;
}

/** Splits columns [x0, x1] of a row into cells separated by runs of two or more spaces. */
export function splitCells(row: TermRow, x0: number, x1: number): Cell[] {
  const cells: Cell[] = [];
  let x = x0;
  while (x <= x1) {
    while (x <= x1 && isBlank(row.chars[x])) x++;
    if (x > x1) break;
    const start = x;
    let end = x;
    while (x <= x1) {
      if (!isBlank(row.chars[x])) {
        end = x;
        x++;
        continue;
      }
      let gap = 0;
      while (x + gap <= x1 && isBlank(row.chars[x + gap])) gap++;
      if (x + gap > x1) break;
      const before = String.fromCharCode(row.chars[x - 1]);
      const after = String.fromCharCode(row.chars[x + gap]);
      const sentenceBreak = gap === 2 && /[.!?,:;]/.test(before) && /[A-Z'"(]/.test(after);
      if (gap >= 2 && !sentenceBreak) break;
      x += gap;
    }
    cells.push(makeCell(row, start, end));
  }
  return cells;
}

function makeCell(row: TermRow, start: number, end: number): Cell {
  const runs: Run[] = [];
  for (let x = start; x <= end; x++) {
    const ch = isBlank(row.chars[x]) ? ' ' : String.fromCharCode(row.chars[x]);
    const attr = isBlank(row.chars[x]) && runs.length ? runs[runs.length - 1].attr : row.attrs[x];
    const last = runs[runs.length - 1];
    if (last && last.attr === attr) last.text += ch;
    else runs.push({ text: ch, attr });
  }
  return { col: start, text: runs.map((r) => r.text).join(''), runs };
}

/** Removes the first `count` characters from a cell. */
function dropChars(cell: Cell, count: number): Cell {
  const runs: Run[] = [];
  let skip = count;
  for (const run of cell.runs) {
    if (skip >= run.text.length) {
      skip -= run.text.length;
      continue;
    }
    runs.push({ text: run.text.slice(skip), attr: run.attr });
    skip = 0;
  }
  const text = runs.map((r) => r.text).join('');
  const lead = text.length - text.trimStart().length;
  if (lead > 0) return dropChars({ col: cell.col + count, text, runs }, lead);
  return { col: cell.col + count, text, runs };
}

const INNER_CHOICE = /\s(?=(?:\[[a-zA-Z0-9]\]|[a-zA-Z0-9][)\]]) \S)/g;
/* tome2's cursor brackets drawn straight after a name that fills its column ("Petty-Dwarf[o] Dark-Elf"). */
const GLUED_CHOICE = /(?<=[A-Za-z])(?=\[[a-zA-Z0-9]\] [A-Z])/g;

/**
 * Splits a cell of a menu row where another choice starts after a single
 * space, or with no space at all, as when tome2 packs long names into
 * fixed columns ("n) Petty-Dwarf o) Dark-Elf", "n) Petty-Dwarf[o] Dark-Elf").
 */
export function splitMenuCell(cell: Cell): Cell[] {
  if (!choiceKey(cell.text)) return [cell];
  const starts = new Set([0]);
  for (const m of cell.text.matchAll(INNER_CHOICE)) starts.add((m.index ?? 0) + 1);
  for (const m of cell.text.matchAll(GLUED_CHOICE)) starts.add(m.index ?? 0);
  if (starts.size === 1) return [cell];
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.map((start, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1] : cell.text.length;
    return sliceCell(cell, start, end);
  });
}

/** Characters [start, end) of a cell, keeping colours. */
export function sliceCell(cell: Cell, start: number, end: number): Cell {
  const runs: Run[] = [];
  let pos = 0;
  for (const run of cell.runs) {
    const from = Math.max(start, pos);
    const to = Math.min(end, pos + run.text.length);
    if (to > from) runs.push({ text: run.text.slice(from - pos, to - pos), attr: run.attr });
    pos += run.text.length;
  }
  while (runs.length && !runs[runs.length - 1].text.trimEnd()) runs.pop();
  const last = runs[runs.length - 1];
  if (last) last.text = last.text.trimEnd();
  return { col: cell.col + start, text: runs.map((r) => r.text).join(''), runs };
}

export function choiceKey(text: string): { key: string; current: boolean; length: number } | null {
  const m = CHOICE.exec(text);
  if (!m) return null;
  const key = m[1] ?? m[2] ?? m[3] ?? m[4];
  return { key, current: m[1] !== undefined, length: m[0].length };
}

function toChoice(row: number, cell: Cell, meta: Cell[]): ChoiceBlock | null {
  const found = choiceKey(cell.text);
  if (!found) return null;
  let label = dropChars(cell, found.length);
  const number = /^\d+\) (?=\S)/.exec(label.text);
  if (number) label = dropChars(label, number[0].length);
  let symbol: Run | null = null;
  const symbolMatch = /^([^\w\s]) (?=\S)/.exec(label.text);
  if (symbolMatch && label.runs[0]) {
    symbol = { text: symbolMatch[1], attr: label.runs[0].attr };
    label = dropChars(label, 2);
  }
  return { kind: 'choice', row, key: found.key, current: found.current, symbol, label, meta };
}

/** Fraction of visible characters that are symbols rather than letters or digits. */
export function symbolRatio(rows: readonly TermRow[], x0: number, x1: number): number {
  let symbols = 0;
  let visible = 0;
  for (const row of rows) {
    for (let x = x0; x <= x1; x++) {
      const ch = row.chars[x];
      if (isBlank(ch)) continue;
      visible++;
      const c = String.fromCharCode(ch);
      if (!/[A-Za-z0-9]/.test(c)) symbols++;
    }
  }
  return visible === 0 ? 0 : symbols / visible;
}

/** Colour runs of a row between two columns, without trailing blanks. */
export function runsOf(row: TermRow, x0: number, x1: number): Run[] {
  let end = x1;
  while (end >= x0 && isBlank(row.chars[end])) end--;
  return end < x0 ? [] : makeCell(row, x0, end).runs;
}

/**
 * Parses terminal rows (row index `top` first) between columns x0 and x1.
 * Rows of ASCII art or maps come back as one preformatted block.
 */
export function parseRows(rows: readonly TermRow[], top: number, x0: number, x1: number): Block[] {
  if (symbolRatio(rows, x0, x1) > SYMBOL_ART) {
    const pre = rows.map((row) => runsOf(row, x0, x1));
    while (pre.length && pre[pre.length - 1].length === 0) pre.pop();
    while (pre.length && pre[0].length === 0) pre.shift();
    return pre.length ? [{ kind: 'pre', rows: pre }] : [];
  }

  const width = x1 - x0 + 1;
  const blocks: Block[] = [];
  let previousText: { block: TextBlock; length: number } | null = null;

  rows.forEach((row, i) => {
    const r = top + i;
    const cells = splitCells(row, x0, x1);
    const option = OPTION_ROW.exec(cells.map((c) => c.text).join('  '));
    if (option) {
      blocks.push({ kind: 'option', row: r, label: option[1], value: option[2] === 'yes', name: option[3] });
      previousText = null;
      return;
    }
    if (cells.length === 0) {
      if (blocks.length && blocks[blocks.length - 1].kind !== 'gap') blocks.push({ kind: 'gap' });
      previousText = null;
      return;
    }

    const choices: ChoiceBlock[] = [];
    const leading: Cell[] = [];
    for (const cell of cells.flatMap(splitMenuCell)) {
      const choice = toChoice(r, cell, []);
      if (choice) choices.push(choice);
      else if (choices.length) choices[choices.length - 1].meta.push(cell);
      else leading.push(cell);
    }

    if (choices.length && leading.length === 0) {
      blocks.push(...choices);
      previousText = null;
      return;
    }
    if (choices.length) {
      blocks.push({ kind: 'text', row: r, indent: leading[0].col - x0, cells: leading }, ...choices);
      previousText = null;
      return;
    }

    const indent = cells[0].col - x0;
    const prev: { block: TextBlock; length: number } | null = previousText;
    if (
      prev &&
      cells.length === 1 &&
      prev.block.cells.length === 1 &&
      prev.length >= width * JOIN_MIN_FRACTION &&
      Math.abs(prev.block.indent - indent) <= 2 &&
      !/[:]$/.test(prev.block.cells[0].text)
    ) {
      const target = prev.block.cells[0];
      const last = target.runs[target.runs.length - 1];
      last.text += ' ';
      target.runs.push(...cells[0].runs);
      target.text += ` ${cells[0].text}`;
      previousText = { block: prev.block, length: cells[0].col - x0 + cells[0].text.length };
      return;
    }

    const block: TextBlock = { kind: 'text', row: r, indent, cells };
    blocks.push(block);
    const lastCell = cells[cells.length - 1];
    previousText = { block, length: lastCell.col - x0 + lastCell.text.length };
  });

  while (blocks.length && blocks[blocks.length - 1].kind === 'gap') blocks.pop();
  while (blocks.length && blocks[0].kind === 'gap') blocks.shift();
  return blocks;
}

/** Rows of a terminal buffer as TermRow views. */
export function bufferRows(
  buffer: { cols: number; chars: Uint8Array; attrs: Uint8Array },
  y0: number,
  y1: number,
): TermRow[] {
  const rows: TermRow[] = [];
  for (let y = y0; y <= y1; y++) {
    const offset = y * buffer.cols;
    rows.push({ chars: buffer.chars.subarray(offset, offset + buffer.cols), attrs: buffer.attrs.subarray(offset, offset + buffer.cols) });
  }
  return rows;
}
