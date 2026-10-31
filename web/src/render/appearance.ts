import {
  BASE_ATTR_COLOURS,
  add,
  cellHash,
  cellNoise,
  desaturate,
  mix,
  multiply,
  scale,
  type RGB,
} from './colour.ts';
import { lightAt, type LightFrame } from './lighting.ts';
import { attrColour, type Material } from './materials.ts';
import {
  CAVE_MARK,
  CAVE_SEEN,
  LAYER_MASK,
  LAYER_MULTI_HUED,
  LAYER_PLAYER,
  LAYER_TERRAIN,
  LAYER_UNKNOWN,
  NO_EFFECT,
} from './snapshot.ts';

export type GlyphMode = 'brogue' | 'classic';

export interface CellAppearance {
  glyph: string;
  fg: RGB;
  bg: RGB;
  solid: boolean;
  /** Terrain symbol (centred by its ink) rather than a creature or item letter. */
  terrain: boolean;
}

export interface AppearanceContext {
  frame: LightFrame;
  materials: readonly Material[];
  palette: readonly RGB[];
  glyphMode: GlyphMode;
}

const MEMORY_TINT: RGB = [0.0, 0.02, 0.09];
const HALLUCINATION_GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ&!?=$|"~';
const UNKNOWN_MATERIAL: Material = {
  glyph: null,
  fg: null,
  bg: [0.11, 0.1, 0.09],
  solid: false,
  blocksLight: false,
  dance: 0,
  emit: null,
  walkable: false,
  door: false,
  floor: false,
};

export function rememberedColour(c: RGB, brightness: number): RGB {
  return add(scale(desaturate(c, 0.75), brightness), MEMORY_TINT);
}

function shimmerColour(palette: readonly RGB[], x: number, y: number, time: number): RGB {
  const index = 1 + (Math.floor(time * 3 + cellHash(x, y) * 15) % 15);
  return attrColour(index, palette);
}

/**
 * Resolves the glyph and lit colours for one map cell, or null for unknown cells.
 */
export function cellAppearance(ctx: AppearanceContext, x: number, y: number): CellAppearance | null {
  const { frame, materials, palette, glyphMode } = ctx;
  const { snap, time, animate } = frame;
  const i = y * snap.width + x;
  const layerByte = snap.layer[i];
  const layer = layerByte & LAYER_MASK;
  if (layer === LAYER_UNKNOWN) return null;

  const flags = snap.info[i];
  const visible = (flags & CAVE_SEEN) !== 0;
  const terrainKnown = (flags & (CAVE_MARK | CAVE_SEEN)) !== 0;
  const mat = terrainKnown ? (materials[snap.feat[i]] ?? UNKNOWN_MATERIAL) : UNKNOWN_MATERIAL;
  const isTerrain = layer === LAYER_TERRAIN;
  const engineChar = String.fromCharCode(snap.glyph[i]);

  let bg: RGB = terrainKnown ? mat.bg : [0, 0, 0];
  let fg: RGB;
  let glyph: string;

  if (isTerrain) {
    glyph = glyphMode === 'brogue' && mat.glyph !== null ? mat.glyph : engineChar;
    fg = glyphMode === 'brogue' && mat.fg ? mat.fg : attrColour(snap.attr[i], palette);
  } else {
    glyph = engineChar;
    fg = attrColour(snap.attr[i], palette);
  }

  if (layerByte & LAYER_MULTI_HUED && !isTerrain) fg = shimmerColour(palette, x, y, animate ? time : 0);

  const solid = isTerrain && mat.solid && glyphMode === 'brogue';
  if (mat.solid) bg = scale(bg, 0.9 + 0.2 * cellHash(x, y));

  if (mat.dance && animate) {
    const n = cellNoise(x, y, time, 1.3);
    bg = scale(bg, 1 + mat.dance * n);
    fg = scale(fg, 1 + mat.dance * 0.6 * n);
  }

  const effect = snap.effect[i];
  if (effect !== NO_EFFECT) {
    const gas = attrColour(effect, palette);
    bg = mix(bg, scale(gas, 0.55), 0.6);
  }

  if (visible) {
    const light = lightAt(frame, x, y);
    bg = multiply(bg, light);
    if (isTerrain) {
      fg = multiply(fg, light);
    } else if (layer !== LAYER_PLAYER) {
      fg = mix(fg, multiply(fg, light), 0.3);
    }
  } else if (isTerrain) {
    bg = rememberedColour(bg, 0.32);
    fg = rememberedColour(fg, 0.42);
  } else {
    bg = rememberedColour(bg, 0.32);
    if (layer !== LAYER_PLAYER) fg = mix(fg, rememberedColour(fg, 0.6), 0.5);
  }

  if (snap.hallucinating && !isTerrain && layer !== LAYER_PLAYER) {
    const phase = Math.floor(time * 2);
    fg = BASE_ATTR_COLOURS[1 + Math.floor(cellHash(x, y, phase) * 15)];
    glyph = HALLUCINATION_GLYPHS[Math.floor(cellHash(y, x, phase) * HALLUCINATION_GLYPHS.length)];
  }

  return { glyph, fg, bg, solid, terrain: isTerrain };
}
