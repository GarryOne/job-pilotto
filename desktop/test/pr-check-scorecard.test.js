// The monthly PR-check scorecard counts by structure: shas, failing step names and changed paths (tools/pr-check-scorecard.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matcher, message, pathsOf, productFile, scorecard} from '../../tools/pr-check-scorecard.mjs';

let n = 0;
const run = (name, branch, sha, conclusion, {start = '2026-10-01T10:00:00Z', end = '2026-10-01T10:10:00Z', steps} = {}) =>
  ({id: ++n, name, head_branch: branch, head_sha: sha, conclusion, created_at: `2026-10-01T10:${String(n).padStart(2, '0')}:00Z`, run_started_at: start, updated_at: end,
    jobs: steps ? [{conclusion, steps: steps.map(([stepName, stepConclusion]) => ({name: stepName, conclusion: stepConclusion}))}] : []});
const files = {'a1...a2': {rebased: false, files: ['src/engine.py']}, 'b1...b2': {rebased: false, files: ['tests/test_x.py', 'docs/x.md']}, 'r1...r2': {rebased: true, files: []},
  'p1...p2': {rebased: false, files: ['site/src/a.js']}};
const card = (runs, paths = {}) => scorecard(runs, (from, to) => files[`${from}...${to}`] || {rebased: true, files: []}, {now: new Date('2026-11-01T00:00:00Z'), paths});
const row = (runs, name, paths) => card(runs, paths).checks.find(check => check.name === name);

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

test('a rebase or a change outside the check\'s own paths is not a catch; the PR number is listed for a real one', () => {
  const red = (sha, extra = {}) => ({...run('Unit', 'x', sha, 'failure', {steps: [['Run tests', 'failure']]}), pull_requests: [42], ...extra});
  assert.equal(row([red('r1'), run('Unit', 'x', 'r2', 'success')], 'Unit').realCatches, 0);
  assert.equal(row([red('p1'), run('Unit', 'x', 'p2', 'success')], 'Unit', {Unit: ['src/**']}).realCatches, 0);
  const caught = row([red('p1'), run('Unit', 'x', 'p2', 'success')], 'Unit', {Unit: ['site/**', '!site/docs/**']});
  assert.deepEqual([caught.realCatches, caught.catchPrs], [1, [42]]);
  assert.match(message(card([red('p1'), run('Unit', 'x', 'p2', 'success')], {Unit: ['site/**']})), /1 catches \(#42\)/);
});

test('a workflow\'s pull_request paths are read and matched like GitHub does', () => {
  const text = "name: x\non:\n  workflow_call:\n  pull_request:\n    branches: [main]\n    paths:\n      - 'src/**'\n      - '!src/docs/**'\n      - '*.md'   # top level\n  push:\n    paths:\n      - 'other/**'\njobs: {}\n";
  assert.deepEqual(pathsOf(text), ['src/**', '!src/docs/**', '*.md']);
  const loads = matcher(pathsOf(text));
  assert.deepEqual(['src/a.py', 'src/x/y.py', 'src/docs/a.md', 'README.md', 'docs/README.md', 'other/z'].map(loads), [true, true, false, true, false, false]);
  assert.equal(pathsOf('on:\n  pull_request:\n    branches: [main]\njobs: {}\n'), null);
  assert.equal(matcher(null)('anything'), true);
});
