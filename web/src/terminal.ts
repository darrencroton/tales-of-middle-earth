import type { RGB } from './render/colour.ts';

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

const BLANK = 0x20;

/* Angband base colours (TERM_DARK .. TERM_L_UMBER) used until the engine sends its palette. */
const BASE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [255, 255, 255],
  [128, 128, 128],
  [255, 128, 0],
  [192, 0, 0],
  [0, 128, 64],
  [0, 64, 255],
  [128, 64, 0],
  [64, 64, 64],
  [192, 192, 192],
  [255, 0, 255],
  [255, 255, 0],
  [255, 64, 64],
  [0, 255, 0],
  [0, 255, 255],
  [192, 128, 64],
];

export function rgbToCss(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScreenCopy {
  chars: Uint8Array;
  attrs: Uint8Array;
}

export class TerminalBuffer {
  readonly cols: number;
  readonly rows: number;
  readonly chars: Uint8Array;
  readonly attrs: Uint8Array;
  readonly palette: string[];
  readonly paletteRgb: RGB[];
  cursorX = -1;
  cursorY = -1;
  private readonly dirty: Set<number> = new Set();
  private bounds: CellRect | null = null;

  constructor(cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.chars = new Uint8Array(cols * rows).fill(BLANK);
    this.attrs = new Uint8Array(cols * rows);
    this.palette = Array.from({ length: 256 }, (_, i) => {
      const [r, g, b] = BASE_PALETTE[i & 0x0f];
      return rgbToCss(r, g, b);
    });
    this.paletteRgb = Array.from({ length: 256 }, (_, i) => {
      const [r, g, b] = BASE_PALETTE[i & 0x0f];
      return [r / 255, g / 255, b / 255] as RGB;
    });
    this.markAllDirty();
  }

  drawText(x: number, y: number, attr: number, text: Uint8Array): void {
    if (y < 0 || y >= this.rows || x >= this.cols) return;
    const start = Math.max(0, x);
    const end = Math.min(this.cols, x + text.length);
    if (start >= end) return;
    const offset = y * this.cols;
    for (let col = start; col < end; col++) {
      const ch = text[col - x];
      this.chars[offset + col] = ch;
      this.attrs[offset + col] = attr;
      if (ch !== BLANK && ch !== 0) this.extendBounds(col, y);
    }
    if (y === this.cursorY && this.cursorX >= start && this.cursorX < end) {
      this.cursorX = -1;
      this.cursorY = -1;
    }
    this.dirty.add(y);
  }

  private extendBounds(x: number, y: number): void {
    const b = this.bounds;
    if (!b) {
      this.bounds = { x0: x, y0: y, x1: x, y1: y };
    } else {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    }
  }

  /** Union of non-blank cells drawn since the last clear, or null when blank. */
  contentBounds(): CellRect | null {
    return this.bounds ? { ...this.bounds } : null;
  }

  setCursor(x: number, y: number): void {
    if (this.cursorY >= 0) this.dirty.add(this.cursorY);
    this.cursorX = x;
    this.cursorY = y;
    if (y >= 0 && y < this.rows) this.dirty.add(y);
  }

  clear(): void {
    this.chars.fill(BLANK);
    this.attrs.fill(0);
    this.bounds = null;
    this.cursorX = -1;
    this.cursorY = -1;
    this.markAllDirty();
  }

  setColour(index: number, r: number, g: number, b: number): void {
    if (index < 0 || index >= this.palette.length) return;
    const css = rgbToCss(r, g, b);
    if (this.palette[index] !== css) {
      this.palette[index] = css;
      this.paletteRgb[index] = [r / 255, g / 255, b / 255];
      this.markAllDirty();
    }
  }

  markAllDirty(): void {
    for (let y = 0; y < this.rows; y++) this.dirty.add(y);
  }

  takeDirtyRows(): number[] {
    const rows = [...this.dirty].sort((a, b) => a - b);
    this.dirty.clear();
    return rows;
  }

  copy(): ScreenCopy {
    return { chars: this.chars.slice(), attrs: this.attrs.slice() };
  }

  /** Bounding box of cells (from row `fromRow` down) that differ from `base`, or null; blank cells are equal whatever their colour. */
  diffBounds(base: ScreenCopy, fromRow = 0): CellRect | null {
    let x0 = this.cols;
    let y0 = this.rows;
    let x1 = -1;
    let y1 = -1;
    for (let y = fromRow; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const ch = this.chars[i];
        if (ch === base.chars[i] && (this.attrs[i] === base.attrs[i] || ch === BLANK || ch === 0)) continue;
        if ((ch === BLANK || ch === 0) && (base.chars[i] === BLANK || base.chars[i] === 0)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  rowText(y: number): string {
    const offset = y * this.cols;
    return String.fromCharCode(...this.chars.subarray(offset, offset + this.cols));
  }

  screenText(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y++) lines.push(this.rowText(y).trimEnd());
    return lines.join('\n');
  }
}
