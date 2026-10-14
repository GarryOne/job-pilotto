// The candidate recipe check (lib/candidate-check.mjs). The judging (what counts as worse, best of two runs, not-exercised) is tested without a browser, exactly; one test runs a real browser on a
// recorded date-picker form (a no-op recipe is never refused) and one that an unknown fingerprint is "no-recorded-form". Browser tests are opt-in like the page cases: JP_REPLAY=1 (CI: candidate-check.yml).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkCandidate} from '../lib/candidate-check.mjs';
import {loadCases} from '../lib/page-replay.mjs';

const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1; it starts Chromium with the real extension';
const cases = loadCases().filter(item => item.name === 'flatpickr-real-library-1');
const FINGERPRINT = 'f73ef6yqnl';   // the date field of that form (a real date-picker library) the built-in date operator sets (2 ok) (lib/candidate-check.mjs reads it from the page)
const recipe = params => ({fingerprint: FINGERPRINT, version: 1, operator: 'date', params, candidates: []});

test('in a real browser, a recipe that changes nothing is never refused on a form the built-in operator sets', {skip, timeout: 300000}, async () => {
  const result = await checkCandidate(recipe({}), {cases});
  assert.notEqual(result.verdict, 'refused', JSON.stringify(result));
  assert.deepEqual(result.rows.map(row => row.case), ['flatpickr-real-library-1']);
});

// The judging without a browser: a fake fill stands in for the page, so what counts as worse is pinned exactly (a real page's timing is not).
const FP = 'abc123xyz';
const fake = ({ok = 0, failed = 0, failures = []}) => ({failures, operated: {[FP]: {ok, failed}}});
const sequence = runs => { const list = [].concat(runs); let at = 0; return () => list[Math.min(at++, list.length - 1)]; };
const checkWith = (without, withIt) => {
  const nextWithout = sequence(without), nextWith = sequence(withIt);
  return checkCandidate({fingerprint: FP, version: 1, operator: 'date', params: {}, candidates: []},
    {cases: [{name: 'one'}], fingerprints: new Map([['one', [FP]]]), fill: async (item, recipes) => (Object.keys(recipes).length ? nextWith() : nextWithout())});
};

test('a recipe that breaks a widget the built-in operator sets is refused, with what broke', async () => {
  const result = await checkWith(fake({ok: 2}), fake({ok: 0, failed: 2, failures: ['filled: #start_on']}));
  assert.equal(result.verdict, 'refused');
  assert.deepEqual(result.rows[0].broke, ['filled: #start_on', 'operator: 0 ok / 2 failed with the recipe, 2 / 0 without']);
});

test('a recipe that only equals or improves on the built-in operator passes; one that fixes a failing control says what it fixed', async () => {
  assert.equal((await checkWith(fake({ok: 2}), fake({ok: 2}))).verdict, 'pass');
  const better = await checkWith(fake({ok: 0, failed: 1, failures: ['filled: #x']}), fake({ok: 1}));
  assert.equal(better.verdict, 'pass');
  assert.deepEqual(better.rows[0].fixed, ['filled: #x', 'operator: 1 ok with the recipe, 0 without']);
});

test('a page that settles late does not refuse a recipe that changed nothing: each side is judged by its best of two runs', async () => {
  const result = await checkWith([fake({ok: 2}), fake({ok: 1})], [fake({ok: 1}), fake({ok: 2})]);
  assert.equal(result.verdict, 'pass');
});

test('a form where the operator never ran on the control proves nothing: not-exercised, never pass', async () => {
  assert.equal((await checkWith(fake({}), fake({}))).verdict, 'not-exercised');
});

test('a fingerprint no recorded form holds is said so, never verified', {skip, timeout: 240000}, async () => {
  const result = await checkCandidate({...recipe({}), fingerprint: 'zzzzzzzzzz'}, {cases});
  assert.deepEqual(result, {verdict: 'no-recorded-form', rows: []});
});

test('an invalid recipe is refused before any browser starts', async () => {
  assert.equal((await checkCandidate({fingerprint: 'x', operator: 'run-code'}, {cases: []})).verdict, 'refused');
});
