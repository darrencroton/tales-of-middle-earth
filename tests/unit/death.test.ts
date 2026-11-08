import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { battlefieldText, deathsText, followReturn, hallsWords, isReturnPrompt, safetyText, timesText } from '../../web/src/play/death.ts';
import { hasFallen } from '../../web/src/play/memorial.ts';

describe('death', () => {
  it('knows the question between death and life', () => {
    assert.equal(isReturnPrompt('Halls of Waiting: [B]attlefield, [S]afety or [A]ccept death? '), true);
    assert.equal(isReturnPrompt('Dump the screen? [y/n]'), false);
  });

  it('counts the deaths', () => {
    assert.equal(deathsText(0), 'No deaths');
    assert.equal(deathsText(1), 'One death');
    assert.equal(deathsText(12), '12 deaths');
    assert.deepEqual([1, 2, 3, 12].map(timesText), ['once', 'twice', 'three times', '12 times']);
    assert.match(hallsWords(0).count, /^Your first time in these halls\./);
    assert.equal(hallsWords(2).count, 'Twice before you stood here. A return dims your renown.');
    assert.notEqual(hallsWords(0).scene, hallsWords(1).scene);
    assert.notEqual(hallsWords(1).scene, hallsWords(5).scene);
  });

  it('says what each way back means from where the hero fell', () => {
    assert.match(battlefieldText({ depth: 3, kept: 1, quest: 0 }), /foes are still there/);
    assert.match(battlefieldText({ depth: 3, kept: 0, quest: 0 }), /made anew/);
    assert.match(battlefieldText({ depth: 1, kept: 0, quest: 5 }), /outside the quest/);
    assert.equal(battlefieldText({ depth: 0, kept: 0, quest: 0 }), 'Wake where you fell, whole again.');
    assert.match(safetyText('Bree'), /^Wake in Bree,/);
  });

  it('tells a return from death from a rescue, whenever tome2 counts the death', () => {
    const asked = followReturn(null, { dead: 1, fate: 'choice', deaths: 4 });
    assert.deepEqual(asked, { asked: 4, returned: false });
    /* With Pause, tome2 shows the return at a -more- while the hero is still dead, the death already counted. */
    const waiting = followReturn(asked.asked, { dead: 1, fate: 'choice', deaths: 5 });
    assert.deepEqual(waiting, { asked: 4, returned: false });
    assert.deepEqual(followReturn(waiting.asked, { dead: 0, deaths: 5 }), { asked: null, returned: true });
    /* Alive before the death is counted (a -more- while the level is made): the return comes with the count. */
    assert.deepEqual(followReturn(4, { dead: 0, deaths: 4 }), { asked: 4, returned: false });
    /* Death accepted, or tome2's own rescue: no return. */
    assert.deepEqual(followReturn(4, { dead: 1, fate: 'final', deaths: 4 }), { asked: null, returned: false });
    assert.deepEqual(followReturn(null, { dead: 0, deaths: 4 }), { asked: null, returned: false });
  });

  it('counts a hero as fallen only once the death is final', () => {
    assert.equal(hasFallen({ dead: 1, fate: 'final' }), true);
    assert.equal(hasFallen({ dead: 1, fate: 'choice' }), false);
    assert.equal(hasFallen({ dead: 1, fate: 'rescue' }), false);
    assert.equal(hasFallen({ dead: 0 }), false);
    assert.equal(hasFallen(null), false);
  });
});
