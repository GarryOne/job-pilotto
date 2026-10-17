// A question's Confirm waits for an answer: an enabled Save on an empty field did nothing, which read as broken (UI loop #64). Since 17 Oct 2026
// questions are answered in the review drawer (pages/question-review.js): Confirm & next starts disabled and follows the answer control (its ready()).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Confirm & next starts disabled on an empty answer and follows the answer control', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/question-review.js', import.meta.url), 'utf8');
  // ready(): the control holds an answer (and, for a Your details value to make exact, an exact one: lib/details-review.js).
  assert.match(source, /const ready = \(\) => control\.complete(?: && [^\n]+)?;/, 'Confirm waits for the control to hold an answer');
  assert.match(source, /confirm\.disabled = state\.busy \|\| !ready\(\);/, 'the control tells Confirm when it holds an answer');
  assert.match(source, /confirm\.disabled = state\.busy \|\| !ready\(\);\n  confirm\.addEventListener/, 'drawn disabled when the answer is empty');
});
