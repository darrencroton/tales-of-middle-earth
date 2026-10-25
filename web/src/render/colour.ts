/** Linear-ish RGB triple; components nominally 0..1 but may exceed 1 for light. */
export type RGB = readonly [number, number, number];

export const BLACK: RGB = [0, 0, 0];

/* Angband attribute colours (TERM_DARK .. TERM_L_UMBER) used until the engine sends its palette. */
export const BASE_ATTR_COLOURS: readonly RGB[] = [
  [0, 0, 0],
  [1, 1, 1],
  [0.5, 0.5, 0.5],
  [1, 0.5, 0],
  [0.75, 0, 0],
  [0, 0.5, 0.25],
  [0, 0.25, 1],
  [0.5, 0.25, 0],
  [0.25, 0.25, 0.25],
  [0.75, 0.75, 0.75],
  [1, 0, 1],
  [1, 1, 0],
  [1, 0.25, 0.25],
  [0, 1, 0],
  [0, 1, 1],
  [0.75, 0.5, 0.25],
];

export function add(a: RGB, b: RGB): RGB {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function multiply(a: RGB, b: RGB): RGB {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function luminance(a: RGB): number {
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

export function desaturate(a: RGB, amount: number): RGB {
  const l = luminance(a);
  return mix(a, [l, l, l], amount);
}

export function maxComponent(a: RGB): number {
  return Math.max(a[0], a[1], a[2]);
}

function channel(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function toCss(a: RGB): string {
  return `rgb(${channel(a[0])},${channel(a[1])},${channel(a[2])})`;
}

/** Deterministic hash of a cell position to 0..1. */
export function cellHash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth time-varying noise in -1..1 for a cell, used for flicker and shimmer. */
export function cellNoise(x: number, y: number, t: number, speed = 1): number {
  const phase = cellHash(x, y) * Math.PI * 2;
  const p2 = cellHash(y, x, 7) * Math.PI * 2;
  return 0.6 * Math.sin(t * 2.1 * speed + phase) + 0.4 * Math.sin(t * 3.7 * speed + p2);
}
