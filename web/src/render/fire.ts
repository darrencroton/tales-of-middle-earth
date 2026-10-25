/**
 * Heat field that diffuses upwards and cools, seeded along the bottom edge.
 */
export class HeatField {
  cols = 0;
  rows = 0;
  heat: Float32Array = new Float32Array(0);
  /** Fraction of the height flames can climb before cooling out (0..1). */
  reach: number;
  /** Multiplier on the heat fed in at the bottom. */
  intensity = 1;

  constructor(reach = 0.38) {
    this.reach = reach;
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(2, rows);
    this.heat = new Float32Array(this.cols * this.rows);
  }

  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 0;
    return this.heat[y * this.cols + x];
  }

  step(timeMs: number): void {
    const { cols, rows, heat } = this;
    const bottom = (rows - 1) * cols;
    for (let x = 0; x < cols; x++) {
      const base = 0.55 + 0.45 * Math.sin(x * 0.21 + timeMs * 0.0013) * Math.sin(x * 0.07 + timeMs * 0.0004);
      heat[bottom + x] = Math.max(0, (base + (Math.random() - 0.5) * 0.6) * this.intensity);
    }
    const cooling = 1 / (rows * Math.max(0.05, this.reach));
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols; x++) {
        const drift = Math.random() < 0.5 ? -1 : 1;
        const sx = Math.min(cols - 1, Math.max(0, x + drift));
        const below = (y + 1) * cols;
        const avg = (heat[below + sx] * 2 + heat[below + x] + heat[Math.min(rows - 1, y + 2) * cols + x]) / 4;
        heat[y * cols + x] = Math.max(0, avg - cooling * (0.5 + Math.random()));
      }
    }
  }
}

/** Maps heat (0..1+) to fire colour channels 0..255 with alpha. */
export function heatColour(h: number): [number, number, number, number] {
  const k = Math.min(1, h);
  return [
    Math.min(255, 255 * k * 1.6),
    Math.min(255, 255 * Math.max(0, k - 0.35) * 1.4),
    Math.min(255, 255 * Math.max(0, k - 0.75) * 1.6),
    Math.min(255, 255 * k * 0.9),
  ];
}

/**
 * Rising-flame backdrop for character-creation screens, drawn at low
 * resolution and scaled up.
 */
export class FireEffect {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: HTMLCanvasElement;
  private readonly fieldCtx: CanvasRenderingContext2D;
  private readonly heat = new HeatField(0.38);
  private image: ImageData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    const field = document.createElement('canvas');
    const fieldCtx = field.getContext('2d');
    if (!ctx || !fieldCtx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.field = field;
    this.fieldCtx = fieldCtx;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    const cols = Math.max(16, Math.round(cssWidth / 6));
    const rows = Math.max(16, Math.round(cssHeight / 6));
    this.field.width = cols;
    this.field.height = rows;
    this.heat.resize(cols, rows);
    this.image = this.fieldCtx.createImageData(cols, rows);
  }

  render(animate: boolean): void {
    if (!this.image) return;
    if (animate) this.heat.step(performance.now());
    const data = this.image.data;
    const heat = this.heat.heat;
    for (let i = 0; i < heat.length; i++) {
      const [r, g, b, a] = heatColour(heat[i]);
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
    this.fieldCtx.putImageData(this.image, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.field, 0, 0, this.canvas.width, this.canvas.height);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
