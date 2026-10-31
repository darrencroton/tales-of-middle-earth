import { BASE_ATTR_COLOURS, scale, type RGB } from './colour.ts';

/* Feature flag bits exported by engine/snapshot.cc. */
export const FB_NO_WALK = 1 << 0;
export const FB_NO_VISION = 1 << 1;
export const FB_FLOOR = 1 << 2;
export const FB_WALL = 1 << 3;
export const FB_PERMANENT = 1 << 4;
export const FB_DOOR = 1 << 5;
export const FB_ATTR_MULTI = 1 << 6;

export interface FeatureInfo {
  name: string;
  ch: number;
  attr: number;
  flags: number;
}

export interface Emission {
  colour: RGB;
  radius: number;
}

export interface Material {
  /** Brogue-style glyph; null keeps the engine's character. */
  glyph: string | null;
  /** Foreground colour; null uses the engine attribute colour. */
  fg: RGB | null;
  bg: RGB;
  /** Draw as a solid block (walls) rather than a glyph. */
  solid: boolean;
  blocksLight: boolean;
  /** Amplitude of time-varying colour shimmer. */
  dance: number;
  emit: Emission | null;
  /** The player can walk onto it. */
  walkable: boolean;
  /** A door (open or closed). */
  door: boolean;
  /** Floor, where the hero can push past a companion (tome2's cave_floor_bold). */
  floor: boolean;
}

const FLOOR_BG: RGB = [0.11, 0.1, 0.09];

function material(partial: Partial<Material> & Pick<Material, 'bg'>): Material {
  return {
    glyph: null,
    fg: null,
    solid: false,
    blocksLight: false,
    dance: 0,
    emit: null,
    walkable: true,
    floor: false,
    door: false,
    ...partial,
  };
}

function wall(bg: RGB, extra: Partial<Material> = {}): Material {
  return material({ bg, solid: true, blocksLight: true, ...extra });
}

type Rule = [RegExp, (f: FeatureInfo) => Material];

/* Ordered by specificity: the first matching rule wins. */
const RULES: Rule[] = [
  [/^nothing$|^void$/, () => material({ glyph: ' ', bg: [0, 0, 0] })],
  [/with treasure/, () => wall([0.34, 0.24, 0.16], { solid: false, glyph: '*', fg: [1, 0.78, 0.25] })],
  [/^secret door$|granite wall|illusion wall|underground tunnel/, () => wall([0.36, 0.33, 0.31])],
  [/permanent wall/, () => wall([0.27, 0.26, 0.3])],
  [/magma vein/, () => wall([0.38, 0.24, 0.18])],
  [/quartz vein/, () => wall([0.48, 0.47, 0.5])],
  [/ice wall/, () => wall([0.55, 0.72, 0.82])],
  [/lava wall/, () => wall([0.55, 0.14, 0.04], { emit: { colour: [0.9, 0.3, 0.08], radius: 2 }, dance: 0.08 })],
  [/sandwall/, () => wall([0.56, 0.46, 0.26])],
  [/glass wall/, () => wall([0.3, 0.48, 0.58], { blocksLight: false })],
  [/grass roof/, () => wall([0.52, 0.43, 0.2])],
  [/brick roof/, () => wall([0.46, 0.16, 0.12])],
  [/small window|^window$/, () => wall([0.36, 0.33, 0.31], { solid: false, glyph: '▫', fg: [0.95, 0.85, 0.5] })],
  [/rain barrel/, () => material({ glyph: '○', fg: [0.6, 0.42, 0.22], bg: FLOOR_BG })],
  [/^building$/, () => material({ bg: [0.32, 0.2, 0.1], emit: { colour: [0.55, 0.42, 0.25], radius: 1 } })],
  [/jammed door|locked door|^door$/, () => material({ glyph: '+', fg: [0.85, 0.6, 0.32], bg: [0.3, 0.18, 0.08], blocksLight: true })],
  [/open door|broken door/, () => material({ glyph: "'", fg: [0.85, 0.6, 0.32], bg: [0.2, 0.13, 0.07] })],
  [/staircase|shaft|quest (entrance|exit|down level|up level)|town exit|path to the/, () =>
    material({ bg: [0.16, 0.15, 0.17] })],
  [/pool of deep lava/, () =>
    material({ glyph: '≈', fg: [1, 0.78, 0.35], bg: [0.78, 0.22, 0.03], dance: 0.22, emit: { colour: [1, 0.42, 0.12], radius: 4 } })],
  [/shallow lava/, () =>
    material({ glyph: '≈', fg: [1, 0.62, 0.22], bg: [0.6, 0.15, 0.02], dance: 0.18, emit: { colour: [0.95, 0.38, 0.1], radius: 3 } })],
  [/great fire/i, () =>
    material({ glyph: '^', fg: [1, 0.7, 0.25], bg: [0.55, 0.12, 0.01], dance: 0.3, emit: { colour: [1, 0.5, 0.15], radius: 4 } })],
  [/deep water/, () => material({ glyph: '≈', fg: [0.32, 0.48, 0.9], bg: [0.04, 0.12, 0.4], dance: 0.12 })],
  [/tainted water/, () => material({ glyph: '≈', fg: [0.55, 0.58, 0.3], bg: [0.17, 0.19, 0.07], dance: 0.08 })],
  [/shallow water|encircling sea/i, () => material({ glyph: '≈', fg: [0.5, 0.7, 0.98], bg: [0.1, 0.26, 0.56], dance: 0.1 })],
  [/fountain/, () => material({ glyph: '⌂', fg: [0.55, 0.75, 1], bg: [0.08, 0.16, 0.3], dance: 0.06 })],
  [/dark pit/, () => material({ glyph: '∷', fg: [0.15, 0.13, 0.2], bg: [0.01, 0.01, 0.03] })],
  [/dead tree/, () => material({ glyph: '♣', fg: [0.48, 0.38, 0.26], bg: [0.1, 0.08, 0.05], blocksLight: true })],
  [/small tree/, () => material({ glyph: '♣', fg: [0.38, 0.72, 0.3], bg: [0.06, 0.14, 0.05] })],
  [/^tree$/, () => material({ glyph: '♣', fg: [0.18, 0.6, 0.24], bg: [0.04, 0.12, 0.04], blocksLight: true })],
  [/high mountain/, () => material({ glyph: '▲', fg: [0.92, 0.92, 0.96], bg: [0.28, 0.27, 0.27], blocksLight: true })],
  [/mountain/, () => material({ glyph: '▲', fg: [0.66, 0.58, 0.48], bg: [0.22, 0.19, 0.16], blocksLight: true })],
  [/grass with flowers/, () => material({ glyph: '"', fg: [0.78, 0.48, 0.66], bg: [0.07, 0.15, 0.05] })],
  [/grass|field/, () => material({ glyph: '"', fg: [0.24, 0.46, 0.18], bg: [0.07, 0.15, 0.05] })],
  [/^dirt$/, () => material({ glyph: '·', fg: [0.56, 0.41, 0.26], bg: [0.16, 0.11, 0.06] })],
  [/^mud$/, () => material({ glyph: '·', fg: [0.46, 0.36, 0.2], bg: [0.18, 0.12, 0.05], dance: 0.03 })],
  [/^sand$/, () => material({ glyph: '·', fg: [0.86, 0.76, 0.46], bg: [0.34, 0.29, 0.15] })],
  [/^ice$/, () => material({ glyph: '·', fg: [0.82, 0.92, 1], bg: [0.42, 0.56, 0.66] })],
  [/^ash$/, () => material({ glyph: '·', fg: [0.46, 0.46, 0.46], bg: [0.12, 0.12, 0.12] })],
  [/nether mist/, () => material({ glyph: '·', fg: [0.75, 0.45, 0.95], bg: [0.14, 0.05, 0.2], dance: 0.15 })],
  [/cobblestone/, () => material({ glyph: '·', fg: [0.62, 0.62, 0.64], bg: [0.2, 0.2, 0.22] })],
  [/rubble/, () => material({ glyph: ':', fg: [0.62, 0.56, 0.5], bg: FLOOR_BG, blocksLight: true })],
  [/^web$/, () => material({ glyph: '#', fg: [0.85, 0.85, 0.8], bg: FLOOR_BG })],
  [/^trap$|monster trap/, () => material({ fg: [0.95, 0.42, 0.4], bg: FLOOR_BG })],
  [/glyph of warding/, () => material({ fg: [1, 0.92, 0.45], bg: FLOOR_BG, emit: { colour: [0.5, 0.45, 0.15], radius: 1 } })],
  [/explosive rune/, () => material({ fg: [1, 0.35, 0.3], bg: FLOOR_BG, emit: { colour: [0.5, 0.12, 0.08], radius: 1 } })],
  [/altar/i, () => material({ bg: [0.2, 0.18, 0.22], emit: { colour: [0.35, 0.32, 0.45], radius: 2 } })],
  [/jumpgate/i, () => material({ bg: [0.15, 0.05, 0.2], dance: 0.2, emit: { colour: [0.5, 0.2, 0.6], radius: 2 } })],
  [/open floor/, () => material({ glyph: '·', fg: [0.56, 0.53, 0.48], bg: FLOOR_BG })],
];

export function attrColour(attr: number, palette: readonly RGB[] = BASE_ATTR_COLOURS): RGB {
  return palette[attr & 0x0f] ?? BASE_ATTR_COLOURS[attr & 0x0f];
}

function fallback(f: FeatureInfo): Material {
  const colour = attrColour(f.attr);
  if ((f.flags & FB_WALL) || ((f.flags & FB_NO_VISION) && (f.flags & FB_NO_WALK))) {
    return wall(scale(colour, 0.42));
  }
  return material({
    bg: FLOOR_BG,
    blocksLight: (f.flags & FB_NO_VISION) !== 0,
    dance: f.flags & FB_ATTR_MULTI ? 0.15 : 0,
  });
}

export function classifyFeature(f: FeatureInfo): Material {
  const name = f.name.toLowerCase();
  const rule = RULES.find(([pattern]) => pattern.test(name));
  const m = rule ? rule[1](f) : fallback(f);
  return { ...m, walkable: (f.flags & FB_NO_WALK) === 0, door: (f.flags & FB_DOOR) !== 0, floor: (f.flags & FB_FLOOR) !== 0 };
}

export function buildMaterials(features: readonly FeatureInfo[]): Material[] {
  return features.map(classifyFeature);
}
