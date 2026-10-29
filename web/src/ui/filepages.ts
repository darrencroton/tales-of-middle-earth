import type { TermRow } from './termparse.ts';

/** tome2's file viewer heading: "[ToME 2.4.0 (ah), Known Uniques, Line 20/45]". */
export interface ViewerHeading {
  caption: string;
  /** First file line on the page. */
  line: number;
  /** Lines in the file. */
  size: number;
}

const HEADING = /^\[\S+ \d+(?:\.\d+)*(?: \([^)]*\))?, (.+), Line (\d+)\/(\d+)\]$/;

export function viewerHeading(prompt: string): ViewerHeading | null {
  const m = HEADING.exec(prompt.trim());
  return m ? { caption: m[1], line: Number(m[2]), size: Number(m[3]) } : null;
}

/** True for help files, whose orange and yellow text are links. */
export function isHelpCaption(caption: string): boolean {
  return /^Help file '/.test(caption);
}

/* tome2's link colours (TERM_ORANGE, and TERM_YELLOW for the selected link). */
const LINK = 3;
const LINK_SELECTED = 11;
const SPACE = 0x20;

/** A link drawn in a help file: its place in the whole file and its order among the file's links. */
export interface FileLink {
  index: number;
  /** Row in the whole file (see `FilePages.rows`) and the column it starts at. */
  row: number;
  col: number;
  text: string;
}

function blank(ch: number): boolean {
  return ch === SPACE || ch === 0;
}

function isLinkColour(attr: number): boolean {
  return attr === LINK || attr === LINK_SELECTED;
}

/**
 * Link-coloured stretches of each row, in reading order. A single space
 * inside a link belongs to it (link names have spaces); two end it.
 */
export function linkRuns(rows: readonly TermRow[]): FileLink[] {
  const links: FileLink[] = [];
  rows.forEach((row, r) => {
    let x = 0;
    const width = row.chars.length;
    while (x < width) {
      if (blank(row.chars[x]) || !isLinkColour(row.attrs[x])) {
        x++;
        continue;
      }
      const start = x;
      let end = x;
      while (x < width) {
        if (!blank(row.chars[x])) {
          if (!isLinkColour(row.attrs[x])) break;
          end = x;
          x++;
          continue;
        }
        if (x + 1 < width && !blank(row.chars[x + 1]) && isLinkColour(row.attrs[x + 1])) {
          x++;
          continue;
        }
        break;
      }
      let text = '';
      for (let i = start; i <= end; i++) text += String.fromCharCode(row.chars[i]);
      links.push({ index: links.length, row: r, col: start, text });
      x = end + 1;
    }
  });
  return links;
}

/** Columns where the selected (yellow) link starts on a row. */
export function selectedLinkCols(row: TermRow): number[] {
  return linkRuns([row])
    .filter((link) => row.attrs[link.col] === LINK_SELECTED)
    .map((link) => link.col);
}

/** A copy of a terminal row, so later screens do not change it. */
function copyRow(row: TermRow): TermRow {
  return { chars: Uint8Array.from(row.chars), attrs: Uint8Array.from(row.attrs) };
}

/**
 * The pages of a file tome2 shows a screenful at a time, gathered into the
 * whole file so it can be read by scrolling. Each page is keyed by the file
 * line at its top; tome2 moves a page on with Space and starts again from
 * the top after the last page.
 */
export class FilePages {
  readonly caption: string;
  readonly size: number;
  /** The line tome2 first showed (a help link can open a file part-way down). */
  readonly start: number;
  /** Where the reader was left, to come back to it from another file. */
  scrollTop: number | null = null;
  private readonly pageHeight: number;
  private readonly pages = new Map<number, TermRow[]>();
  private done = false;
  private cached: { rows: TermRow[]; lines: number[] } | null = null;
  private linkCache: { list: FileLink[]; at: Map<string, number> } | null = null;
  private sourceCache: { cols: number; chars: Uint8Array; attrs: Uint8Array } | null = null;

  constructor(heading: ViewerHeading, pageHeight: number) {
    this.caption = heading.caption;
    this.size = heading.size;
    this.start = heading.line;
    this.pageHeight = Math.max(1, pageHeight);
  }

  /** Same file as the heading names. */
  matches(heading: ViewerHeading): boolean {
    return heading.caption === this.caption && heading.size === this.size;
  }

  get complete(): boolean {
    return this.done;
  }

  /**
   * Adds the page on screen; true when another page is still needed (and
   * Space will show it).
   */
  add(line: number, rows: readonly TermRow[]): boolean {
    if (this.done) return false;
    if (this.pages.has(line)) {
      this.done = true;
      return false;
    }
    this.pages.set(line, rows.slice(0, this.pageHeight).map(copyRow));
    this.cached = null;
    this.linkCache = null;
    this.sourceCache = null;
    const next = line + this.pageHeight >= this.size ? 0 : line + this.pageHeight;
    this.done = this.size <= this.pageHeight || this.covered(next, Math.min(this.size, next + this.pageHeight));
    return !this.done;
  }

  private covered(from: number, to: number): boolean {
    for (let line = from; line < to; line++) {
      if (![...this.pages.keys()].some((top) => line >= top && line < top + this.pageHeight)) return false;
    }
    return true;
  }

  /** Every row of the file in order, and the file line each row shows. */
  get rows(): TermRow[] {
    return this.stitch().rows;
  }

  /** Row of the whole file that shows a file line (the nearest before it when that line is not shown). */
  rowOf(line: number): number {
    const lines = this.stitch().lines;
    let best = 0;
    lines.forEach((l, i) => {
      if (l <= line) best = i;
    });
    return best;
  }

  /** The links in a help file, in the order tome2 steps through them. */
  get links(): FileLink[] {
    return this.linkIndex().list;
  }

  /** Index of the link starting at a row and column of the whole file. */
  linkAt(row: number, col: number): number | null {
    return this.linkIndex().at.get(`${row}:${col}`) ?? null;
  }

  private linkIndex(): { list: FileLink[]; at: Map<string, number> } {
    if (!this.linkCache) {
      const list = linkRuns(this.rows);
      this.linkCache = { list, at: new Map(list.map((l) => [`${l.row}:${l.col}`, l.index])) };
    }
    return this.linkCache;
  }

  /** The whole file as one tall terminal buffer (at least one row). */
  source(cols: number): { cols: number; chars: Uint8Array; attrs: Uint8Array } {
    if (this.sourceCache?.cols === cols) return this.sourceCache;
    const rows = this.rows;
    const height = Math.max(1, rows.length);
    const chars = new Uint8Array(cols * height).fill(SPACE);
    const attrs = new Uint8Array(cols * height).fill(1);
    rows.forEach((row, i) => {
      chars.set(Array.from(row.chars).slice(0, cols), i * cols);
      attrs.set(Array.from(row.attrs).slice(0, cols), i * cols);
    });
    this.sourceCache = { cols, chars, attrs };
    return this.sourceCache;
  }

  /** File line shown on a row of the whole file. */
  lineAt(row: number): number {
    return this.stitch().lines[row] ?? 0;
  }

  private stitch(): { rows: TermRow[]; lines: number[] } {
    if (this.cached) return this.cached;
    const tops = [...this.pages.keys()].sort((a, b) => a - b);
    const rows: TermRow[] = [];
    const lines: number[] = [];
    tops.forEach((top, i) => {
      const next = i + 1 < tops.length ? tops[i + 1] : this.size;
      const page = this.pages.get(top) ?? [];
      const count = Math.max(0, Math.min(page.length, next - top));
      for (let r = 0; r < count; r++) {
        rows.push(page[r]);
        lines.push(top + r);
      }
    });
    while (rows.length && Array.from(rows[rows.length - 1].chars).every(blank)) {
      rows.pop();
      lines.pop();
    }
    this.cached = { rows, lines };
    return this.cached;
  }
}
