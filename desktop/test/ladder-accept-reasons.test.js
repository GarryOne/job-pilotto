// A ladder fixture that accepts an outcome besides the expected one says WHY (`expect.accept_reasons`: outcome -> a sentence). Why: 11 Oct 2026, datadog-greenhouse-frame accepted `posting` with
// no reason, so a model that never named the frame still scored "ok" and the form_in_frame path went untested for a day. Accepting more is loosening; it needs a stated reason, and a reason for
// an outcome no longer accepted is stale. Existing ones are fixed by adding the reason or tightening, never by loosening. Guard for e2e/lib/ladder-fixtures.mjs (EXPECT_FIELDS).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EXPECT_FIELDS, loadFixtures} from '../e2e/lib/ladder-fixtures.mjs';

const MIN = 25;   // a sentence, not a word
const extras = fixture => (fixture.expect.accept || []).filter(outcome => outcome !== fixture.expect.outcome);

test('accept_reasons is a declared expect field', () => {
  assert.ok(EXPECT_FIELDS.includes('accept_reasons'));
});

test('every outcome a fixture accepts besides its expected one carries a stated reason', () => {
  const missing = [];
  for (const fixture of loadFixtures()) for (const outcome of extras(fixture)) {
    const reason = fixture.expect.accept_reasons?.[outcome];
    if (typeof reason !== 'string' || reason.trim().length < MIN) missing.push(`${fixture.id}: ${outcome}`);
  }
  assert.deepEqual(missing, [], 'add expect.accept_reasons[<outcome>] (a sentence) or remove the outcome from accept; never loosen');
});

test('no reason is left for an outcome the fixture no longer accepts', () => {
  const stale = [];
  for (const fixture of loadFixtures()) for (const outcome of Object.keys(fixture.expect.accept_reasons || {})) if (!extras(fixture).includes(outcome)) stale.push(`${fixture.id}: ${outcome}`);
  assert.deepEqual(stale, []);
});
