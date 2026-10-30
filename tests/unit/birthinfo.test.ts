import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { birthDetails, findBirthEntry, flagText, skillNumber } from '../../web/src/flow/birthinfo.ts';
import type { BirthData, BirthEntry } from '../../web/src/render/snapshot.ts';

const thunderlord: BirthEntry = {
  index: 17,
  title: 'Thunderlord',
  desc: 'A thunderlord is a Great Eagle of Manwe.\nThey carry the power of wind and thunder.',
  stats: [6, 2, 1, 1, 3, 8],
  hitDie: 12,
  exp: 400,
  luck: 2,
  infra: 0,
  flags: [],
  levelFlags: [
    { level: 1, pval: 0, flags: ['FEATHER'] },
    { level: 17, pval: 0, flags: ['FLY'] },
  ],
  skills: [
    { name: 'Stealth', op: '-', base: 16000, modOp: '+', mod: 0 },
    { name: 'Weaponmastery', op: '+', base: 1500, modOp: '+', mod: 0 },
  ],
  abilities: [],
  powers: [{ name: "Thunderlord's Powers", desc: 'You can use thunderlords powers.' }],
  classes: ['Warrior', 'Mage'],
};

const data: BirthData = {
  races: [thunderlord, { ...thunderlord, index: 18, title: 'DeathMold', flags: ['EXPERIMENTAL', 'NO_GOD'], levelFlags: [], powers: [] }],
  mods: [{ index: 0, title: '', desc: 'Classical', flags: [], skills: [], abilities: [] }],
  classes: [
    {
      index: 1,
      title: 'Mage',
      desc: 'A spell caster.',
      flags: [],
      skills: [{ name: 'Magic', op: '+', base: 1000, modOp: '+', mod: 300 }],
      abilities: [],
      specs: [{ index: 0, title: 'Necromancer', desc: 'Raises the dead.', flags: [], skills: [], abilities: [], gods: ['Melkor Bauglir'] }],
    },
  ],
};

describe('birth details', () => {
  it('finds races, modifiers, classes and specialisations by their labels', () => {
    assert.equal(findBirthEntry(data, 'race', 'Thunderlord')?.index, 17);
    assert.equal(findBirthEntry(data, 'modifier', 'Classical')?.index, 0);
    assert.equal(findBirthEntry(data, 'specialisation', 'Necromancer')?.title, 'Necromancer');
    assert.equal(findBirthEntry(data, 'god', 'Eru'), null);
  });

  it('lists stat changes, facts, traits by level and skills', () => {
    const d = birthDetails(thunderlord, 'race');
    assert.deepEqual(d.paragraphs, ['A thunderlord is a Great Eagle of Manwe. They carry the power of wind and thunder.']);
    assert.deepEqual(d.stats.map((s) => s.value), [6, 2, 1, 1, 3, 8]);
    assert.deepEqual(d.facts.map((f) => [f.label, f.value]), [
      ['Hit dice', 'd12'],
      ['Experience needed', '400%'],
      ['Luck', '+2'],
    ]);
    assert.deepEqual(d.traits.map((t) => [t.level, t.text]), [
      [1, 'Falls gently'],
      [1, "Thunderlord's Powers"],
      [17, 'Flies'],
    ]);
    assert.deepEqual(d.skills, [
      { name: 'Weaponmastery', value: '+1.5', tone: 'good' },
      { name: 'Stealth', value: '−16', tone: 'bad' },
    ]);
    assert.deepEqual(d.choices, { label: 'Classes', values: ['Warrior', 'Mage'] });
    assert.equal(d.experimental, false);
  });

  it('marks experimental choices and explains race flags', () => {
    const d = birthDetails(data.races[1], 'race');
    assert.equal(d.experimental, true);
    assert.ok(d.traits.some((t) => t.text === 'Cannot worship a god' && t.tone === 'bad'));
  });

  it('words flags and skill values', () => {
    assert.deepEqual(flagText('SPEED', 2), { text: '+2 Speed', tone: 'good' });
    assert.deepEqual(flagText('SENS_FIRE', 0), { text: 'Vulnerable to fire', tone: 'bad' });
    assert.equal(flagText('RES_WEIRD', 0).text, 'Res weird');
    assert.equal(skillNumber(300), '0.3');
    assert.equal(birthDetails(data.classes[0], 'class').skills[0].value, '+1 · +0.3 per point');
  });
});

describe('run options', async () => {
  const { questChoices, questsText, RUN_OPTION_TEXT } = await import('../../web/src/flow/runoptions.ts');

  it('offers the usual numbers of random quests and the one drawn, within what tome2 allows', () => {
    assert.deepEqual(questChoices(20, 98), [0, 10, 20, 40, 60]);
    assert.deepEqual(questChoices(15, 98), [0, 10, 15, 20, 40, 60]);
    assert.deepEqual(questChoices(5, 30), [0, 5, 10, 20]);
  });

  it('says what the random quests are, and names every option', () => {
    assert.match(questsText(0), /No random quests/);
    assert.match(questsText(20), /^20 levels/);
    for (const text of Object.values(RUN_OPTION_TEXT)) assert.ok(text.label && text.detail);
  });
});
