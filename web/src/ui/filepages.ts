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

/* tome2's directories for the files its viewer names by kind. */
const SOURCE_DIRS: Readonly<Record<string, string>> = { 'Help file': 'help', 'Info file': 'info', File: 'file' };

/** The game file a viewer caption names ("Help file 'index.txt'" → help/index.txt), or null for files tome2 wrote itself. */
export function viewerSource(caption: string): { dir: string; name: string } | null {
  const m = /^(Help file|Info file|File) '([^']+)'$/.exec(caption);
  return m ? { dir: SOURCE_DIRS[m[1]], name: m[2] } : null;
}

const SPACE = 0x20;
/* tome2's colour letters, in attribute order. */
const COLOURS = 'dwsorgbuDWvyRGBU';
/* tome2's colour for the link its cursor is on, unless a file sets another. */
const LINK_SELECTED = 11;

/** A link in a help file, where tome2 prints it. */
export interface HelpLink {
  /** Order among the file's links: tome2's link cursor steps through them in this order. */
  index: number;
  /** File line it is on, and the column its text starts at. */
  line: number;
  col: number;
  length: number;
  /** Help file it opens, and the tag there it opens at (0: the top). */
  file: string;
  anchor: number;
  /** Key that opens it straight away, or ''. */
  key: string;
}

/** What tome2 reads from a help file before showing it. */
export interface HelpFile {
  links: HelpLink[];
  /** Links on each file line. */
  lines: Map<number, HelpLink[]>;
  /** File line each tag ("~~~~~12") opens a link at. */
  tags: Map<number, number>;
  /** Colour of the link tome2's cursor is on. */
  selected: number;
}

function blank(ch: number): boolean {
  return ch === SPACE || ch === 0;
}

/** A file's lines as tome2's `my_fgets` reads them: any line ending, tabs to the next multiple of 8, unprintable bytes dropped. */
export function fileLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 13 || c === 10) {
      if (bytes[i + 1] === (c === 13 ? 10 : 13)) i++;
      lines.push(line);
      line = '';
    } else if (c === 9) {
      do line += ' ';
      while (line.length % 8);
    } else if (c >= 32 && c < 127) {
      line += String.fromCharCode(c);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Finds a help file's links, tags and link colour as tome2's file viewer
 * does (`show_file_aux`): links are `*****[/key]file*tag[text]`, colour
 * spans `[[[[[c text]` and hidden spans `{{{{{…}` print only their text,
 * and a line may start with a colour (`#####c`).
 */
export function parseHelpFile(bytes: Uint8Array): HelpFile {
  const links: HelpLink[] = [];
  const lines = new Map<number, HelpLink[]>();
  const tags = new Map<number, number>();
  let selected = LINK_SELECTED;
  fileLines(bytes).forEach((raw, line) => {
    const buf = raw.startsWith('#####') ? raw.slice(6) : raw;
    if (buf.startsWith('|||||')) {
      const colour = COLOURS.indexOf(buf[6] ?? '');
      if (colour >= 0) selected = colour;
    }
    if (buf.startsWith('~~~~~')) {
      const tag = Number(/^\d*/.exec(buf.slice(5))?.[0] || NaN);
      if (Number.isInteger(tag) && !tags.has(tag)) tags.set(tag, line + 1);
    }
    let x = 0;
    let col = 0;
    while (x < buf.length) {
      if (buf.startsWith('*****', x)) {
        let at = x + 5;
        let key = '';
        if (buf[at] === '/') {
          key = buf[at + 1] ?? '';
          at += 2;
        }
        const star = buf.indexOf('*', at);
        const open = star < 0 ? -1 : buf.indexOf('[', star + 1);
        if (open < 0) break;
        let length = 0;
        at = open + 1;
        while (at < buf.length && buf[at] !== ']') {
          if (buf[at] === '\\') at++;
          length++;
          at++;
        }
        const link: HelpLink = { index: links.length, line, col, length, file: buf.slice(x + 5 + (key ? 2 : 0), star), anchor: Number(buf.slice(star + 1, open)) || 0, key };
        links.push(link);
        lines.set(line, [...(lines.get(line) ?? []), link]);
        col += length;
        x = at + 1;
      } else if (buf.startsWith('[[[[[', x)) {
        let at = x + 6;
        while (at < buf.length && buf[at] !== ']') {
          if (buf[at] === '\\') at++;
          col++;
          at++;
        }
        x = at + 1;
      } else if (buf.startsWith('{{{{{', x)) {
        const end = buf.indexOf('}', x + 6);
        x = end < 0 ? buf.length : end + 1;
      } else {
        col++;
        x++;
      }
    }
  });
  return { links, lines, tags, selected };
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
  /** Where the reader was left, to come back to it from another file. */
  scrollTop: number | null = null;
  private readonly pageHeight: number;
  private readonly pages = new Map<number, TermRow[]>();
  private done = false;
  private cached: { rows: TermRow[]; lines: number[] } | null = null;
  private sourceCache: { cols: number; chars: Uint8Array; attrs: Uint8Array } | null = null;

  constructor(heading: ViewerHeading, pageHeight: number) {
    this.caption = heading.caption;
    this.size = heading.size;
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

  /** Every row of the file in order. */
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
