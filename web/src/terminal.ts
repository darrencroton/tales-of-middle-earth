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

export class TerminalBuffer {
  readonly cols: number;
  readonly rows: number;
  readonly chars: Uint8Array;
  readonly attrs: Uint8Array;
  readonly palette: string[];
  cursorX = -1;
  cursorY = -1;
  private readonly dirty: Set<number> = new Set();

  constructor(cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.chars = new Uint8Array(cols * rows).fill(BLANK);
    this.attrs = new Uint8Array(cols * rows);
    this.palette = Array.from({ length: 256 }, (_, i) => {
      const [r, g, b] = BASE_PALETTE[i & 0x0f];
      return rgbToCss(r, g, b);
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
      this.chars[offset + col] = text[col - x];
      this.attrs[offset + col] = attr;
    }
    this.dirty.add(y);
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
    this.cursorX = -1;
    this.cursorY = -1;
    this.markAllDirty();
  }

  setColour(index: number, r: number, g: number, b: number): void {
    if (index < 0 || index >= this.palette.length) return;
    const css = rgbToCss(r, g, b);
    if (this.palette[index] !== css) {
      this.palette[index] = css;
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

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cellW = 8;
  private cellH = 16;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  private frame = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly buffer: TerminalBuffer;

  constructor(canvas: HTMLCanvasElement, buffer: TerminalBuffer) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.buffer = buffer;
    this.ctx = ctx;
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * this.dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    const deviceW = this.canvas.width;
    const deviceH = this.canvas.height;
    const fitH = Math.min(deviceH / this.buffer.rows, deviceW / this.buffer.cols / CHAR_ASPECT);
    this.cellH = Math.max(1, Math.floor(fitH));
    this.cellW = Math.max(1, Math.floor(deviceW / this.buffer.cols));
    this.cellW = Math.min(this.cellW, Math.ceil(this.cellH * CHAR_ASPECT * 1.25));
    this.offsetX = Math.floor((deviceW - this.cellW * this.buffer.cols) / 2);
    this.offsetY = Math.floor((deviceH - this.cellH * this.buffer.rows) / 2);

    this.ctx.fillStyle = this.buffer.palette[0];
    this.ctx.fillRect(0, 0, deviceW, deviceH);
    this.buffer.markAllDirty();
    this.render();
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
    const fontPx = Math.max(1, Math.floor(Math.min(cellH * 0.9, cellW / CHAR_ASPECT)));
    ctx.font = `${fontPx}px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const y of buffer.takeDirtyRows()) {
      const top = this.offsetY + y * cellH;
      ctx.fillStyle = buffer.palette[0];
      ctx.fillRect(this.offsetX, top, cellW * buffer.cols, cellH);

      const rowOffset = y * buffer.cols;
      for (let x = 0; x < buffer.cols; x++) {
        const ch = buffer.chars[rowOffset + x];
        if (ch === 0x20 || ch === 0) continue;
        ctx.fillStyle = buffer.palette[buffer.attrs[rowOffset + x]];
        ctx.fillText(String.fromCharCode(ch), this.offsetX + x * cellW + cellW / 2, top + cellH / 2 + 1);
      }

      if (y === buffer.cursorY && buffer.cursorX >= 0 && buffer.cursorX < buffer.cols) {
        const lineW = Math.max(1, Math.round(this.dpr));
        ctx.strokeStyle = buffer.palette[11];
        ctx.lineWidth = lineW;
        ctx.strokeRect(
          this.offsetX + buffer.cursorX * cellW + lineW / 2,
          top + lineW / 2,
          cellW - lineW,
          cellH - lineW,
        );
      }
    }
  }
}
