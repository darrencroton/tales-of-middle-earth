import { cellAppearance, type GlyphMode } from './appearance.ts';
import { BASE_ATTR_COLOURS, scale, toCss, type RGB } from './colour.ts';
import { computeEmissive, type LightSource } from './lighting.ts';
import { attrColour, type Material } from './materials.ts';
import type { LevelSnapshot } from './snapshot.ts';

export interface MapEffect {
  x: number;
  y: number;
  ch: number;
  attr: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export const MIN_ZOOM = 12;
export const MAX_ZOOM = 48;
export const CELL_ASPECT = 0.62;

const MAP_FONT = '"DejaVu Sans Mono", Menlo, Consolas, "Segoe UI Symbol", "Noto Sans Symbols 2", monospace';
const ACCENT: RGB = [0.85, 0.64, 0.25];

/**
 * Draws the dungeon from engine snapshots with Brogue-style lighting,
 * centred on the player.
 */
export class MapRenderer {
  zoom = 22;
  glyphMode: GlyphMode = 'brogue';
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private snap: LevelSnapshot | null = null;
  private materials: Material[] = [];
  private palette: RGB[] = [...BASE_ATTR_COLOURS];
  private effects: MapEffect[] = [];
  private emissive: Float32Array = new Float32Array(0);
  private highlight: MapPoint | null = null;
  private highlightUntil = 0;
  private reticle: MapPoint | null = null;
  private camX = Number.NaN;
  private camY = Number.NaN;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private lastTime = 0;
  private path: MapPoint[] = [];
  private view = { originX: 0, originY: 0, cellW: 1, cellH: 1 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  get hasLevel(): boolean {
    return this.snap !== null && this.snap.width > 0;
  }

  setMaterials(materials: Material[]): void {
    this.materials = materials;
    this.updateEmissive();
  }

  setPalette(palette: readonly RGB[]): void {
    this.palette = [...palette];
  }

  setSnapshot(snap: LevelSnapshot): void {
    const levelChanged = !this.snap || this.snap.width !== snap.width || this.snap.height !== snap.height || this.snap.depth !== snap.depth;
    this.snap = snap;
    if (levelChanged) {
      this.camX = Number.NaN;
      this.camY = Number.NaN;
    }
    this.updateEmissive();
  }

  setEffects(effects: MapEffect[]): void {
    if (effects.length === 0 && this.effects.length === 0) return;
    this.effects = effects;
    this.updateEmissive();
  }

  /** Travel route drawn as a fading trail of dots. */
  setPath(path: MapPoint[] | null): void {
    this.path = path ?? [];
  }

  /** Dungeon cell under a viewport point (CSS pixels), or null off the level. */
  cellAt(clientX: number, clientY: number): MapPoint | null {
    if (!this.snap) return null;
    const rect = this.canvas.getBoundingClientRect();
    const { originX, originY, cellW, cellH } = this.view;
    const x = Math.floor(((clientX - rect.left) * this.dpr) / cellW + originX);
    const y = Math.floor(((clientY - rect.top) * this.dpr) / cellH + originY);
    if (x < 0 || y < 0 || x >= this.snap.width || y >= this.snap.height) return null;
    return { x, y };
  }

  /** Viewport point (CSS pixels) at the centre of a dungeon cell. */
  cellCentre(x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { originX, originY, cellW, cellH } = this.view;
    return {
      x: rect.left + ((x - originX + 0.5) * cellW) / this.dpr,
      y: rect.top + ((y - originY + 0.5) * cellH) / this.dpr,
    };
  }

  setReticle(point: MapPoint | null): void {
    this.reticle = point;
  }

  flashHighlight(point: MapPoint, durationMs = 2500): void {
    this.highlight = point;
    this.highlightUntil = performance.now() + durationMs;
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * this.dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  /** Viewport size in cells for the current zoom. */
  viewportCells(): { cols: number; rows: number } {
    const cellH = this.zoom;
    const cellW = Math.max(1, Math.round(cellH * CELL_ASPECT));
    return { cols: Math.ceil(this.cssWidth / cellW), rows: Math.ceil(this.cssHeight / cellH) };
  }

  private updateEmissive(): void {
    if (!this.snap || this.materials.length === 0) return;
    const extra: LightSource[] = this.effects.map((e) => ({
      x: e.x,
      y: e.y,
      colour: scale(attrColour(e.attr, this.palette), 0.9),
      radius: 2.5,
    }));
    this.emissive = computeEmissive(this.snap, this.materials, extra);
  }

  render(timeMs: number, animate: boolean): void {
    const { ctx, snap } = this;
    const time = timeMs / 1000;
    const dt = this.lastTime ? Math.min(0.1, time - this.lastTime) : 0;
    this.lastTime = time;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!snap || snap.width === 0 || this.materials.length === 0) return;

    const cellH = this.zoom * this.dpr;
    const cellW = Math.max(1, Math.round(this.zoom * CELL_ASPECT)) * this.dpr;
    const cols = this.canvas.width / cellW;
    const rows = this.canvas.height / cellH;

    const focus = this.reticle ?? { x: snap.px, y: snap.py };
    const targetX = this.clampCamera(focus.x + 0.5, cols, snap.width);
    const targetY = this.clampCamera(focus.y + 0.5, rows, snap.height);
    if (Number.isNaN(this.camX) || !animate) {
      this.camX = targetX;
      this.camY = targetY;
    } else {
      const k = Math.min(1, dt * 10);
      this.camX += (targetX - this.camX) * k;
      this.camY += (targetY - this.camY) * k;
    }

    const originX = this.camX - cols / 2;
    const originY = this.camY - rows / 2;
    this.view = { originX, originY, cellW, cellH };
    const x0 = Math.max(0, Math.floor(originX));
    const y0 = Math.max(0, Math.floor(originY));
    const x1 = Math.min(snap.width - 1, Math.ceil(originX + cols));
    const y1 = Math.min(snap.height - 1, Math.ceil(originY + rows));

    const fontPx = Math.max(1, Math.floor(Math.min(cellH * 0.86, cellW / 0.6)));
    ctx.font = `${fontPx}px ${MAP_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const appearanceCtx = {
      frame: { snap, emissive: this.emissive, time, animate },
      materials: this.materials,
      palette: this.palette,
      glyphMode: this.glyphMode,
    };

    const px = (x: number) => Math.round((x - originX) * cellW);
    const py = (y: number) => Math.round((y - originY) * cellH);

    for (let y = y0; y <= y1; y++) {
      const top = py(y);
      const height = py(y + 1) - top;
      for (let x = x0; x <= x1; x++) {
        const cell = cellAppearance(appearanceCtx, x, y);
        if (!cell) continue;
        const left = px(x);
        const width = px(x + 1) - left;
        ctx.fillStyle = toCss(cell.bg);
        ctx.fillRect(left, top, width, height);
        if (!cell.solid && cell.glyph !== ' ') {
          ctx.fillStyle = toCss(cell.fg);
          ctx.fillText(cell.glyph, left + width / 2, top + height / 2 + this.dpr);
        }
      }
    }

    for (const e of this.effects) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      ctx.fillStyle = toCss(scale(attrColour(e.attr, this.palette), 1.1));
      ctx.fillText(String.fromCharCode(e.ch), px(e.x) + cellW / 2, py(e.y) + cellH / 2 + this.dpr);
    }

    const pulse = animate ? 0.65 + 0.35 * Math.sin(time * 6) : 1;
    const line = Math.max(1, Math.round(1.5 * this.dpr));
    ctx.lineWidth = line;

    if (this.highlight && performance.now() < this.highlightUntil) {
      ctx.strokeStyle = toCss(scale(ACCENT, pulse));
      ctx.strokeRect(px(this.highlight.x) + line / 2, py(this.highlight.y) + line / 2, cellW - line, cellH - line);
    }

    if (this.path.length > 0) {
      const dot = Math.max(2, Math.min(cellW, cellH) * 0.14);
      this.path.forEach((p, i) => {
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return;
        const fade = 1 - i / (this.path.length + 4);
        ctx.fillStyle = `rgba(217,164,65,${(0.35 + 0.5 * fade) * pulse})`;
        ctx.beginPath();
        ctx.arc(px(p.x) + cellW / 2, py(p.y) + cellH / 2, i === this.path.length - 1 ? dot * 1.8 : dot, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (this.reticle) {
      const left = px(this.reticle.x);
      const top = py(this.reticle.y);
      const arm = Math.max(3, cellW * 0.35);
      ctx.strokeStyle = toCss(scale(ACCENT, pulse));
      ctx.beginPath();
      for (const [cx, cy, dx, dy] of [
        [left, top, 1, 1],
        [left + cellW, top, -1, 1],
        [left, top + cellH, 1, -1],
        [left + cellW, top + cellH, -1, -1],
      ]) {
        ctx.moveTo(cx + dx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * arm);
      }
      ctx.stroke();
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  private clampCamera(focus: number, span: number, size: number): number {
    return size <= span ? size / 2 : focus;
  }
}
