// The ladder ratchet (like tools/file-size.mjs): every fixture's stored answer, replayed offline through the real pageKind, may never get WORSE than e2e/ladder-baseline.json says.
// Better is fine (and shown). A new fixture, a removed one, or an edited expectation needs the baseline updated in the same commit, with a reason:
//   cd desktop && npm run ladder-score -- --offline --update-baseline "<why>"
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BASELINE_FILE, compareToBaseline, readBaseline} from '../e2e/lib/ladder-baseline.mjs';
import {fingerprintProblems, fingerprints} from '../e2e/lib/ladder-fingerprint.mjs';
import {loadFixtures} from '../e2e/lib/ladder-fixtures.mjs';
import {scoreFixtures} from '../e2e/lib/ladder-score.mjs';

const row = (id, expected, status, accept) => ({id, expected, accept: accept || [expected], status});
const entry = (expected, status, outcome = expected) => ({expect: {outcome: expected, accept: [expected]}, outcome, status});

test('compareToBaseline: only a worse status, a new or removed fixture or a changed expectation fails; better is reported', () => {
  const baseline = {fixtures: {a: entry('form', 'exact'), b: entry('email', 'miss', 'other'), gone: entry('form', 'exact')}};
  const verdict = compareToBaseline([row('a', 'form', 'miss'), row('b', 'email', 'exact'), row('new', 'form', 'exact'), row('c', 'form', 'exact')], baseline);
  assert.deepEqual(verdict.worse.map(item => item.id), ['a']);
  assert.deepEqual(verdict.better.map(item => item.id), ['b']);
  assert.deepEqual(verdict.added.sort(), ['c', 'new']);
  assert.deepEqual(verdict.removed, ['gone']);
  const edited = compareToBaseline([row('a', 'phone', 'exact', ['phone', 'other'])], {fixtures: {a: entry('form', 'exact')}});
  assert.deepEqual(edited.changedExpectation, ['a']);
});

test('the committed fixtures are no worse than the baseline', async () => {
  const baseline = readBaseline();
  assert.ok(Array.isArray(baseline.reasons) && baseline.reasons.length && baseline.reasons.every(item => item.reason && item.date), `${BASELINE_FILE} needs a dated reason for each update`);
  const verdict = compareToBaseline(await scoreFixtures(loadFixtures()), baseline);
  const help = 'if this is on purpose: cd desktop && npm run ladder-score -- --offline --update-baseline "<why>" (a worse fixture needs its reason; docs/flows/ladder.md)';
  assert.deepEqual(verdict.worse.map(item => `${item.id}: ${item.was} -> ${item.now}`), [], `a fixture got worse; ${help}`);
  assert.deepEqual(verdict.added, [], `fixtures not in the baseline; ${help}`);
  assert.deepEqual(verdict.removed, [], `baseline fixtures with no file; ${help}`);
  assert.deepEqual(verdict.changedExpectation, [], `an expectation was edited; ${help}`);
  if (verdict.better.length) console.log(`ladder ratchet: ${verdict.better.length} fixture(s) got better (${verdict.better.map(item => item.id).join(', ')}); tighten the baseline with --update-baseline`);
});

test('every fixture has a stored answer, so the gate replays it without a model', () => {
  assert.deepEqual(loadFixtures().filter(fixture => !fixture.answer && fixture.expect.outcome !== 'pending').map(fixture => fixture.id), []);   // a pending candidate may wait for its answer
});

test('the prompts and schemas of every rung are the ones the stored answers were recorded with', async () => {
  assert.deepEqual(fingerprintProblems(await fingerprints(), readBaseline()), []);
});
