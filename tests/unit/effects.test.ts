import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blessingsGone, FADING, hasEffect, heroEffects, isHungry } from '../../web/src/play/effects.ts';
import type { EffectState } from '../../web/src/render/snapshot.ts';

const hero = (effects: EffectState[], extra: { food?: number; pray?: number } = {}) => heroEffects({ effects, food: 5000, ...extra });

describe('effects on the hero', () => {
  it('shows Doom Shield with its armour, its counter-blow and the turns it has left', () => {
    const [doom] = hero([{ id: 'shield', turns: 27, armour: -290, aura: 'counter', dice: '1d10' }]);
    assert.equal(doom.name, 'Doom shield');
    assert.equal(doom.kind, 'boon');
    assert.equal(doom.strength, 'Armour −290');
    assert.match(doom.does, /Lowers your armour by 290\. .*bashed for 1d10 damage/);
    assert.deepEqual(doom.left, { count: 27, unit: 'turn' });
    assert.equal(doom.fading, false);
    assert.equal(hero([{ id: 'shield', turns: FADING, armour: -290, aura: 'counter', dice: '1d10' }])[0].fading, true);
  });

  it('names other shields by what they do', () => {
    assert.equal(hero([{ id: 'shield', turns: 9, armour: 40 }])[0].name, 'Mystic shield');
    assert.equal(hero([{ id: 'shield', turns: 9, armour: 10, aura: 'fear', dice: '2d4' }])[0].name, 'Armour of fear');
    assert.equal(hero([{ id: 'shield', turns: 9, armour: 10, aura: 'greatFire', dice: '5d5' }])[0].name, 'Fiery shield');
  });

  it('lists ailments first, the dangerous at the top, then blessings, then what the hero keeps going', () => {
    const effects = hero(
      [
        { id: 'fast', turns: 20, speed: 10 },
        { id: 'song', spell: 'Holding Pattern', mana: 3 },
        { id: 'confused', turns: 4 },
        { id: 'cut', level: 1200 },
      ],
      { food: 400, pray: 2 },
    );
    assert.deepEqual(
      effects.map((e) => e.name),
      ['Mortal wound', 'Fainting', 'Confused', 'Hasted', 'Praying', 'Holding Pattern'],
    );
    assert.equal(effects[0].left, null);
    assert.equal(effects[0].severe, true);
    assert.match(effects[0].ends, /never closes by itself/);
    assert.equal(effects.find((e) => e.id === 'song')?.strength, '3 mana a turn');
  });

  it('gathers elemental resistances into one, lasting as long as the first to end', () => {
    const effects = hero([
      { id: 'resistFire', turns: 20 },
      { id: 'resistCold', turns: 12 },
      { id: 'resistChaos', turns: 30 },
    ]);
    const resist = effects.find((e) => e.id === 'resistance')!;
    assert.deepEqual(resist.left, { count: 12, unit: 'turn' });
    assert.match(resist.does, /resist fire and cold/);
    assert.equal(resist.ends, 'Each wears off in time: fire in 20 turns and cold in 12 turns.');
    assert.ok(effects.some((e) => e.id === 'resistChaos'));
  });

  it('counts what is spent by blows, steps or kills in those', () => {
    assert.deepEqual(hero([{ id: 'deadly', blows: 3 }])[0].left, { count: 3, unit: 'blow' });
    assert.deepEqual(hero([{ id: 'tread', steps: 12 }])[0].left, { count: 12, unit: 'step' });
    const undead = hero([{ id: 'undead', kills: 1 }])[0];
    assert.equal(undead.ends, 'Slay 1 more creature to be brought back to life.');
    assert.equal(undead.fading, false);
  });

  it('keeps temporary drains apart by attribute, and leaves out what it does not know', () => {
    const keys = hero([
      { id: 'drained', turns: 300, stat: 'Strength' },
      { id: 'drained', turns: 80, stat: 'Constitution' },
      { id: 'unheard', turns: 3 },
    ]).map((e) => e.key);
    assert.deepEqual(keys, ['drained:Strength', 'drained:Constitution']);
  });

  it('tells which blessings faded, and whether the hero is under an effect or hungry', () => {
    const before = hero([{ id: 'blessed', turns: 1 }, { id: 'poisoned', turns: 1 }]);
    assert.deepEqual(blessingsGone(before, hero([])).map((e) => e.name), ['Blessed']);
    assert.equal(hasEffect({ effects: [{ id: 'stun', turns: 2, level: 10 }] }, 'stun'), true);
    assert.equal(hasEffect(undefined, 'stun'), false);
    assert.equal(isHungry({ food: 1999 }), true);
    assert.equal(isHungry({ food: 2000 }), false);
  });
});
