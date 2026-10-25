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

  /** Bounding box of cells (from row `fromRow` down) that differ from `base`, or null. */
  diffBounds(base: ScreenCopy, fromRow = 0): CellRect | null {
    let x0 = this.cols;
    let y0 = this.rows;
    let x1 = -1;
    let y1 = -1;
    for (let y = fromRow; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        if (this.chars[i] === base.chars[i] && this.attrs[i] === base.attrs[i]) continue;
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

const FONT_STACK = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const CHAR_ASPECT = 0.6;
const PANEL_PADDING_CELLS = 1;
const MIN_FIT_COLS = 40;
const MIN_FIT_ROWS = 12;
const MAX_FULL_CELL_CSS = 28;

export type TerminalMode = { kind: 'full' } | { kind: 'panel'; region: CellRect } | { kind: 'hidden' };

/**
 * Draws the terminal either full-screen (transparent background, so effects
 * can show behind it) or as a translucent panel around a region.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cellW = 8;
  private cellH = 16;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  private frame = 0;
  private mode: TerminalMode = { kind: 'full' };
  private readonly canvas: HTMLCanvasElement;
  private readonly buffer: TerminalBuffer;

  constructor(canvas: HTMLCanvasElement, buffer: TerminalBuffer) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.buffer = buffer;
    this.ctx = ctx;
  }

  setMode(mode: TerminalMode): void {
    const same =
      mode.kind === this.mode.kind &&
      (mode.kind !== 'panel' ||
        (this.mode.kind === 'panel' &&
          mode.region.x0 === this.mode.region.x0 &&
          mode.region.y0 === this.mode.region.y0 &&
          mode.region.x1 === this.mode.region.x1 &&
          mode.region.y1 === this.mode.region.y1));
    this.mode = mode;
    if (!same) {
      this.layout();
      this.buffer.markAllDirty();
      this.scheduleRender();
    }
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * this.dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.layout();
    this.buffer.markAllDirty();
    this.render();
  }

  private layout(): void {
    const region = this.region();
    const cols = region.x1 - region.x0 + 1 + (this.mode.kind === 'panel' ? PANEL_PADDING_CELLS * 2 : 0);
    const rows = region.y1 - region.y0 + 1 + (this.mode.kind === 'panel' ? PANEL_PADDING_CELLS * 2 : 0);
    const margin = this.mode.kind === 'panel' ? 12 * this.dpr : 0;
    const deviceW = this.canvas.width - margin * 2;
    const deviceH = this.canvas.height - margin * 2;
    const fitH = Math.min(
      deviceH / rows,
      deviceW / cols / CHAR_ASPECT,
      (this.mode.kind === 'panel' ? 30 : MAX_FULL_CELL_CSS) * this.dpr,
    );
    this.cellH = Math.max(1, Math.floor(fitH));
    this.cellW = Math.max(1, Math.min(Math.floor(deviceW / cols), Math.ceil(this.cellH * CHAR_ASPECT * 1.25)));
    this.offsetX = Math.floor((this.canvas.width - this.cellW * cols) / 2);
    this.offsetY = this.mode.kind === 'full'
      ? Math.floor(Math.min((this.canvas.height - this.cellH * rows) / 2, this.cellH))
      : Math.floor((this.canvas.height - this.cellH * rows) / 2);
  }

  private fittedRegion: CellRect | null = null;

  private region(): CellRect {
    if (this.mode.kind === 'panel') return this.mode.region;
    return this.fittedRegion ?? { x0: 0, y0: 0, x1: this.buffer.cols - 1, y1: this.buffer.rows - 1 };
  }

  /**
   * Full-screen text is scaled to the area actually used (plus the cursor),
   * so sparse screens read larger on small displays.
   */
  private fitContent(): void {
    const { buffer } = this;
    const content = buffer.contentBounds();
    let next: CellRect | null = null;
    if (content) {
      next = { ...content };
      if (buffer.cursorX >= 0 && buffer.cursorY >= 0) {
        next.x0 = Math.min(next.x0, buffer.cursorX);
        next.y0 = Math.min(next.y0, buffer.cursorY);
        next.x1 = Math.max(next.x1, buffer.cursorX);
        next.y1 = Math.max(next.y1, buffer.cursorY);
      }
      next.x0 = 0;
      next.x1 = Math.max(next.x1, Math.min(buffer.cols - 1, MIN_FIT_COLS - 1));
      next.y0 = Math.min(next.y0, 0);
      next.y1 = Math.max(next.y1, Math.min(buffer.rows - 1, MIN_FIT_ROWS - 1));
    }
    const prev = this.fittedRegion;
    const same = prev && next && prev.x0 === next.x0 && prev.y0 === next.y0 && prev.x1 === next.x1 && prev.y1 === next.y1;
    if (same || (!prev && !next)) return;
    this.fittedRegion = next;
    this.layout();
    buffer.markAllDirty();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  scheduleRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(): void {
    const { ctx, buffer, cellW, cellH } = this;

    if (this.mode.kind === 'hidden') {
      buffer.takeDirtyRows();
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    if (this.mode.kind === 'full') this.fitContent();
    const region = this.region();
    const pad = this.mode.kind === 'panel' ? PANEL_PADDING_CELLS : 0;
    const fontPx = Math.max(1, Math.floor(Math.min(cellH * 0.9, cellW / CHAR_ASPECT)));
    ctx.font = `${fontPx}px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    let rows = buffer.takeDirtyRows();
    if (this.mode.kind === 'panel') {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const left = this.offsetX;
      const top = this.offsetY;
      const width = cellW * (region.x1 - region.x0 + 1 + pad * 2);
      const height = cellH * (region.y1 - region.y0 + 1 + pad * 2);
      ctx.fillStyle = 'rgba(12, 10, 8, 0.86)';
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.45)';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, 8 * this.dpr);
      ctx.fill();
      ctx.stroke();
      rows = [];
      for (let y = region.y0; y <= region.y1; y++) rows.push(y);
    }

    for (const y of rows) {
      if (y < region.y0 || y > region.y1) continue;
      const top = this.offsetY + (y - region.y0 + pad) * cellH;
      if (this.mode.kind === 'full') ctx.clearRect(0, top, this.canvas.width, cellH);

      const rowOffset = y * buffer.cols;
      for (let x = region.x0; x <= region.x1; x++) {
        const ch = buffer.chars[rowOffset + x];
        if (ch === 0x20 || ch === 0) continue;
        ctx.fillStyle = buffer.palette[buffer.attrs[rowOffset + x]];
        ctx.fillText(String.fromCharCode(ch), this.offsetX + (x - region.x0 + pad) * cellW + cellW / 2, top + cellH / 2 + 1);
      }

      if (y === buffer.cursorY && buffer.cursorX >= region.x0 && buffer.cursorX <= region.x1) {
        const lineW = Math.max(1, Math.round(this.dpr));
        ctx.strokeStyle = buffer.palette[11];
        ctx.lineWidth = lineW;
        ctx.strokeRect(
          this.offsetX + (buffer.cursorX - region.x0 + pad) * cellW + lineW / 2,
          top + lineW / 2,
          cellW - lineW,
          cellH - lineW,
        );
      }
    }
  }
}
