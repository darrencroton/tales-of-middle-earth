import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findTopic, plain, searchHelp, TOPICS } from '../../web/src/help/topics.ts';

describe('help', () => {
  it('has unique topics whose links all lead somewhere', () => {
    const ids = TOPICS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const topic of TOPICS) {
      for (const id of topic.see ?? []) assert.ok(findTopic(id), `${topic.id} → ${id}`);
      assert.ok(!(topic.see ?? []).includes(topic.id), `${topic.id} links to itself`);
    }
  });

  it('finds topics by title first, then by what they say, ignoring accents and case', () => {
    assert.equal(searchHelp('stairs')[0]?.id, 'stairs');
    assert.equal(searchHelp('TORCH')[0]?.id, 'light');
    assert.equal(searchHelp('lothlorien')[0]?.id, 'land');
    assert.ok(searchHelp('manwe').some((t) => t.id === 'gods'));
    assert.deepEqual(
      searchHelp('poison cut').map((t) => t.id).slice(0, 1),
      ['ailments'],
    );
    assert.deepEqual(searchHelp('xyzzy'), []);
    assert.deepEqual(searchHelp('  '), []);
  });

  it('matches plain text without markup', () => {
    assert.equal(plain('*Lothlórien*’s'), "lothlorien's");
  });
});
