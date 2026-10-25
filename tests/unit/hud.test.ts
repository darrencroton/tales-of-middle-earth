import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { depthLabel, rowSegments, sortByDistance, statusLabels } from '../../web/src/hud.ts';
import { defaultSettings, sanitiseSettings } from '../../web/src/settings.ts';
import { TerminalBuffer } from '../../web/src/terminal.ts';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('HUD helpers', () => {
  it('labels depth, town and wilderness', () => {
    assert.equal(depthLabel({ depth: 0, dungeon: 'Mirkwood', wild: 0 }), 'Town');
    assert.equal(depthLabel({ depth: 3, dungeon: 'Mirkwood', wild: 0 }), 'Mirkwood · 150 ft (L3)');
    assert.equal(depthLabel({ depth: 0, dungeon: '', wild: 1 }), 'Wilderness');
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
    assert.deepEqual(sanitiseSettings({ animation: 'reduced', glyphs: 'classic', zoom: 30 }, defaults), {
      animation: 'reduced',
      glyphs: 'classic',
      zoom: 30,
    });
    assert.deepEqual(sanitiseSettings({ animation: 'wild', glyphs: 7, zoom: 999 }, defaults), {
      animation: 'full',
      glyphs: 'brogue',
      zoom: 48,
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
