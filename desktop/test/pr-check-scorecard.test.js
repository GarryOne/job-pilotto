// The monthly PR-check scorecard counts by structure: shas, failing step names and changed paths (tools/pr-check-scorecard.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {message, productFile, scorecard} from '../../tools/pr-check-scorecard.mjs';

let n = 0;
const run = (name, branch, sha, conclusion, {start = '2026-10-01T10:00:00Z', end = '2026-10-01T10:10:00Z', steps} = {}) =>
  ({id: ++n, name, head_branch: branch, head_sha: sha, conclusion, created_at: `2026-10-01T10:${String(n).padStart(2, '0')}:00Z`, run_started_at: start, updated_at: end,
    jobs: steps ? [{conclusion, steps: steps.map(([stepName, stepConclusion]) => ({name: stepName, conclusion: stepConclusion}))}] : []});
const files = {'a1...a2': ['src/engine.py'], 'b1...b2': ['tests/test_x.py', 'docs/x.md']};
const card = runs => scorecard(runs, (from, to) => files[`${from}...${to}`] || [], {now: new Date('2026-11-01T00:00:00Z')});
const row = (runs, name) => card(runs).checks.find(check => check.name === name);

test('red then green on the same sha is a flaky false red', () => {
  const r = row([run('Unit', 'x', 's1', 'failure'), run('Unit', 'x', 's1', 'success')], 'Unit');
  assert.deepEqual([r.reds, r.flaky, r.realCatches], [1, 1, 0]);
});

test('a red in a setup step is a false red, whatever the fix', () => {
  const r = row([run('Cases', 'x', 's1', 'failure', {steps: [['Download bundles', 'failure'], ['Run', 'skipped']]}), run('Cases', 'x', 's2', 'success')], 'Cases');
  assert.deepEqual([r.setup, r.falseReds, r.realCatches], [1, 1, 0]);
});

test('red, then green after a product change, is a real catch', () => {
  const r = row([run('Unit', 'x', 'a1', 'failure', {steps: [['Run tests', 'failure']]}), run('Unit', 'x', 'a2', 'success')], 'Unit');
  assert.deepEqual([r.realCatches, r.verdict], [1, 'proven']);
});

test('a fix that only touches tests and docs is not a catch; no green yet is open', () => {
  const fixed = row([run('Unit', 'x', 'b1', 'failure', {steps: [['Run tests', 'failure']]}), run('Unit', 'x', 'b2', 'success')], 'Unit');
  assert.deepEqual([fixed.realCatches, fixed.fixedOther, fixed.verdict], [0, 1, 'review']);
  const open = row([run('Unit', 'y', 'c1', 'failure', {steps: [['Run tests', 'failure']]})], 'Unit');
  assert.equal(open.open, 1);
});

test('only the same branch counts as the later run, and cancelled runs are ignored', () => {
  const r = row([run('Unit', 'x', 'a1', 'failure', {steps: [['Run tests', 'failure']]}), run('Unit', 'other', 'a2', 'success'), run('Unit', 'x', 'a3', 'cancelled')], 'Unit');
  assert.deepEqual([r.runs, r.open, r.realCatches], [2, 1, 0]);
});

test('minutes: median, p90, and the wait added beyond the slowest other check', () => {
  const at = minutes => ({start: '2026-10-01T10:00:00Z', end: new Date(Date.parse('2026-10-01T10:00:00Z') + minutes * 60000).toISOString()});
  const runs = [run('Slow', 'x', 's1', 'success', at(20)), run('Fast', 'x', 's1', 'success', at(5)), run('Slow', 'y', 's2', 'success', at(10)), run('Fast', 'y', 's2', 'success', at(4))];
  const slow = row(runs, 'Slow'), fast = row(runs, 'Fast');
  assert.deepEqual([slow.medianMin, slow.p90Min, slow.addedMin, fast.addedMin], [10, 20, 6, 0]);
});

test('product files exclude tests, docs and workflows; the message names every check with 0 catches', () => {
  assert.deepEqual(['src/a.py', 'desktop/main.js', 'tests/t.py', 'docs/a.md', 'desktop/test/a.test.js', '.github/workflows/x.yml'].map(productFile), [true, true, false, false, false, false]);
  const text = message(card([run('Unit', 'x', 's1', 'success')]));
  assert.match(text, /🟡 review: Unit \(0 catches in 30 days\)/);
});
