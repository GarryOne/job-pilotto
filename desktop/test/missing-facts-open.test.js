// The drawer opens once after setup on the first missing fact, never when nothing is missing and never twice (owner, 18 Oct 2026: "be proactive").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {firstMissing} from '../renderer/pages/missing-facts-open.js';

test('the first missing fact of the queue is the one that opens', () => {
  const list = [{key: 'a', details: {kind: 'open'}}, {key: 'b', details: {kind: 'missing'}}, {key: 'c', details: {kind: 'missing'}}, {key: 'form'}];
  assert.equal(firstMissing(list).key, 'b');
  assert.equal(firstMissing([{key: 'form'}, {key: 'a', details: {kind: 'which'}}]), undefined);
  assert.equal(firstMissing(null), undefined);
});
