// A suite whose AI is all stand-in fails when a call went on to a real model (lib/no-real-ai.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNoRealAi, realAiCalls} from '../lib/no-real-ai.mjs';

test('paid calls on either proxy are counted and fail the check', () => {
  assert.equal(realAiCalls({proxy: {stats: {paid: 1}}, openaiProxy: {stats: {paid: 2}}}), 3);
  assert.equal(realAiCalls({proxy: {stats: {}}, openaiProxy: null}), 0);
  assert.doesNotThrow(() => assertNoRealAi({proxy: {stats: {calls: 9, canned: 9, failed: 0}}, openaiProxy: null}));
  assert.throws(() => assertNoRealAi({proxy: {stats: {paid: 1}}, openaiProxy: null}), /1 AI call\(s\) reached a real model/);
});
