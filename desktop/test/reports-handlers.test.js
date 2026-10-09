// Reports (lib/reports-handlers.js): the insights through the engine; feedback only from the fixed list, merged so the other fields stay.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {insightsList, setFeedback} from '../lib/reports-handlers.js';

test('the history reads four months back through the store', async () => {
  const asked = [];
  await insightsList({}, {call: async (_s, entity, method, kwargs) => { asked.push([entity, method, kwargs]); return []; }, now: Date.parse('2026-10-09T12:00:00Z')});
  assert.deepEqual(asked, [['insights', 'list', {since: '2026-06-11'}]]);
});

test('feedback: one of three answers, written over the insight\'s other fields', async () => {
  const writes = [];
  const call = async (_s, entity, method, kwargs) => {
    if (method === 'list') return [{id: 'i1', fields: {confidence: 'Low', evidence: 'x'}}];
    writes.push(kwargs);
    return {};
  };
  assert.deepEqual(await setFeedback({}, 'i1', 'Acting on it', {call}), {ok: true});
  assert.deepEqual(writes, [{insight_id: 'i1', fields: {fields: {confidence: 'Low', evidence: 'x', feedback: 'Acting on it'}}}]);
  assert.equal((await setFeedback({}, 'i1', 'Meh', {call})).ok, false);
  assert.equal((await setFeedback({}, 'gone', 'Useful', {call})).ok, false);
});
