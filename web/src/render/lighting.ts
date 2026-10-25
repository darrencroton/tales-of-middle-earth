import { cellNoise, type RGB } from './colour.ts';
import type { Material } from './materials.ts';
import { CAVE_GLOW, CAVE_MLIT, CAVE_PLIT, CAVE_SEEN, type LevelSnapshot } from './snapshot.ts';

export const TORCH_COLOUR: RGB = [1, 0.8, 0.55];
export const ROOM_LIGHT: RGB = [0.95, 0.93, 1.0];
export const DAYLIGHT: RGB = [0.92, 0.9, 0.84];
export const MONSTER_LIGHT: RGB = [0.4, 0.45, 0.55];
export const MIN_VISIBLE_LIGHT: RGB = [0.17, 0.17, 0.21];

export interface LightSource {
  x: number;
  y: number;
  colour: RGB;
  radius: number;
}

/**
 * Returns true when no light-blocking cell lies strictly between the two points.
 */
export function hasLineOfLight(
  snap: Pick<LevelSnapshot, 'width' | 'feat'>,
  materials: readonly Material[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) return true;
    if (materials[snap.feat[y * snap.width + x]]?.blocksLight) return false;
  }
}

export function falloff(distance: number, radius: number): number {
  const f = Math.max(0, 1 - distance / (radius + 1));
  return f * f * (3 - 2 * f);
}

/**
 * Collects emitting terrain plus any extra sources (spell effects) and
 * accumulates their light into visible cells. Returns RGB triples per cell.
 */
export function computeEmissive(
  snap: LevelSnapshot,
  materials: readonly Material[],
  extra: readonly LightSource[] = [],
): Float32Array {
  const { width, height, info, feat } = snap;
  const out = new Float32Array(width * height * 3);
  const sources: LightSource[] = [...extra];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!(info[i] & CAVE_SEEN)) continue;
      const emit = materials[feat[i]]?.emit;
      if (emit) sources.push({ x, y, colour: emit.colour, radius: emit.radius });
    }
  }

  for (const s of sources) {
    const r = Math.ceil(s.radius);
    for (let y = Math.max(0, s.y - r); y <= Math.min(height - 1, s.y + r); y++) {
      for (let x = Math.max(0, s.x - r); x <= Math.min(width - 1, s.x + r); x++) {
        const i = y * width + x;
        if (!(info[i] & CAVE_SEEN)) continue;
        const d = Math.hypot(x - s.x, y - s.y);
        if (d > s.radius) continue;
        if (!hasLineOfLight(snap, materials, s.x, s.y, x, y)) continue;
        const k = falloff(d, s.radius);
        out[i * 3] += s.colour[0] * k;
        out[i * 3 + 1] += s.colour[1] * k;
        out[i * 3 + 2] += s.colour[2] * k;
      }
    }
  }

  return out;
}

export interface LightFrame {
  snap: LevelSnapshot;
  emissive: Float32Array;
  time: number;
  animate: boolean;
}

/** Light reaching a visible cell, as RGB multipliers. */
export function lightAt(frame: LightFrame, x: number, y: number): RGB {
  const { snap, emissive, time, animate } = frame;
  const i = y * snap.width + x;
  const flags = snap.info[i];

  let r = 0;
  let g = 0;
  let b = 0;

  if (snap.wild) {
    [r, g, b] = DAYLIGHT;
  } else if (flags & CAVE_GLOW) {
    const ambient = snap.depth === 0 ? DAYLIGHT : ROOM_LIGHT;
    r += ambient[0];
    g += ambient[1];
    b += ambient[2];
  }

  if (flags & CAVE_PLIT) {
    const d = Math.hypot(x - snap.px, y - snap.py);
    let k = 0.55 + 1.65 * falloff(d, Math.max(1, snap.lightRadius) + 0.5);
    if (animate) k *= 1 + 0.07 * Math.sin(time * 9.3) * Math.sin(time * 5.1) + 0.035 * cellNoise(x, y, time, 2.5);
    r += TORCH_COLOUR[0] * k;
    g += TORCH_COLOUR[1] * k;
    b += TORCH_COLOUR[2] * k;
  }

  if (flags & CAVE_MLIT) {
    r += MONSTER_LIGHT[0];
    g += MONSTER_LIGHT[1];
    b += MONSTER_LIGHT[2];
  }

  const flicker = animate ? 1 + 0.12 * cellNoise(x, y, time, 1.7) : 1;
  r += emissive[i * 3] * flicker;
  g += emissive[i * 3 + 1] * flicker;
  b += emissive[i * 3 + 2] * flicker;

  if (Math.max(r, g, b) < MIN_VISIBLE_LIGHT[0]) {
    r = Math.max(r, MIN_VISIBLE_LIGHT[0]);
    g = Math.max(g, MIN_VISIBLE_LIGHT[1]);
    b = Math.max(b, MIN_VISIBLE_LIGHT[2]);
  }

  return [r, g, b];
}
