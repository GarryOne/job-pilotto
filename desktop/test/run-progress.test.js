// A running task's live step that counts ("Scout: checked 33 of 91: EF") drives the progress meter above the Technical log (owner, 7 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stepCount} from '../renderer/run-status.js';

test('a counted step gives done, total and percent; anything else none', () => {
  assert.deepEqual(stepCount('Scout: checked 33 of 91: EF'), {done: 33, total: 91, percent: 36});
  assert.deepEqual(stepCount('⏳ Reading employer job sites: 1,200 of 2,024 · 3,412 jobs listed'), {done: 1200, total: 2024, percent: 59});
  assert.equal(stepCount('Searching job boards…'), null);
  assert.equal(stepCount('0 of 0'), null);
});
