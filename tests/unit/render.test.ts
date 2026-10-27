import { FlameField } from '../../web/src/render/fire.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellAppearance, rememberedColour, type AppearanceContext } from '../../web/src/render/appearance.ts';
import { BASE_ATTR_COLOURS, cellHash, desaturate, luminance, mix, toCss } from '../../web/src/render/colour.ts';
import { computeEmissive, falloff, hasLineOfLight, lightAt, type LightFrame } from '../../web/src/render/lighting.ts';
import { FB_FLOOR, FB_NO_VISION, FB_NO_WALK, FB_WALL, buildMaterials, classifyFeature, type FeatureInfo } from '../../web/src/render/materials.ts';
import {
  CAVE_GLOW,
  CAVE_MARK,
  CAVE_PLIT,
  CAVE_SEEN,
  LAYER_MONSTER,
  LAYER_TERRAIN,
  NO_EFFECT,
  type LevelSnapshot,
} from '../../web/src/render/snapshot.ts';

const feature = (name: string, flags = 0, ch = '.', attr = 1): FeatureInfo => ({ name, ch: ch.charCodeAt(0), attr, flags });

const FEATURES: FeatureInfo[] = [
  feature('nothing'),
  feature('open floor', FB_FLOOR),
  feature('granite wall', FB_WALL | FB_NO_VISION | FB_NO_WALK, '#'),
  feature('pool of deep lava', FB_FLOOR, '.', 12),
];
const FLOOR = 1;
const WALL = 2;
const LAVA = 3;

function makeSnapshot(width: number, height: number, fill: Partial<Record<'feat' | 'info' | 'layer', number>> = {}): LevelSnapshot {
  const n = width * height;
  return {
    inDungeon: true,
    icky: false,
    width,
    height,
    py: 0,
    px: 0,
    lightRadius: 2,
    depth: 3,
    wild: false,
    blind: false,
    hallucinating: false,
    panelRow: 0,
    panelCol: 0,
    rowMap: 1,
    colMap: 13,
    atCommand: true,
    turn: 0,
    floorObjects: 0,
    feat: new Uint8Array(n).fill(fill.feat ?? FLOOR),
    info: new Uint16Array(n).fill(fill.info ?? 0),
    glyph: new Uint8Array(n).fill('.'.charCodeAt(0)),
    attr: new Uint8Array(n).fill(1),
    layer: new Uint8Array(n).fill(fill.layer ?? LAYER_TERRAIN),
    effect: new Uint8Array(n).fill(NO_EFFECT),
  };
}

describe('colour helpers', () => {
  it('formats and clamps CSS colours', () => {
    assert.equal(toCss([0, 0.5, 2]), 'rgb(0,128,255)');
  });

  it('mixes and desaturates', () => {
    assert.deepEqual(mix([0, 0, 0], [1, 1, 1], 0.25), [0.25, 0.25, 0.25]);
    const grey = desaturate([1, 0, 0], 1);
    assert.ok(Math.abs(grey[0] - grey[1]) < 1e-9 && Math.abs(grey[1] - grey[2]) < 1e-9);
    assert.ok(Math.abs(luminance(grey) - luminance([1, 0, 0])) < 1e-9);
  });

  it('hashes cells deterministically into 0..1', () => {
    assert.equal(cellHash(3, 4), cellHash(3, 4));
    assert.notEqual(cellHash(3, 4), cellHash(4, 3));
    for (let i = 0; i < 100; i++) {
      const h = cellHash(i, i * 7);
      assert.ok(h >= 0 && h <= 1);
    }
  });
});

describe('materials', () => {
  it('classifies tome2 terrain by name', () => {
    assert.equal(classifyFeature(feature('granite wall', FB_WALL)).solid, true);
    assert.equal(classifyFeature(feature('open floor', FB_FLOOR)).glyph, '·');
    assert.equal(classifyFeature(feature('pool of deep water')).glyph, '≈');
    assert.ok(classifyFeature(feature('pool of deep lava')).emit);
    assert.equal(classifyFeature(feature('tree')).glyph, '♣');
    assert.equal(classifyFeature(feature('locked door')).glyph, '+');
  });

  it('keeps shop entrances as glyphs, not solid blocks', () => {
    const shop = classifyFeature(feature('Building', 0, '1'));
    assert.equal(shop.solid, false);
    assert.equal(shop.glyph, null);
  });

  it('prefers treasure veins over plain veins', () => {
    const vein = classifyFeature(feature('magma vein with treasure', FB_WALL, '*'));
    assert.equal(vein.glyph, '*');
    assert.equal(vein.solid, false);
  });

  it('falls back on flags for unknown features', () => {
    assert.equal(classifyFeature(feature('mystery rock', FB_WALL | FB_NO_VISION | FB_NO_WALK)).solid, true);
    const odd = classifyFeature(feature('strange glyph', FB_FLOOR, '&'));
    assert.equal(odd.solid, false);
    assert.equal(odd.glyph, null);
  });
});

describe('lighting', () => {
  const materials = buildMaterials(FEATURES);

  it('falls off smoothly to zero beyond the radius', () => {
    assert.equal(falloff(0, 3), 1);
    assert.ok(falloff(1, 3) > falloff(2, 3));
    assert.equal(falloff(4, 3), 0);
  });

  it('blocks light behind walls', () => {
    const snap = makeSnapshot(5, 1);
    assert.equal(hasLineOfLight(snap, materials, 0, 0, 4, 0), true);
    snap.feat[2] = WALL;
    assert.equal(hasLineOfLight(snap, materials, 0, 0, 4, 0), false);
    assert.equal(hasLineOfLight(snap, materials, 0, 0, 2, 0), true, 'the wall itself is lit');
  });

  it('spreads lava glow to visible cells only, stopping at walls', () => {
    const snap = makeSnapshot(7, 1, { info: CAVE_SEEN });
    snap.feat[0] = LAVA;
    snap.feat[3] = WALL;
    snap.info[1] = 0;
    const emissive = computeEmissive(snap, materials);
    assert.ok(emissive[0] > 0, 'source lit');
    assert.equal(emissive[1 * 3], 0, 'unseen cell unlit');
    assert.ok(emissive[2 * 3] > 0, 'seen cell lit');
    assert.equal(emissive[4 * 3], 0, 'cell behind wall unlit');
  });

  it('combines torch light, room light and a visibility floor', () => {
    const snap = makeSnapshot(6, 1, { info: CAVE_SEEN });
    snap.info[0] |= CAVE_PLIT;
    snap.info[1] |= CAVE_PLIT;
    snap.info[3] |= CAVE_GLOW;
    const frame: LightFrame = { snap, emissive: new Float32Array(6 * 3), time: 0, animate: false };
    const near = lightAt(frame, 0, 0);
    const far = lightAt(frame, 1, 0);
    assert.ok(near[0] > far[0], 'torch is brighter at the player');
    assert.ok(near[0] > near[2], 'torch light is warm');
    assert.ok(lightAt(frame, 3, 0)[0] > 0.5, 'glowing room is lit');
    assert.ok(lightAt(frame, 5, 0)[0] > 0, 'visible cells are never pitch black');
  });
});

describe('cell appearance', () => {
  const materials = buildMaterials(FEATURES);
  const context = (snap: LevelSnapshot, glyphMode: 'brogue' | 'classic' = 'brogue'): AppearanceContext => ({
    frame: { snap, emissive: new Float32Array(snap.width * snap.height * 3), time: 0, animate: false },
    materials,
    palette: BASE_ATTR_COLOURS,
    glyphMode,
  });

  it('hides unknown cells', () => {
    const snap = makeSnapshot(1, 1, { layer: 0 });
    assert.equal(cellAppearance(context(snap), 0, 0), null);
  });

  it('uses Brogue glyphs or classic characters', () => {
    const snap = makeSnapshot(1, 1, { info: CAVE_SEEN | CAVE_GLOW });
    assert.equal(cellAppearance(context(snap), 0, 0)?.glyph, '·');
    assert.equal(cellAppearance(context(snap, 'classic'), 0, 0)?.glyph, '.');
  });

  it('draws walls as solid blocks in Brogue mode only', () => {
    const snap = makeSnapshot(1, 1, { info: CAVE_SEEN | CAVE_GLOW, feat: WALL });
    assert.equal(cellAppearance(context(snap), 0, 0)?.solid, true);
    assert.equal(cellAppearance(context(snap, 'classic'), 0, 0)?.solid, false);
  });

  it('tints remembered cells dim and blue', () => {
    const snap = makeSnapshot(2, 1, { info: CAVE_MARK });
    snap.info[1] = CAVE_SEEN | CAVE_GLOW;
    const remembered = cellAppearance(context(snap), 0, 0)!;
    const visible = cellAppearance(context(snap), 1, 0)!;
    assert.ok(luminance(remembered.fg) < luminance(visible.fg));
    assert.ok(remembered.bg[2] > remembered.bg[0], 'memory is blue-tinted');
    const memory = rememberedColour([1, 0, 0], 0.4);
    assert.ok(memory[0] < 1 && memory[2] > 0);
  });

  it('keeps monsters vivid in dim light', () => {
    const snap = makeSnapshot(1, 1, { info: CAVE_SEEN, layer: LAYER_MONSTER });
    snap.attr[0] = 4;
    snap.glyph[0] = 'o'.charCodeAt(0);
    const cell = cellAppearance(context(snap), 0, 0)!;
    assert.equal(cell.glyph, 'o');
    assert.ok(cell.fg[0] > 0.5, 'monster colour survives darkness');
  });
});

describe('flames', () => {
  it('stay low on wide and tall screens', () => {
    for (const [cols, rows, reach] of [[210, 98, 0.34], [98, 210, 0.46], [350, 175, 0.4]] as const) {
      const flames = new FlameField({ reach, rise: 8, intensity: 1 });
      flames.resize(cols, rows);
      for (const t of [0, 3.7, 11.2, 40]) {
        flames.update(t, 1.2);
        let top = 0;
        let bottom = 0;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            if (y < rows * 0.3) top = Math.max(top, flames.heat[y * cols + x]);
            if (y > rows * 0.8) bottom = Math.max(bottom, flames.heat[y * cols + x]);
          }
        }
        assert.equal(top, 0, `heat near the top of ${cols}x${rows} at ${t}s`);
        assert.ok(bottom > 0.3, `flames at the bottom of ${cols}x${rows}`);
      }
    }
  });
});
