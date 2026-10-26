import { cellAppearance, type GlyphMode } from './appearance.ts';
import { BASE_ATTR_COLOURS, scale, toCss, type RGB } from './colour.ts';
import { computeEmissive, type LightSource } from './lighting.ts';
import { attrColour, type Material } from './materials.ts';
import { LAYER_MASK, LAYER_OBJECT, type LevelSnapshot } from './snapshot.ts';

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

/** Glyphs with most of their weight low down, lifted so they read as centred. */
const OPTICAL_LIFT: Readonly<Record<string, number>> = { '▲': 1 / 12 };

const MAP_FONT = '"DejaVu Sans Mono", Menlo, Consolas, "Segoe UI Symbol", "Noto Sans Symbols 2", monospace';
const ACCENT: RGB = [0.85, 0.64, 0.25];

/**
 * Draws the dungeon from engine snapshots with Brogue-style lighting,
 * centred on the player.
 */
export class MapRenderer {
  zoom = 22;
  /** Shows the whole level scaled to fit, instead of following the player. */
  overview = false;
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
  private lookCell: MapPoint | null = null;
  private camX = Number.NaN;
  private camY = Number.NaN;
  private panX = 0;
  private panY = 0;
  private panning = false;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private lastTime = 0;
  private glyphOffsets = new Map<string, number>();
  private glyphFont = '';
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

  /** True while the view is moved away from the player by dragging. */
  get panned(): boolean {
    return this.panX !== 0 || this.panY !== 0;
  }

  /** Moves the view by a drag of (dx, dy) CSS pixels, without moving the player. */
  panBy(dx: number, dy: number): void {
    const cellH = this.zoom;
    const cellW = Math.max(1, Math.round(this.zoom * CELL_ASPECT));
    this.panX -= dx / cellW;
    this.panY -= dy / cellH;
    this.panning = true;
    this.clampPan();
  }

  /** Ends a drag; the view stays where it was left. */
  endPan(): void {
    this.panning = false;
  }

  /** Returns the view to the player. */
  resetPan(): void {
    this.panX = 0;
    this.panY = 0;
    this.panning = false;
  }

  private clampPan(): void {
    const snap = this.snap;
    if (!snap) return;
    const { cols, rows } = this.viewportCells();
    const limit = (pan: number, focus: number, span: number, size: number) => {
      if (size <= span) return 0;
      const lo = span / 2 - span * 0.25;
      const hi = size - span / 2 + span * 0.25;
      return Math.max(lo, Math.min(hi, focus + pan)) - focus;
    };
    this.panX = limit(this.panX, snap.px + 0.5, cols, snap.width);
    this.panY = limit(this.panY, snap.py + 0.5, rows, snap.height);
  }

  /** Marks the cell being looked at. */
  setLookCell(point: MapPoint | null): void {
    this.lookCell = point;
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

    let cellH = this.zoom * this.dpr;
    let cellW = Math.max(1, Math.round(this.zoom * CELL_ASPECT)) * this.dpr;
    if (this.overview) {
      const fit = Math.min(this.canvas.width / (snap.width * CELL_ASPECT), this.canvas.height / snap.height);
      cellH = fit;
      cellW = fit * CELL_ASPECT;
    }
    const cols = this.canvas.width / cellW;
    const rows = this.canvas.height / cellH;

    const focus = this.reticle ?? { x: snap.px + this.panX, y: snap.py + this.panY };
    const targetX = this.clampCamera(focus.x + 0.5, cols, snap.width);
    const targetY = this.clampCamera(focus.y + 0.5, rows, snap.height);
    if (this.overview) {
      this.camX = snap.width / 2;
      this.camY = snap.height / 2;
    } else if (Number.isNaN(this.camX) || !animate || this.panning) {
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
    const tiny = fontPx < 7;
    const font = `${fontPx}px ${MAP_FONT}`;
    ctx.font = font;
    if (font !== this.glyphFont) {
      this.glyphFont = font;
      this.glyphOffsets.clear();
    }
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
        if (tiny) {
          const layer = snap.layer[y * snap.width + x] & LAYER_MASK;
          if (layer >= LAYER_OBJECT) {
            ctx.fillStyle = toCss(cell.fg);
            ctx.fillRect(left, top, Math.max(1, width), Math.max(1, height));
          }
          continue;
        }
        if (!cell.solid && cell.glyph !== ' ') {
          ctx.fillStyle = toCss(cell.fg);
          ctx.fillText(cell.glyph, left + width / 2, top + height / 2 + this.glyphOffset(cell.glyph, cell.terrain));
        }
      }
    }

    for (const e of this.effects) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      ctx.fillStyle = toCss(scale(attrColour(e.attr, this.palette), 1.1));
      const ch = String.fromCharCode(e.ch);
      ctx.fillText(ch, px(e.x) + cellW / 2, py(e.y) + cellH / 2 + this.glyphOffset(ch, true));
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

    if (this.overview) {
      const radius = Math.max(7 * this.dpr, cellH * 2.5);
      ctx.strokeStyle = toCss(scale(ACCENT, 0.7 + 0.3 * pulse));
      ctx.lineWidth = Math.max(2, 2 * this.dpr);
      ctx.beginPath();
      ctx.arc(px(snap.px) + cellW / 2, py(snap.py) + cellH / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = line;
    }

    if (this.lookCell) {
      ctx.strokeStyle = toCss(scale(ACCENT, 0.6 + 0.4 * pulse));
      ctx.lineWidth = line * 1.5;
      ctx.strokeRect(px(this.lookCell.x) + line, py(this.lookCell.y) + line, cellW - line * 2, cellH - line * 2);
      ctx.lineWidth = line;
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

  /**
   * Vertical offset from the cell centre (with textBaseline 'middle') that
   * places a glyph well in its cell. Terrain symbols are centred by their
   * ink; letters and item symbols share a baseline with the capital height
   * centred, so descenders still hang below.
   */
  private glyphOffset(glyph: string, terrain: boolean): number {
    const key = `${terrain ? 't' : 'e'}${glyph}`;
    const cached = this.glyphOffsets.get(key);
    if (cached !== undefined) return cached;
    const m = this.ctx.measureText(terrain ? glyph : 'H');
    let offset = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    const lift = OPTICAL_LIFT[glyph];
    if (terrain && lift) offset -= (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * lift;
    if (!Number.isFinite(offset)) offset = 0;
    this.glyphOffsets.set(key, offset);
    return offset;
  }

  private clampCamera(focus: number, span: number, size: number): number {
    if (size <= span) return size / 2;
    if (!this.panned) return focus;
    return Math.max(span / 2 - span * 0.25, Math.min(size - span / 2 + span * 0.25, focus));
  }
}
