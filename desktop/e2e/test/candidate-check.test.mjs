// The candidate recipe check (lib/candidate-check.mjs) in a real browser: a recipe that keeps a working widget working passes; one that breaks it is refused; a fingerprint no recorded form holds is "not checked".
// Opt-in like the page cases: JP_REPLAY=1 (CI: candidate-check.yml). It fills one recorded form with a date picker twice per recipe.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkCandidate} from '../lib/candidate-check.mjs';
import {loadCases} from '../lib/page-replay.mjs';

const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1; it starts Chromium with the real extension';
const cases = loadCases().filter(item => item.name === 'flatpickr-real-library-1');
const FINGERPRINT = 'f73ef6yqnl';   // the date field of that form (a real date-picker library) the built-in date operator sets (2 ok) (lib/candidate-check.mjs reads it from the page)
const recipe = params => ({fingerprint: FINGERPRINT, version: 1, operator: 'date', params, candidates: []});

test('a recipe that keeps the working widget working passes', {skip, timeout: 240000}, async () => {
  const result = await checkCandidate(recipe({}), {cases});
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
  assert.deepEqual(result.rows.map(row => row.case), ['flatpickr-real-library-1']);
});

test('a recipe that breaks a widget the built-in operator sets is refused, with what broke', {skip, timeout: 240000}, async () => {
  const result = await checkCandidate(recipe({order: 'mdy', sep: '.'}), {cases});   // a date shape the picker does not take: the value is not kept
  assert.equal(result.verdict, 'refused', JSON.stringify(result));
  assert.ok(result.rows[0].broke.length, 'names what got worse');
});

test('a fingerprint no recorded form holds is said so, never verified', {skip, timeout: 240000}, async () => {
  const result = await checkCandidate({...recipe({}), fingerprint: 'zzzzzzzzzz'}, {cases});
  assert.deepEqual(result, {verdict: 'no-recorded-form', rows: []});
});

test('an invalid recipe is refused before any browser starts', async () => {
  assert.equal((await checkCandidate({fingerprint: 'x', operator: 'run-code'}, {cases: []})).verdict, 'refused');
});
