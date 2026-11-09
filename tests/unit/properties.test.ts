import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { heroEffects } from '../../web/src/play/effects.ts';
import { propertyGroups, sourceName, type PropertyRow } from '../../web/src/play/properties.ts';
import type { PropertyCensus, PropertySource, PropertyState } from '../../web/src/render/snapshot.ts';

const SOURCES: PropertySource[] = [
  { kind: 'race', name: 'Dark-Elf' },
  { kind: 'class', name: 'Warrior' },
  { kind: 'item', name: "The Ring of Power 'Narya'", i: 28 },
  { kind: 'effect', effect: 'resistCold', turns: 13 },
  { kind: 'item', name: 'a Cloak of Fire', i: 32 },
];

const census = (props: PropertyState[], extra: Partial<PropertyCensus> = {}): PropertyCensus => ({ ready: 1, sources: SOURCES, props, ...extra });

function find(c: PropertyCensus, id: string): PropertyRow {
  for (const page of ['bonuses', 'defences', 'traits', 'senses'] as const) {
    for (const group of propertyGroups(c, page)) {
      const row = group.rows.find((r) => r.id === id);
      if (row) return row;
    }
  }
  throw new Error(`no row ${id}`);
}

describe('the census of the hero’s properties', () => {
  it('shows every property, those the hero lacks dimmed', () => {
    const rows = propertyGroups(census([]), 'defences').flatMap((g) => g.rows);
    assert.ok(rows.length > 25);
    assert.ok(rows.every((r) => r.state === '—' && r.tone === 'off' && !r.shares.length));
    assert.deepEqual(
      propertyGroups(census([]), 'defences').map((g) => g.title),
      ['Elements', 'Higher resistances', 'Immunities', 'Sustains', 'Other defences'],
    );
  });

  it('grades an element: immune, resisted twice with a temporary resistance, temporary alone', () => {
    const immune = find(census([{ id: 'fire', now: 3, from: [{ s: 2, as: 'immune' }] }]), 'fire');
    assert.deepEqual([immune.state, immune.tone, immune.shares[0].detail], ['Immune', 'good', 'Immune']);
    const twice = find(census([{ id: 'cold', now: 2, from: [{ s: 2 }, { s: 3 }] }]), 'cold');
    assert.deepEqual([twice.state, twice.temporary, twice.shares[1].turns], ['Resist ×2', false, 13]);
    const temporary = find(census([{ id: 'cold', now: 1, from: [{ s: 3 }] }]), 'cold');
    assert.deepEqual([temporary.state, temporary.temporary], ['Resist', true]);
  });

  it('shows a weakness, undone by a resistance or cancelling it out', () => {
    const weak = find(census([{ id: 'lite', now: -1, from: [{ s: 0, as: 'vulnerable' }] }]), 'lite');
    assert.deepEqual([weak.state, weak.tone], ['Vulnerable', 'bad']);
    const undone = find(census([{ id: 'fire', now: 1, from: [{ s: 0, as: 'vulnerable' }, { s: 4 }] }]), 'fire');
    assert.deepEqual([undone.state, undone.shares[0].cancelled, undone.shares[1].cancelled], ['Resist', true, false]);
    assert.match(undone.note ?? '', /undoes your weakness/);
    const cancelled = find(census([{ id: 'lite', now: 0, from: [{ s: 0, as: 'vulnerable' }, { s: 4 }] }]), 'lite');
    assert.deepEqual([cancelled.state, cancelled.shares.every((s) => s.cancelled)], ['Cancelled', true]);
  });

  it('adds up amounts, with what the sources do not account for as Other', () => {
    const str = find(census([{ id: 'str', now: 6, from: [{ s: 1, n: 5 }, { s: 2, n: 3 }] }]), 'str');
    assert.equal(str.state, '+6');
    assert.deepEqual(
      str.shares.map((s) => [s.source?.kind ?? null, s.detail]),
      [
        ['class', '+5'],
        ['item', '+3'],
        [null, '−2'],
      ],
    );
    const stealth = find(census([{ id: 'stealth', from: [{ s: 2, n: 2 }] }]), 'stealth');
    assert.deepEqual([stealth.state, stealth.shares.length], ['+2', 1]);
    const light = find(census([{ id: 'light', now: 5, from: [{ s: 2, n: 3 }, { s: 4, n: 3 }] }]), 'light');
    assert.deepEqual([light.state, light.shares.length], ['5', 2]);
    assert.equal(find(census([{ id: 'infra', now: 40, from: [{ s: 0, n: 40 }] }]), 'infra').state, '40 ft');
  });

  it('shows blows and shots as the totals the hero has, with the limit Strength and Dexterity reach, and the base shot', () => {
    const c = census(
      [
        { id: 'blows', now: 4, from: [{ s: 1, n: 1 }, { s: 5, n: 3 }] },
        { id: 'shots', now: 2, from: [{ s: 2, n: 1 }] },
      ],
      { sources: [...SOURCES, { kind: 'stats', name: 'Strength and Dexterity' }], blowsLimit: 6, blowsRaised: 2 },
    );
    const blows = find(c, 'blows');
    assert.deepEqual([blows.state, blows.shares.map((s) => s.detail)], ['4', ['+1', '+3']]);
    assert.match(blows.note ?? '', /at most 6 blows .*Extra Max Blow abilities/);
    const shots = find(c, 'shots');
    assert.deepEqual([shots.state, shots.shares.map((s) => [s.source?.name, s.detail])], ['2', [["The Ring of Power 'Narya'", '+1'], ['Base', '+1']]]);
  });

  it('marks a drawback as bad and a property no source gives now as not in force', () => {
    const aggravate = find(census([{ id: 'aggravate', now: 1, from: [{ s: 4 }] }]), 'aggravate');
    assert.deepEqual([aggravate.state, aggravate.tone], ['Yes', 'bad']);
    const idle = find(census([{ id: 'reflect', now: 0, from: [{ s: 4 }] }]), 'reflect');
    assert.deepEqual([idle.state, idle.note], ['—', 'Not in force now.']);
  });

  it('leaves out the partial senses while the hero has telepathy', () => {
    const titles = (c: PropertyCensus) => propertyGroups(c, 'senses')[1].rows.map((r) => r.id);
    assert.ok(titles(census([])).includes('espOrc'));
    assert.deepEqual(titles(census([{ id: 'esp', now: 1, from: [{ s: 3 }] }])), ['esp']);
  });

  it('names sources as the player reads them', () => {
    const effects = heroEffects({ effects: [{ id: 'resistCold', turns: 13 }], food: 5000 });
    assert.equal(sourceName(SOURCES[2], effects), "Ring of Power 'Narya'");
    assert.equal(sourceName(SOURCES[3], effects), 'Resist cold');
    assert.equal(sourceName({ kind: 'form', name: 'bear', effect: 'mimic' }, effects), 'Bear form');
    assert.equal(sourceName({ kind: 'tactic', name: 'normal' }, effects), 'Tactic: Normal');
    assert.equal(sourceName(null, effects), 'Other');
  });
});
