import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { altarAction, giftActive, GODS, godNamed, godTitle, offeringMacro, worshipMacro } from '../../web/src/play/gods.ts';
import { findPath } from '../../web/src/play/pathfinding.ts';
import { travelGrid } from '../../web/src/play/travel.ts';
import { walkableFor, type Material } from '../../web/src/render/materials.ts';
import { CAVE_SEEN } from '../../web/src/render/snapshot.ts';
import { snapshot } from './fixtures.ts';

const keys = (s: string) => [...s].map((c) => c.charCodeAt(0));
const screen = (prompt: string) => ({ prompt, screen: '', atCommand: false });

describe('gods', () => {
  it('names the gods as our UI writes them', () => {
    assert.deepEqual(
      GODS.map((g) => g.name),
      ['Eru Iluvatar', 'Manwe Sulimo', 'Tulkas', 'Melkor Bauglir', 'Yavanna Kementari'],
    );
    assert.equal(godTitle('Manwe Sulimo'), 'Manwë Súlimo');
    assert.equal(godTitle('Nobody'), 'No god');
    assert.equal(godTitle('No God'), 'No god');
  });

  it('lights a gift only at its piety, and a praying gift only while praying', () => {
    const manwe = godNamed('Manwe Sulimo')!;
    const flight = manwe.gifts.find((g) => g.text === 'Flight')!;
    const fall = manwe.gifts.find((g) => g.text === 'Feather fall')!;
    assert.ok(!giftActive(flight, { piety: 20000, praying: false }));
    assert.ok(!giftActive(flight, { piety: 14000, praying: true }));
    assert.ok(giftActive(flight, { piety: 15000, praying: true }));
    assert.ok(giftActive(fall, { piety: 2000, praying: false }));
    assert.ok(giftActive(godNamed('Melkor Bauglir')!.gifts[0], { piety: -500, praying: false }));
  });

  it('offers worship to a hero without a god, and offerings only at Melkor\'s altar to his own', () => {
    assert.equal(altarAction('Eru Iluvatar', '', false), 'worship');
    assert.equal(altarAction('Eru Iluvatar', '', true), null);
    assert.equal(altarAction('Eru Iluvatar', 'Eru Iluvatar', false), null);
    assert.equal(altarAction('Eru Iluvatar', 'Tulkas', false), null);
    assert.equal(altarAction('Melkor Bauglir', 'Melkor Bauglir', false), 'offer');
    assert.equal(altarAction(undefined, '', false), null);
  });

  it('answers tome2\'s question to worship, and nothing else', () => {
    const asked = worshipMacro();
    assert.deepEqual(asked.next().value, [92, ...keys('O')]);
    assert.deepEqual(asked.next(screen('He is the supreme god. -more-')).value, [32]);
    assert.deepEqual(asked.next(screen('Do you want to worship Eru Iluvatar? [y/n]')).value, keys('y'));
    const refused = worshipMacro();
    refused.next();
    assert.ok(refused.next({ prompt: "Don't be silly; you don't believe in gods.", screen: '', atCommand: true }).done);
  });

  it('makes each offering at Melkor\'s altar through tome2\'s two questions', () => {
    const run = (kind: 'item' | 'piety' | 'strength') => {
      const m = offeringMacro(kind);
      const sent = [m.next().value];
      let step = m.next(screen('Do you want to sacrifice a part of yourself? [y/n]'));
      if (!step.done) sent.push(step.value);
      step = m.next(screen('Do you want to sacrifice for more piety instead of damage? [y/n]'));
      if (!step.done) sent.push(step.value);
      return sent;
    };
    assert.deepEqual(run('item'), [[92, ...keys('O')], keys('n')]);
    assert.deepEqual(run('piety'), [[92, ...keys('O')], keys('y'), keys('y')]);
    assert.deepEqual(run('strength'), [[92, ...keys('O')], keys('y'), keys('n')]);
    const weak = offeringMacro('piety');
    weak.next();
    assert.ok(weak.next(screen('Sacrifice which item?')).done);
  });

  it('lets the hero walk terrain tome2 lets them enter, as a shortcut travel takes only to save a long way round', () => {
    const floor = { walkable: true, door: false, blocksLight: false } as Material;
    const tree = { walkable: false, door: false, blocksLight: true } as Material;
    const base = [floor, tree];
    assert.equal(walkableFor(base, []), base);
    const walked = walkableFor(base, [1]);
    assert.ok(walked[1].walkable && walked[1].shortcut && !base[1].walkable);

    /* From the left of a wood to its right: round by a short path, or through when the way round is long. */
    const route = (rows: string[]) => {
      const width = rows[0].length;
      const feat = new Uint8Array(rows.join('').split('').map((ch) => (ch === 'T' ? 1 : 0)));
      const snap = snapshot(width, rows.length, { px: 0, py: 1, feat, info: new Uint16Array(feat.length).fill(CAVE_SEEN) });
      return findPath(travelGrid(snap, walked), { x: 0, y: 1 }, { x: width - 1, y: 1 })!;
    };
    const around = route(['.....', '.TTT.', 'TTTTT']);
    assert.ok(around.every((p) => p.y === 0 || p.x === 4), 'takes the path over the wood');
    const through = route(['TTTTT', '.TTT.', 'TTTTT']);
    assert.equal(through.length, 4, 'with no way round, walks through it');
  });
});
