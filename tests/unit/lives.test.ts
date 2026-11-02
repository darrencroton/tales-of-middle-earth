import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { battlefieldText, isReturnPrompt, livesText, returnedFromDeath, returns, returnsText, safetyText } from '../../web/src/play/lives.ts';
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
    assert.match(battlefieldText({ depth: 1, kept: 0, quest: 5 }), /door to the quest/);
    assert.equal(battlefieldText({ depth: 0, kept: 0, quest: 0 }), 'Wake where you fell, whole again.');
    assert.match(safetyText('Bree'), /^Wake in Bree,/);
  });

  it('tells a return from death from a rescue and from the death itself', () => {
    assert.equal(returnedFromDeath({ dead: 1, lives: 3 }, { dead: 0, lives: 2 }), true);
    /* The Blood of Life saves the hero without spending a life. */
    assert.equal(returnedFromDeath({ dead: 1, lives: 3 }, { dead: 0, lives: 3 }), false);
    assert.equal(returnedFromDeath({ dead: 0, lives: 3 }, { dead: 1, lives: 3 }), false);
    assert.equal(returnedFromDeath(null, { dead: 0, lives: 2 }), false);
  });

  it('counts a hero as fallen only once the death is final', () => {
    assert.equal(hasFallen({ dead: 1, fate: 'final' }), true);
    assert.equal(hasFallen({ dead: 1, fate: 'choice' }), false);
    assert.equal(hasFallen({ dead: 1, fate: 'rescue' }), false);
    assert.equal(hasFallen({ dead: 0 }), false);
    assert.equal(hasFallen(null), false);
  });
});
