const LATTICE = 256;

/** Smooth, tileable 2D value noise in 0..1. */
export class ValueNoise {
  private readonly values: Float32Array;

  constructor(seed = 1) {
    this.values = new Float32Array(LATTICE * LATTICE);
    let s = seed >>> 0 || 1;
    for (let i = 0; i < this.values.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      this.values[i] = ((s >>> 0) % 10000) / 10000;
    }
  }

  at(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const tx = x - xf;
    const ty = y - yf;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const x0 = xf & (LATTICE - 1);
    const y0 = yf & (LATTICE - 1);
    const x1 = (x0 + 1) & (LATTICE - 1);
    const y1 = (y0 + 1) & (LATTICE - 1);
    const v = this.values;
    const a = v[y0 * LATTICE + x0];
    const b = v[y0 * LATTICE + x1];
    const c = v[y1 * LATTICE + x0];
    const d = v[y1 * LATTICE + x1];
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  }
}

export interface FlameStyle {
  /** Fraction of the height the tallest tongues reach (0..1). */
  reach: number;
  /** Upward drift of the flame texture, in field rows per second. */
  rise: number;
  /** Overall brightness multiplier. */
  intensity: number;
}

/**
 * Flames as a continuous function of position and time: layers of smooth
 * noise drift upwards and are shaped into tongues that fade with height.
 * Nothing is random per frame, so motion stays smooth at any frame rate.
 */
export class FlameField {
  cols = 0;
  rows = 0;
  heat: Float32Array = new Float32Array(0);
  style: FlameStyle;
  private readonly noise = new ValueNoise(7);
  private readonly detail = new ValueNoise(91);

  constructor(style: FlameStyle) {
    this.style = style;
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(2, rows);
    this.heat = new Float32Array(this.cols * this.rows);
  }

  /** Recomputes the field for time t (seconds); `level` scales the fire (0 = out). */
  update(t: number, level: number): void {
    const { cols, rows, heat, noise, detail } = this;
    const { reach, rise, intensity } = this.style;
    const scale = 40 / Math.max(cols, 40);
    const k = level * intensity;
    const columnHeights = new Float32Array(cols);
    for (let x = 0; x < cols; x++) {
      const tongue = noise.at(x * 0.045 * scale * 2 + 31.7, t * 0.14);
      const sway = noise.at(x * 0.11 * scale * 2 + 7.3, t * 0.32 + 50);
      columnHeights[x] = reach * (0.45 + 0.75 * tongue * tongue + 0.2 * sway);
    }
    for (let y = 0; y < rows; y++) {
      const up = 1 - y / (rows - 1);
      const fy = (y + t * rise) * scale;
      for (let x = 0; x < cols; x++) {
        const warp = (noise.at(x * 0.05 * scale + 100, fy * 0.05 + t * 0.1) - 0.5) * 6;
        const fx = (x + warp) * scale;
        const n = noise.at(fx * 0.09, fy * 0.07) * 0.62 + detail.at(fx * 0.23, fy * 0.19) * 0.38;
        const height = columnHeights[x];
        const falloff = up / Math.max(0.05, height);
        const body = n * 1.35 - falloff * 0.9;
        const taper = 1.15 - falloff * 0.35;
        heat[y * cols + x] = body <= 0 || taper <= 0 ? 0 : body * taper * k;
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

/** Writes a heat field into RGBA image data. */
export function paintHeat(heat: Float32Array, data: Uint8ClampedArray): void {
  for (let i = 0; i < heat.length; i++) {
    const [r, g, b, a] = heatColour(heat[i]);
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = a;
  }
}

/**
 * Low flame backdrop behind character creation, drawn at low resolution
 * and scaled up smoothly.
 */
export class FireEffect {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: HTMLCanvasElement;
  private readonly fieldCtx: CanvasRenderingContext2D;
  private readonly flames = new FlameField({ reach: 0.42, rise: 9, intensity: 0.85 });
  private image: ImageData | null = null;
  private readonly started = performance.now();

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
    const cols = Math.max(16, Math.round(cssWidth / 5));
    const rows = Math.max(16, Math.round(cssHeight / 5));
    this.field.width = cols;
    this.field.height = rows;
    this.flames.resize(cols, rows);
    this.image = this.fieldCtx.createImageData(cols, rows);
  }

  render(animate: boolean): void {
    if (!this.image) return;
    const t = animate ? (performance.now() - this.started) / 1000 : 4;
    this.flames.update(t, 1);
    paintHeat(this.flames.heat, this.image.data);
    this.fieldCtx.putImageData(this.image, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.field, 0, 0, this.canvas.width, this.canvas.height);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
