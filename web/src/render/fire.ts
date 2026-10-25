/**
 * Rising-flame backdrop for the title and character-creation screens: a heat
 * field diffused upwards with cooling, drawn at low resolution and scaled up.
 */
export class FireEffect {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: HTMLCanvasElement;
  private readonly fieldCtx: CanvasRenderingContext2D;
  private heat: Float32Array = new Float32Array(0);
  private cols = 0;
  private rows = 0;
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
    this.cols = Math.max(16, Math.round(cssWidth / 6));
    this.rows = Math.max(16, Math.round(cssHeight / 6));
    this.field.width = this.cols;
    this.field.height = this.rows;
    this.heat = new Float32Array(this.cols * this.rows);
    this.image = this.fieldCtx.createImageData(this.cols, this.rows);
  }

  private step(): void {
    const { cols, rows, heat } = this;
    const bottom = (rows - 1) * cols;
    for (let x = 0; x < cols; x++) {
      const base = 0.55 + 0.45 * Math.sin(x * 0.21 + performance.now() * 0.0013) * Math.sin(x * 0.07);
      heat[bottom + x] = Math.max(0, base + (Math.random() - 0.5) * 0.6);
    }
    const cooling = 2.6 / rows;
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

  render(animate: boolean): void {
    if (!this.image) return;
    if (animate) this.step();
    const data = this.image.data;
    for (let i = 0; i < this.heat.length; i++) {
      const h = Math.min(1, this.heat[i]);
      const o = i * 4;
      data[o] = Math.min(255, 255 * h * 1.6);
      data[o + 1] = Math.min(255, 255 * Math.max(0, h - 0.35) * 1.4);
      data[o + 2] = Math.min(255, 255 * Math.max(0, h - 0.75) * 1.6);
      data[o + 3] = Math.min(255, 255 * h * 0.9);
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
