import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaName, depthLabel, rowSegments, sortByDistance, statusLabels } from '../../web/src/hud.ts';
import { defaultSettings, sanitiseSettings } from '../../web/src/settings.ts';
import { TerminalBuffer } from '../../web/src/terminal.ts';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('HUD helpers', () => {
  it('labels depth, town and wilderness', () => {
    assert.equal(depthLabel({ depth: 0, dungeon: 'Mirkwood', wild: 0 }), 'Town');
    assert.equal(depthLabel({ depth: 3, dungeon: 'Mirkwood', wild: 0 }), 'Mirkwood · 150 ft (L3)');
    assert.equal(depthLabel({ depth: 0, dungeon: '', wild: 1 }), 'World map');
    assert.equal(depthLabel({ depth: 0, dungeon: '', wild: 0, area: 'Bree' }), 'Bree');
    assert.equal(depthLabel({ depth: 2, dungeon: 'Mirkwood', wild: 0, area: 'Forest' }), 'Mirkwood · 100 ft (L2)');
  });

  it('names surface places from the engine place', () => {
    const place = { wild: 0, depth: 0, quest: 0, levelName: '', town: 0, terrain: 'grass' };
    assert.equal(areaName(null), null);
    assert.equal(areaName(place), 'Grasslands');
    assert.equal(areaName({ ...place, terrain: 'Bree ', town: 1 }), 'Bree');
    assert.equal(areaName({ ...place, wild: 1 }), 'World map');
    assert.equal(areaName({ ...place, depth: 3 }), null);
    assert.equal(areaName({ ...place, terrain: 'Mirkwood' }), 'Mirkwood');
    assert.equal(areaName({ ...place, terrain: '' }), 'The wilds');
  });

  it('lists active status effects and hunger', () => {
    assert.deepEqual(statusLabels({ status: { blind: 3, confused: 0, poisoned: 1 }, food: 5000 }), ['Blind', 'Poisoned']);
    assert.deepEqual(statusLabels({ status: {}, food: 1500 }), ['Hungry']);
    assert.deepEqual(statusLabels({ status: {}, food: 500 }), ['Weak']);
  });

  it('sorts entities by distance from the player', () => {
    const sorted = sortByDistance(
      [
        { x: 10, y: 10, n: 'far' },
        { x: 1, y: 1, n: 'near' },
        { x: 4, y: 0, n: 'mid' },
      ],
      0,
      0,
    );
    assert.deepEqual(sorted.map((e) => e.n), ['near', 'mid', 'far']);
  });

  it('splits a terminal row into coloured segments', () => {
    const chars = bytes('ab  cd   ');
    const attrs = new Uint8Array([1, 1, 1, 1, 4, 4, 0, 0, 0]);
    const segments = rowSegments(chars, attrs, ['c0', 'c1', 'c2', 'c3', 'c4']);
    assert.deepEqual(segments, [
      { text: 'ab  ', colour: 'c1' },
      { text: 'cd', colour: 'c4' },
    ]);
  });
});

describe('settings', () => {
  it('defaults to animation off when reduced motion is preferred', () => {
    assert.equal(defaultSettings(true).animation, 'off');
    assert.equal(defaultSettings(false).animation, 'full');
  });

  it('sanitises stored values', () => {
    const defaults = defaultSettings(false);
    assert.deepEqual(
      sanitiseSettings({ animation: 'reduced', glyphs: 'classic', zoom: 30, textSize: 'large', messages: 'pause', music: 'low', sound: 'off' }, defaults),
      {
        animation: 'reduced',
        glyphs: 'classic',
        zoom: 30,
        textSize: 'large',
        messages: 'pause',
        music: 'low',
        sound: 'off',
      },
    );
    assert.deepEqual(sanitiseSettings({ animation: 'wild', glyphs: 7, zoom: 999, textSize: 'huge', messages: 'loud', music: 11, sound: 'max' }, defaults), {
      animation: 'full',
      glyphs: 'brogue',
      zoom: 48,
      textSize: 'medium',
      messages: 'flow',
      music: 'medium',
      sound: 'medium',
    });
    assert.deepEqual(sanitiseSettings(null, defaults), defaults);
  });
});

describe('terminal overlay helpers', () => {
  it('finds the bounding box of changes against a saved screen', () => {
    const term = new TerminalBuffer(10, 5);
    term.drawText(0, 2, 1, bytes('map'));
    const base = term.copy();
    assert.equal(term.diffBounds(base), null);
    term.drawText(4, 1, 1, bytes('menu'));
    term.drawText(5, 3, 2, bytes('x'));
    term.drawText(0, 0, 1, bytes('prompt'));
    assert.deepEqual(term.diffBounds(base, 1), { x0: 4, y0: 1, x1: 7, y1: 3 });
  });

  it('counts blank cells as unchanged whatever their colour', () => {
    const term = new TerminalBuffer(10, 5);
    term.drawText(0, 2, 1, bytes('map'));
    const saved = term.copy();
    saved.attrs.fill(0, 30);
    saved.attrs[0] = 7;
    assert.equal(term.diffBounds(saved), null);
    saved.attrs[1 + 2 * 10] = 3;
    assert.deepEqual(term.diffBounds(saved), { x0: 1, y0: 2, x1: 1, y1: 2 });
  });

  it('tracks content bounds until cleared', () => {
    const term = new TerminalBuffer(20, 10);
    assert.equal(term.contentBounds(), null);
    term.drawText(2, 3, 1, bytes('  hi '));
    assert.deepEqual(term.contentBounds(), { x0: 4, y0: 3, x1: 5, y1: 3 });
    term.drawText(0, 6, 1, bytes('x'));
    assert.deepEqual(term.contentBounds(), { x0: 0, y0: 3, x1: 5, y1: 6 });
    term.clear();
    assert.equal(term.contentBounds(), null);
  });
});

describe('opening screen helpers', async () => {
  const { moduleKey, titleMask } = await import('../../web/src/title.ts');

  it('finds module menu letters on the tome2 screen', () => {
    const screen = '[a] ToME             b) Theme';
    assert.equal(moduleKey(screen, 'ToME'), 'a');
    assert.equal(moduleKey(screen, 'Theme'), 'b');
    assert.equal(moduleKey('nothing here', 'Theme'), null);
  });

  it('rasterises the title into a centred cell mask', () => {
    const cols = 20;
    const rows = 10;
    const result = titleMask(
      cols,
      rows,
      (text, px) => ({ width: text.length * px * 0.6, ascent: px * 0.7, descent: px * 0.1 }),
      (c, r, _px, x, y) => {
        const data = new Uint8ClampedArray(c * r * 4);
        for (let yy = 0; yy < r; yy++) {
          for (let xx = 0; xx < c; xx++) {
            if (xx >= x && xx < c - x && yy >= y - 4 && yy <= y) data[(yy * c + xx) * 4 + 3] = 255;
          }
        }
        return data;
      },
    );
    assert.equal(result.mask.length, cols * rows);
    assert.ok(result.mask.some((v) => v === 1));
    assert.ok(result.top >= 0 && result.bottom < rows && result.top <= result.bottom);
  });
});

describe('hallucination', async () => {
  const { disguiseMonster, disguiseObject } = await import('../../web/src/hud.ts');

  it('hides creature and item identities', () => {
    const m = disguiseMonster({ id: 3, name: 'Grip, Farmer Maggot’s Dog', ch: 67, attr: 7, x: 1, y: 1, hp: 5, maxhp: 5, asleep: 0, afraid: 0, unique: 1, status: -2 });
    assert.equal(m.name, 'Something strange');
    assert.equal(m.unique, 0);
    assert.equal(m.hp, 5);
    assert.equal(disguiseObject({ id: 2, name: 'a Potion of Speed', ch: 33, attr: 4, x: 0, y: 0 }).name, 'Something odd');
  });
});
