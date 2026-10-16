// The refill's two guards: a failed GitHub upload is tried again; a fill that asked nothing is "nothing to refill", any other missing memo stays a failure.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nothingToRefill, withRetry} from '../lib/refill-resilience.mjs';

test('a transient failure is tried again, a lasting one still throws', () => {
  let calls = 0; const waits = [];
  assert.equal(withRetry(() => { if (++calls < 3) throw new Error('HTTP 404'); return 'ok'; }, {wait: ms => waits.push(ms), delayMs: 10}), 'ok');
  assert.deepEqual([calls, waits], [3, [10, 20]]);
  calls = 0;
  assert.throws(() => withRetry(() => { calls++; throw new Error('down'); }, {wait: () => {}}), /down/);
  assert.equal(calls, 3);
});

test('only a fill that asked nothing has nothing to refill', () => {
  assert.equal(nothingToRefill('fill-memo: Digitec job offers check (no model): 0/0 live asks answered, 0 extra, outcome posting null/null'), true);
  assert.equal(nothingToRefill('fill-memo: Aldi check: 3/5 live asks answered'), false);
  assert.equal(nothingToRefill(''), false);
});
