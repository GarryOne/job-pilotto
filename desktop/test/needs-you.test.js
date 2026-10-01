// One "needs your input" ping per question: the same ask again does not ping again (lib/needs-you.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {QUIET_MS, shouldNotify} from '../lib/needs-you.js';

test('the same question does not ping again within the hour; a new one does after a quiet quarter hour', () => {
  const seen = new Map(), t0 = 1_000_000;
  assert.equal(shouldNotify(seen, 'a', 'Still waiting on you.', t0), true);
  assert.equal(shouldNotify(seen, 'a', '  still waiting on  you. ', t0 + 5 * 60_000), false);  // same ask, spaced differently
  assert.equal(shouldNotify(seen, 'a', 'A different question', t0 + 5 * 60_000), false);  // too soon for anything
  assert.equal(shouldNotify(seen, 'a', 'A different question', t0 + 20 * 60_000), true);
  assert.equal(shouldNotify(seen, 'a', 'A different question', t0 + 20 * 60_000 + QUIET_MS - 1), false);
  assert.equal(shouldNotify(seen, 'b', 'Still waiting on you.', t0 + 1), true);  // another session
});
