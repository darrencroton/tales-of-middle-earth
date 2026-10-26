import { cellHash } from './render/colour.ts';
import { FlameField, paintHeat } from './render/fire.ts';
import type { AnimationLevel } from './settings.ts';
import { ListNav } from './ui/listnav.ts';

export type ModuleChoice = 'ToME' | 'Theme';

export interface SaveInfo {
  /** Menu letter on tome2's savefile screen. */
  letter: string;
  name: string;
  /** tome2's summary, e.g. "Grodon, the Ent Warrior is alive". */
  description: string;
}

export type TitleChoice = { kind: 'continue'; save: SaveInfo } | { kind: 'new' };

export interface TitleCallbacks {
  onChoose(choice: TitleChoice): void;
  onSettings(): void;
  /** Export or import saved games. */
  onSaves(): void;
  /** The screen has finished leaving. */
  onHidden(): void;
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  phase: number;
}

const TITLE_TEXT = 'ToME';
const TITLE_FONT = '900 100px Georgia, "Times New Roman", "Liberation Serif", serif';
const IGNITION_MS = 3200;
const SURGE_MS = 1400;
const FADE_MS = 900;
const MAX_EMBERS = 220;
const FPS: Record<AnimationLevel, number> = { full: 60, reduced: 15, off: 0 };

/** Colour of stone lit by firelight: black, crimson, orange, then pale gold. */
export function emberRamp(light: number): [number, number, number] {
  const l = Math.max(0, light);
  const r = 255 * Math.min(1, l * 1.25);
  const g = 255 * Math.min(1, Math.max(0, l - 0.35) * 1.05);
  const b = 255 * Math.min(1, Math.max(0, l - 0.85) * 1.2);
  return [r, g, b];
}

/** Finds the menu letter tome2 shows for a module on its module-selection screen. */
export function moduleKey(screen: string, module: ModuleChoice): string | null {
  for (const match of screen.matchAll(/(?:\[|\b)([a-z])[\])] (\S+)/g)) {
    if (match[2].toLowerCase() === module.toLowerCase()) return match[1];
  }
  return null;
}

/** Rasterises text into a cell mask sized to fit the given grid region. */
export function titleMask(
  cols: number,
  rows: number,
  measure: (text: string, px: number) => { width: number; ascent: number; descent: number },
  draw: (cols: number, rows: number, px: number, x: number, y: number) => Uint8ClampedArray,
): { mask: Uint8Array; top: number; bottom: number } {
  let px = rows;
  let m = measure(TITLE_TEXT, px);
  const scale = Math.min((cols * 0.88) / m.width, (rows * 0.92) / (m.ascent + m.descent));
  px = Math.max(4, Math.floor(px * scale));
  m = measure(TITLE_TEXT, px);
  const x = Math.round((cols - m.width) / 2);
  const y = Math.round((rows - (m.ascent + m.descent)) / 2 + m.ascent);
  const alpha = draw(cols, rows, px, x, y);
  const mask = new Uint8Array(cols * rows);
  let top = rows;
  let bottom = -1;
  for (let i = 0; i < mask.length; i++) {
    if (alpha[i * 4 + 3] > 110) {
      mask[i] = 1;
      const row = Math.floor(i / cols);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }
  return { mask, top, bottom };
}

/**
 * Opening screen: flames rising beneath a mosaic title lit from below,
 * drifting embers, the Ring verse, and the choice to continue a saved hero
 * or begin a new one. It also shows the intro text and game-over messages.
 */
export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: HTMLCanvasElement;
  private readonly fieldCtx: CanvasRenderingContext2D;
  private readonly flames = new FlameField({ reach: 0.5, rise: 8, intensity: 1 });
  private readonly callbacks: TitleCallbacks;
  private readonly animation: () => AnimationLevel;
  private readonly status: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly links: HTMLElement;
  private readonly logo: HTMLElement;
  private readonly nav: ListNav;
  private columnHeat: Float32Array = new Float32Array(0);
  private image: ImageData | null = null;
  private embers: Ember[] = [];
  private mask: Uint8Array = new Uint8Array(0);
  private maskCols = 0;
  private maskRows = 0;
  private maskLeft = 0;
  private maskTop = 0;
  private cell = 8;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private startedAt = performance.now();
  private surgeAt = 0;
  private frame = 0;
  private lastFrame = 0;
  private ready = false;
  private leaveTimer = 0;
  private introDone: (() => void) | null = null;
  private readonly app: HTMLElement | null;
  private visible = true;
  private dimmed = 1;

  constructor(root: HTMLElement, animation: () => AnimationLevel, callbacks: TitleCallbacks) {
    const canvas = root.querySelector<HTMLCanvasElement>('canvas');
    const ctx = canvas?.getContext('2d', { alpha: false });
    const field = document.createElement('canvas');
    const fieldCtx = field.getContext('2d');
    const find = <T extends HTMLElement>(selector: string) => {
      const node = root.querySelector<T>(selector);
      if (!node) throw new Error(`Title screen missing ${selector}`);
      return node;
    };
    if (!canvas || !ctx || !fieldCtx) throw new Error('Canvas 2D context unavailable');
    this.root = root;
    this.canvas = canvas;
    this.ctx = ctx;
    this.field = field;
    this.fieldCtx = fieldCtx;
    this.animation = animation;
    this.callbacks = callbacks;
    this.status = find('.title-status');
    this.progress = find('.title-progress-fill');
    this.choices = find('.title-choices');
    this.intro = find('.title-intro');
    this.links = find('.title-links');
    this.logo = find('.title-logo');
    this.app = document.getElementById('app');
    this.app?.setAttribute('inert', '');
    this.nav = new ListNav(this.choices);

    find<HTMLButtonElement>('[data-link="settings"]').addEventListener('click', () => this.callbacks.onSettings());
    find<HTMLButtonElement>('[data-link="saves"]').addEventListener('click', () => this.callbacks.onSaves());
    this.root.addEventListener('click', (e) => {
      if (this.introDone && !(e.target as HTMLElement).closest('button, a')) this.finishIntro();
    });
    new ResizeObserver(() => this.resize()).observe(root);
    document.addEventListener('visibilitychange', () => this.schedule());
    this.resize();
    this.schedule();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setStatus(text: string, fraction: number | null): void {
    if (this.ready) return;
    this.status.textContent = text;
    this.progress.style.width = fraction === null ? '' : `${Math.round(fraction * 100)}%`;
    this.root.classList.toggle('indeterminate', fraction === null);
  }

  /** Shows Continue (for each saved hero) and New character. */
  setChoices(saves: SaveInfo[]): void {
    this.ready = true;
    this.root.classList.add('ready');
    this.status.textContent = '';
    const buttons: HTMLButtonElement[] = [];
    const make = (label: string, detail: string, primary: boolean, run: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'title-choice primary' : 'title-choice';
      button.dataset.nav = '';
      const main = document.createElement('span');
      main.className = 'title-choice-label';
      main.textContent = label;
      button.append(main);
      if (detail) {
        const sub = document.createElement('span');
        sub.className = 'title-choice-detail';
        sub.textContent = detail;
        button.append(sub);
      }
      button.addEventListener('click', run);
      buttons.push(button);
    };
    saves.forEach((save, i) => {
      make(i === 0 ? 'Continue' : `Play as ${save.name}`, i === 0 ? save.description || save.name : save.description, i === 0, () =>
        this.callbacks.onChoose({ kind: 'continue', save }),
      );
    });
    make(saves.length ? 'New character' : 'Enter Middle-earth', saves.length ? '' : 'Create your hero', saves.length === 0, () =>
      this.callbacks.onChoose({ kind: 'new' }),
    );
    this.choices.replaceChildren(...buttons);
    this.choices.hidden = false;
    this.links.hidden = false;
    this.nav.setActive(0, false);
    if (this.visible) buttons[0]?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }

  /** Hides the choices while a choice is being acted on. */
  setBusy(text: string): void {
    this.choices.hidden = true;
    this.links.hidden = true;
    this.status.textContent = text;
  }

  /** Lets the player pick again (e.g. after cancelling the name prompt). */
  restoreChoices(): void {
    this.choices.hidden = false;
    this.links.hidden = false;
    this.status.textContent = '';
  }

  /**
   * Fades the verse out and the given lines in over the flames; a tap or key
   * continues.
   */
  showIntro(lines: string[], onContinue: () => void): void {
    this.choices.hidden = true;
    this.links.hidden = true;
    this.status.textContent = '';
    this.root.classList.add('intro');
    this.intro.replaceChildren(
      ...lines.map((line, i) => {
        const p = document.createElement('p');
        p.textContent = line;
        p.style.animationDelay = `${300 + i * 260}ms`;
        return p;
      }),
    );
    const hint = document.createElement('p');
    hint.className = 'title-intro-hint';
    hint.textContent = 'Tap to begin';
    hint.style.animationDelay = `${600 + lines.length * 260}ms`;
    this.intro.append(hint);
    this.intro.hidden = false;
    this.introDone = onContinue;
  }

  private finishIntro(): void {
    const done = this.introDone;
    this.introDone = null;
    done?.();
  }

  /** Flares the fire and fades the screen away. */
  leave(): void {
    if (!this.visible || this.leaveTimer) return;
    const animated = this.animation() !== 'off';
    if (animated) {
      this.surgeAt = performance.now();
      this.root.classList.add('leaving');
    }
    this.leaveTimer = window.setTimeout(() => this.hide(), animated ? SURGE_MS + FADE_MS : 0);
    this.schedule();
  }

  handleKey(e: KeyboardEvent): void {
    if (this.introDone) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        this.finishIntro();
      }
      return;
    }
    if (!this.ready || this.choices.hidden) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    if (this.nav.handleKey(e)) {
      e.preventDefault();
      this.nav.active?.focus({ preventScroll: true });
    }
  }

  /** Shows the screen again with a message (game over or failure). */
  showEnd(message: string, error: boolean, actions: { label: string; run: () => void }[]): void {
    window.clearTimeout(this.leaveTimer);
    this.leaveTimer = 0;
    this.surgeAt = 0;
    this.ready = false;
    this.visible = true;
    this.introDone = null;
    this.root.hidden = false;
    this.app?.setAttribute('inert', '');
    this.root.classList.remove('leaving', 'ready', 'intro');
    this.root.classList.toggle('error', error);
    this.intro.hidden = true;
    this.links.hidden = true;
    this.status.textContent = message;
    this.choices.replaceChildren(
      ...actions.map((a) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'title-choice primary';
        button.dataset.nav = '';
        button.textContent = a.label;
        button.addEventListener('click', a.run);
        return button;
      }),
    );
    this.choices.hidden = false;
    this.dimmed = error ? 0.5 : 0.8;
    this.schedule();
  }

  private hide(): void {
    this.leaveTimer = 0;
    this.visible = false;
    this.surgeAt = 0;
    this.root.hidden = true;
    this.root.classList.remove('leaving', 'intro');
    this.app?.removeAttribute('inert');
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.callbacks.onHidden();
  }

  private resize(): void {
    const rect = this.root.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    const cols = Math.max(24, Math.round(this.width / 4));
    const rows = Math.max(24, Math.round(this.height / 4));
    const portrait = this.height > this.width * 1.2;
    this.flames.style.reach = portrait ? 0.46 : 0.34;
    this.flames.style.intensity = portrait ? 1 : 0.62;
    this.field.width = cols;
    this.field.height = rows;
    this.flames.resize(cols, rows);
    this.image = this.fieldCtx.createImageData(cols, rows);

    const rootRect = this.root.getBoundingClientRect();
    const slot = this.logo.getBoundingClientRect();
    this.cell = Math.max(3, Math.min(9, Math.round(slot.height / 34)));
    this.maskCols = Math.max(8, Math.floor(slot.width / this.cell));
    this.maskRows = Math.max(6, Math.floor(slot.height / this.cell));
    this.maskLeft = Math.round(slot.left - rootRect.left + (slot.width - this.maskCols * this.cell) / 2);
    this.maskTop = Math.round(slot.top - rootRect.top + (slot.height - this.maskRows * this.cell) / 2);
    this.buildMask();

    if (this.animation() === 'off') this.startedAt = performance.now() - IGNITION_MS * 2;
    this.schedule();
  }

  private buildMask(): void {
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;
    const result = titleMask(
      this.maskCols,
      this.maskRows,
      (text, px) => {
        sctx.font = TITLE_FONT.replace('100px', `${px}px`);
        const m = sctx.measureText(text);
        return {
          width: m.width,
          ascent: m.actualBoundingBoxAscent || px * 0.72,
          descent: m.actualBoundingBoxDescent || px * 0.05,
        };
      },
      (cols, rows, px, x, y) => {
        scratch.width = cols;
        scratch.height = rows;
        sctx.clearRect(0, 0, cols, rows);
        sctx.font = TITLE_FONT.replace('100px', `${px}px`);
        sctx.fillStyle = '#fff';
        sctx.textBaseline = 'alphabetic';
        sctx.fillText(TITLE_TEXT, x, y);
        return sctx.getImageData(0, 0, cols, rows).data;
      },
    );
    this.mask = result.mask;
  }

  private schedule(): void {
    if (!this.visible || this.frame || document.visibilityState === 'hidden') return;
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    this.frame = 0;
    if (!this.visible) return;
    const fps = FPS[this.animation()];
    const animate = fps > 0;
    if (!animate || now - this.lastFrame >= 1000 / fps - 2) {
      const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.draw(now, dt, animate);
    }
    if (animate || this.surgeAt) this.schedule();
  }

  private fireLevel(now: number): number {
    const elapsed = now - this.startedAt;
    const t = Math.min(1, elapsed / IGNITION_MS);
    let level = t * t * (3 - 2 * t);
    const flare = Math.min(1, Math.max(0, (elapsed - IGNITION_MS * 0.6) / (IGNITION_MS * 1.2)));
    level += 0.25 * Math.sin(Math.PI * flare);
    return level * (1 + 0.9 * this.surge(now)) * this.dimmed;
  }

  /** 0..1 swell of the eruption when leaving. */
  private surge(now: number): number {
    if (!this.surgeAt) return 0;
    const p = Math.min(1, Math.max(0, (now - this.surgeAt) / SURGE_MS));
    return Math.sin(Math.PI * Math.sqrt(p));
  }

  private draw(now: number, dt: number, animate: boolean): void {
    const { ctx } = this;
    const level = this.fireLevel(now);
    const t = animate ? (now - this.startedAt) / 1000 : 6;
    const surge = this.surge(now);
    this.flames.style.rise = 8 + 16 * surge;
    this.flames.update(t, level);
    this.sampleColumnHeat();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawTitle(now, level, animate);
    this.drawFire();
    if (animate) this.updateEmbers(dt, level);
    this.drawEmbers(now);

    if (surge > 0) {
      const h = this.canvas.height;
      const wave = ctx.createLinearGradient(0, h, 0, h * (1 - 0.9 * surge));
      wave.addColorStop(0, `rgba(255,140,40,${0.5 * surge})`);
      wave.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = wave;
      ctx.fillRect(0, 0, this.canvas.width, h);
      ctx.restore();
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const vignette = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.3, w / 2, h * 0.55, Math.hypot(w, h) * 0.65);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  private drawFire(): void {
    if (!this.image) return;
    paintHeat(this.flames.heat, this.image.data);
    this.fieldCtx.putImageData(this.image, 0, 0);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.field, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /** Average flame heat per field column over the lower part of the screen. */
  private sampleColumnHeat(): void {
    const { cols, rows, heat } = this.flames;
    if (this.columnHeat.length !== cols) this.columnHeat = new Float32Array(cols);
    const from = Math.floor(rows * 0.7);
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let y = from; y < rows; y++) sum += heat[y * cols + x];
      this.columnHeat[x] = sum / Math.max(1, rows - from);
    }
  }

  private drawTitle(now: number, level: number, animate: boolean): void {
    const { ctx, dpr, cell, maskCols, maskRows, mask } = this;
    const t = now / 1000;
    const size = cell * dpr;
    const gap = Math.max(1, Math.round(dpr * (cell >= 6 ? 1 : 0.6)));
    const reveal = animate ? Math.min(1.4, Math.max(0, (now - this.startedAt - 500) / 2300) * 1.4) : 1.4;
    const fieldCols = this.columnHeat.length;

    for (let y = 0; y < maskRows; y++) {
      const fromBottom = 1 - y / Math.max(1, maskRows - 1);
      const under = 1 - fromBottom;
      const rowReveal = Math.min(1, Math.max(0, (reveal - fromBottom) * 3));
      if (rowReveal <= 0) continue;
      for (let x = 0; x < maskCols; x++) {
        const i = y * maskCols + x;
        if (!mask[i]) continue;
        const edge =
          x === 0 || !mask[i - 1] || x === maskCols - 1 || !mask[i + 1] ||
          y === 0 || !mask[i - maskCols] || y === maskRows - 1 || !mask[i + maskCols];
        const screenX = this.maskLeft + (x + 0.5) * cell;
        const column = fieldCols ? this.columnHeat[Math.min(fieldCols - 1, Math.floor((screenX / this.width) * fieldCols))] : 0.5;
        const grain = 0.8 + 0.35 * cellHash(x, y);
        const shimmer = animate ? 1 + 0.05 * Math.sin(t * 1.4 + cellHash(y, x) * 6.28) : 1;
        const light = level * rowReveal * shimmer * (0.1 + 1.25 * under * under) * (0.7 + 0.6 * Math.min(1, column * 1.6));
        let [r, g, b] = emberRamp(light * grain);
        if (edge) {
          const rim = level * rowReveal * (0.25 + 0.75 * under) * (0.7 + 0.5 * column);
          r += 255 * 0.5 * rim;
          g += 150 * 0.5 * rim;
          b += 50 * 0.5 * rim;
        }
        ctx.fillStyle = `rgb(${Math.min(255, r) | 0},${Math.min(255, g) | 0},${Math.min(255, b) | 0})`;
        ctx.fillRect(
          Math.round((this.maskLeft + x * cell) * dpr),
          Math.round((this.maskTop + y * cell) * dpr),
          size - gap,
          size - gap,
        );
      }
    }

    if (level > 0) {
      const cx = (this.maskLeft + (maskCols * cell) / 2) * dpr;
      const cy = (this.maskTop + maskRows * cell) * dpr;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maskCols * cell * dpr * 0.65);
      glow.addColorStop(0, `rgba(255,110,25,${Math.min(0.35, 0.2 * level)})`);
      glow.addColorStop(1, 'rgba(255,70,10,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
  }

  private updateEmbers(dt: number, level: number): void {
    const spawn = level * (this.surgeAt ? 5 : 0.9) * dt * 60;
    for (let n = 0; n < spawn && this.embers.length < MAX_EMBERS; n++) {
      if (Math.random() > 0.5) continue;
      const maxLife = 4 + Math.random() * 4;
      this.embers.push({
        x: Math.random() * this.width,
        y: this.height - Math.random() * this.height * 0.1,
        vx: (Math.random() - 0.5) * 10,
        vy: -(14 + Math.random() * 34),
        life: maxLife,
        maxLife,
        size: 0.8 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (const e of this.embers) {
      e.life -= dt;
      e.phase += dt * 1.2;
      e.x += (e.vx + Math.sin(e.phase) * 9) * dt;
      e.y += e.vy * dt;
      e.vy *= 1 - 0.05 * dt;
    }
    this.embers = this.embers.filter((e) => e.life > 0 && e.y > -10);
  }

  private drawEmbers(now: number): void {
    const { ctx, dpr } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      const k = e.life / e.maxLife;
      const fadeIn = Math.min(1, (e.maxLife - e.life) * 2);
      const twinkle = 0.75 + 0.25 * Math.sin(now / 260 + e.phase * 3);
      const radius = e.size * dpr * (1.5 + 2.5 * k);
      const g = ctx.createRadialGradient(e.x * dpr, e.y * dpr, 0, e.x * dpr, e.y * dpr, radius);
      g.addColorStop(0, `rgba(255,${180 + 60 * k},${90 * k},${0.85 * k * fadeIn * twinkle})`);
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(e.x * dpr - radius, e.y * dpr - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }
}
