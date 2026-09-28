// A session's state on the session page: ready for review, asking you, working, and how long it took.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {firstLine, isLive, sessionDuration, sessionReview, sessionState} from '../renderer/session-state.js';

test('a filled form waiting for you is "ready for review"; a message ending on your question is not', () => {
  const report = 'The N26 form is filled and open in Chrome. Nothing was submitted.\n\n**Left for you:**\n' +
    '- ⚠️ Any relatives or partners working at N26? (required) No source.';
  // A form question listed in the report is not Claude asking you (the N26 bug).
  assert.equal(sessionReview({status: 'input', question: report}), true);
  assert.equal(sessionReview({status: 'input', question: 'The form is filled. Shall I change the visa answer?'}), false);
  // "ready for you to review … Nothing was submitted" counts (the demo's wording).
  assert.equal(sessionReview({status: 'input', question: 'The application is ready for you to review. Nothing was submitted.'}), true);
  assert.equal(sessionReview({status: 'done'}), true);
  assert.deepEqual(sessionState({status: 'input', question: 'Race is set. Checking the resume.'}), ['Question for you', 'warn']);
  assert.deepEqual(sessionState({status: 'mystery'}), ['Ended', 'neutral']);
});

test('live: what the app says, else running until it ended', () => {
  assert.equal(isLive({live: false}), false);
  assert.equal(isLive({endedAt: '2026-09-29T00:00:00Z'}), false);
  assert.equal(isLive({}), true);
});

test('duration until it ended or waited for you', () => {
  const startedAt = '2026-09-29T10:00:00Z';
  assert.equal(sessionDuration({startedAt, needsYouSince: '2026-09-29T10:03:32Z'}), '3m 32s');
  assert.equal(sessionDuration({startedAt, endedAt: '2026-09-29T11:02:00Z'}), '1h 02m');
  assert.equal(sessionDuration({startedAt}, Date.parse('2026-09-29T10:00:42Z')), '42s');
});

test('a row shows whole sentences up to the limit, at least one', () => {
  assert.equal(firstLine('Short.'), 'Short.');
  assert.equal(firstLine('One sentence here. Two sentences here. Three.', 30), 'One sentence here.');
  assert.equal(firstLine('A single very long sentence without any stop at all', 10), 'A single very long sentence without any stop at all');
});

test('ready for review becomes "Ready to submit" (green) once the form page says every required field is filled', () => {
  assert.deepEqual(sessionState({status: 'done'}, true), ['Ready to submit', 'good']);
  assert.deepEqual(sessionState({status: 'done'}, false), ['Ready for review', 'warn']);
  assert.deepEqual(sessionState({status: 'running'}, true), ['Applying', 'info']);  // still working: not yet
});
