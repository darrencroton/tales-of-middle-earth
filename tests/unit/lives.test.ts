import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { battlefieldText, followReturn, isReturnPrompt, livesText, returns, returnsText, safetyText } from '../../web/src/play/lives.ts';
import { hasFallen } from '../../web/src/play/memorial.ts';

describe('lives', () => {
  it('knows the question between death and life', () => {
    assert.equal(isReturnPrompt('Halls of Waiting: [B]attlefield, [S]afety or [A]ccept death? '), true);
    assert.equal(isReturnPrompt('Dump the screen? [y/n]'), false);
  });

  it('counts the lives left and the returns made', () => {
    assert.equal(livesText(2), 'Two lives remain');
    assert.equal(livesText(1), 'One life remains: your last');
    assert.equal(returns({ adventure: 1, lives: 1 }), 2);
    assert.equal(returns({ adventure: 0, lives: 0 }), 0);
    assert.equal(returnsText(1), 'Once');
    assert.equal(returnsText(2), 'Twice');
  });

  it('says what each way back means from where the hero fell', () => {
    assert.match(battlefieldText({ depth: 3, kept: 1, quest: 0 }), /foes are still there/);
    assert.match(battlefieldText({ depth: 3, kept: 0, quest: 0 }), /made anew/);
    assert.match(battlefieldText({ depth: 1, kept: 0, quest: 5 }), /outside the quest/);
    assert.equal(battlefieldText({ depth: 0, kept: 0, quest: 0 }), 'Wake where you fell, whole again.');
    assert.match(safetyText('Bree'), /^Wake in Bree,/);
  });

  it('tells a return from death from a rescue, whenever tome2 counts the life', () => {
    const asked = followReturn(null, { dead: 1, fate: 'choice', lives: 3 });
    assert.deepEqual(asked, { asked: 3, returned: false });
    /* With Pause, tome2 shows the return at a -more- while the hero is still dead, the life already counted. */
    const waiting = followReturn(asked.asked, { dead: 1, fate: 'choice', lives: 2 });
    assert.deepEqual(waiting, { asked: 3, returned: false });
    assert.deepEqual(followReturn(waiting.asked, { dead: 0, lives: 2 }), { asked: null, returned: true });
    /* Alive before the life is counted (a -more- while the level is made): the return comes with the count. */
    assert.deepEqual(followReturn(3, { dead: 0, lives: 3 }), { asked: 3, returned: false });
    /* Death accepted, or tome2's own rescue: no return. */
    assert.deepEqual(followReturn(3, { dead: 1, fate: 'final', lives: 3 }), { asked: null, returned: false });
    assert.deepEqual(followReturn(null, { dead: 0, lives: 3 }), { asked: null, returned: false });
  });

  it('counts a hero as fallen only once the death is final', () => {
    assert.equal(hasFallen({ dead: 1, fate: 'final' }), true);
    assert.equal(hasFallen({ dead: 1, fate: 'choice' }), false);
    assert.equal(hasFallen({ dead: 1, fate: 'rescue' }), false);
    assert.equal(hasFallen({ dead: 0 }), false);
    assert.equal(hasFallen(null), false);
  });
});
