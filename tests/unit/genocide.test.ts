import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { genocideTelling } from '../../web/src/play/genocide.ts';
import type { GenocideState } from '../../web/src/render/snapshot.ts';

const cast = (over: Partial<GenocideState> = {}): GenocideState => ({ n: 1, mass: 0, outcome: 'cast', erased: 1, seen: [], ...over });
const ORC = { race: 'Cave orc', ch: 'o'.charCodeAt(0), attr: 2, spared: 0 };

describe('genocide', () => {
  it('names the kind erased when the hero saw the creature chosen, and only then', () => {
    assert.deepEqual(genocideTelling(cast(ORC)), { kind: 'banner', title: 'Genocide', subtitle: 'Cave orc and its kind (o) erased from this level' });
    assert.deepEqual(genocideTelling(cast()), { kind: 'banner', title: 'Genocide', subtitle: 'Its kind is erased from this level' });
    assert.deepEqual(genocideTelling(cast({ ...ORC, race: 'Lagduf, the Snaga', unique: 1, spared: 1 })), {
      kind: 'banner',
      title: 'Genocide',
      subtitle: 'Its kind (o) is erased · Lagduf, the Snaga withstands it',
    });
    assert.deepEqual(genocideTelling(cast({ mass: 1 })), { kind: 'banner', title: 'Mass genocide', subtitle: 'The creatures around you are erased' });
  });

  it('says why nothing was erased, logged unless tome2 said so itself', () => {
    assert.deepEqual(genocideTelling(cast({ outcome: 'stopped', erased: 0 })), { kind: 'toast', text: 'A mysterious force stops the genocide.', logged: false });
    assert.deepEqual(genocideTelling(cast({ outcome: 'cancelled', erased: 0 })), { kind: 'toast', text: 'No creature was chosen. The magic is spent.', logged: true });
    assert.deepEqual(genocideTelling(cast({ outcome: 'empty', erased: 0 })), { kind: 'toast', text: 'No creature there. The magic is spent.', logged: false });
    assert.match((genocideTelling(cast({ ...ORC, race: 'Lagduf, the Snaga', unique: 1, spared: 1, erased: 0 })) as { text: string }).text, /^Lagduf, the Snaga withstands genocide/);
    /* A quest foe that is not unique is one of its kind. */
    assert.match((genocideTelling(cast({ ...ORC, spared: 1, erased: 0 })) as { text: string }).text, /^The Cave orc withstands genocide/);
    assert.match((genocideTelling(cast({ mass: 1, erased: 0 })) as { text: string }).text, /^Nothing nearby could be erased/);
  });
});
