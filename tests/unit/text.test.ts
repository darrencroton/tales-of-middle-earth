import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripArticle, titleName } from '../../web/src/play/text.ts';

describe('names', () => {
  it('drop their leading article, and are capitalised as titles', () => {
    assert.equal(stripArticle('a Cave spider'), 'Cave spider');
    assert.equal(stripArticle('Some Food'), 'Food');
    assert.equal(stripArticle('Thráin'), 'Thráin');
    assert.equal(titleName('the One Ring'), 'One Ring');
    assert.equal(titleName('an orc'), 'Orc');
  });
});
