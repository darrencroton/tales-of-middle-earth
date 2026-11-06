import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blessingsGone, FADING, SHORT_MAX, hasEffect, heroEffects, isHungry } from '../../web/src/play/effects.ts';
import type { EffectState } from '../../web/src/render/snapshot.ts';

const hero = (effects: EffectState[], extra: { food?: number; pray?: number } = {}) => heroEffects({ effects, food: 5000, ...extra });

describe('effects on the hero', () => {
  it('shows Doom Shield with its armour, its counter-blow and the turns it has left', () => {
    const [doom] = hero([{ id: 'shield', turns: 27, armour: -290, aura: 'counter', dice: '1d10' }]);
    assert.equal(doom.name, 'Doom shield');
    assert.equal(doom.abbr, 'DS');
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
    assert.deepEqual(effects.map((e) => e.abbr), ['Cu', 'Hu', 'Cf', 'Ha', 'Pr', 'So']);
    assert.equal(effects[0].severe, true);
    assert.match(effects[0].ends, /never closes by itself/);
    assert.equal(effects.find((e) => e.id === 'song')?.strength, '3 mana a turn');
  });

  it('gathers elemental resistances into one, named by those in force and lasting as long as the last', () => {
    const effects = hero([
      { id: 'resistFire', turns: 20 },
      { id: 'resistCold', turns: 12 },
      { id: 'resistChaos', turns: 30 },
    ]);
    const resist = effects.find((e) => e.id === 'resistance')!;
    assert.deepEqual(resist.left, { count: 20, unit: 'turn' });
    assert.deepEqual([resist.name, resist.short], ['Resist fire and cold', 'rFire+Cold']);
    assert.match(resist.does, /resist fire and cold/);
    assert.equal(resist.ends, 'Each wears off in time: fire in 20 turns and cold in 12 turns.');
    assert.ok(effects.some((e) => e.id === 'resistChaos'));
    const cold = hero([{ id: 'resistFire', turns: 20 }]).find((e) => e.id === 'resistance')!;
    assert.deepEqual([cold.name, cold.short], ['Resist fire', 'rFire']);
    const all = ['resistAcid', 'resistElec', 'resistFire', 'resistCold', 'resistPois'].map((id) => ({ id, turns: 9 }));
    assert.deepEqual([hero(all)[0].name, hero(all)[0].short], ['Resistance', 'Resist']);
  });

  it('gives every effect a short form of at most ten letters and a two-letter one', () => {
    const states: EffectState[] = [
      ...['paralyzed', 'blind', 'confused', 'afraid', 'poisoned', 'hallucinating', 'slow', 'blackBreath', 'parasite', 'invuln', 'disruption'].map((id) => ({ id, turns: 3 })),
      ...['lightspeed', 'wraith', 'shero', 'hero', 'blessed', 'holy', 'strike', 'protevil', 'reflect', 'resistChaos', 'poisonHands', 'absorbSoul'].map((id) => ({ id, turns: 3 })),
      ...['probability', 'flight', 'levitation', 'waterBreath', 'magicBreath', 'telepathy', 'seeInvisible', 'infravision', 'light', 'precognition'].map((id) => ({ id, turns: 3 })),
      ...['noBreeds', 'recall', 'mimicLegs', 'mimicArms', 'mimicWall'].map((id) => ({ id, turns: 3 })),
      ...[30, 80, 150].map((level) => ({ id: 'stun', turns: 3, level })),
      ...[5, 20, 40, 70, 150, 300, 1500].map((level) => ({ id: 'cut', turns: 3, level })),
      { id: 'drained', turns: 3, stat: 'CON' },
      { id: 'undead', kills: 3 },
      ...[{ armour: -290 }, { armour: 40 }, { armour: 10, aura: 'fear' as const }, { armour: 10, aura: 'fire' as const }].map((s) => ({ id: 'shield', turns: 3, ...s })),
      { id: 'fast', turns: 3, speed: 10 },
      { id: 'deadly', blows: 2 },
      { id: 'roots', turns: 3, armour: 10, damage: 5 },
      { id: 'project', turns: 3, element: 'electricity', damage: 9, radius: 1 },
      { id: 'thunder', turns: 3, dice: '2d6' },
      { id: 'regen', turns: 3, power: 100 },
      { id: 'invisible', turns: 3, power: 30 },
      { id: 'confusing' },
      { id: 'tread', steps: 9 },
      { id: 'song', spell: 'Hobbit Melodies(III)', mana: 3, renews: [] },
      { id: 'inertia', spell: 'Manathrust', mana: 12, every: 5, next: 2 },
      { id: 'spellbinder', at: 50, spells: ['Blink'] },
      { id: 'mimic', turns: 30, form: 'Fire Elem.' },
      { id: 'body', form: 'Grip, Farmer Maggot\'s Dog' },
    ];
    const effects = hero(states, { food: 400, pray: 2 });
    assert.equal(effects.length, states.length + 2);
    for (const e of effects) {
      assert.ok(e.short.length <= SHORT_MAX, `${e.name}: ${e.short}`);
      assert.ok(e.abbr.length <= 3, `${e.name}: ${e.abbr}`);
    }
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
      { id: 'drained', turns: 300, stat: 'STR' },
      { id: 'drained', turns: 80, stat: 'CON' },
      { id: 'unheard', turns: 3 },
    ]);
    assert.deepEqual(keys.map((e) => [e.key, e.abbr, e.name]), [
      ['drained:STR', '−ST', 'Weakened Strength'],
      ['drained:CON', '−CO', 'Weakened Constitution'],
    ]);
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
