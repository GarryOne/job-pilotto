// A session's state on the session page: ready for review, asking you, working, and how long it took.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SESSION_STATE, firstLine, isLive, isSubmitted, panelAnswered, sessionDuration, sessionReview, sessionState} from '../renderer/session-state.js';

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

// "Reload the tab" is a repair, not an action: it reloads a form page (losing what was typed in it since the last
// save), so it is offered only after the page's panel has failed to answer the app (1 Oct 2026).
test('only a form page that did not answer asks for the reload repair', () => {
  assert.equal(panelAnswered({went: 'tab', taken: true}), true);      // the panel answered: nothing to repair
  assert.equal(panelAnswered({went: 'chrome', taken: false}), false); // no panel: the repair applies
  assert.equal(panelAnswered({went: 'tab', taken: false}), false);    // a tab came forward, but its panel is dead
  assert.equal(panelAnswered({went: 'posting', taken: false}), false);
  assert.equal(panelAnswered(undefined), false);
  assert.equal(panelAnswered('tab'), false);  // the old string shape cannot answer "did it?" — never "answered"
});

// A session whose application was submitted says so, whatever its process last did: it is finished, not applying.
test('a submitted session reads "Submitted", not "Ready for review"', () => {
  const done = {status: 'done', endedAt: '2026-10-01T07:37:19Z', outcome: 'submitted', question: 'The form is filled; submit it yourself.'};
  assert.deepEqual(sessionState(done), SESSION_STATE.submitted);
  assert.equal(sessionState(done)[0], 'Submitted');
  // Without the outcome it is the ordinary finished session.
  assert.equal(sessionState({...done, outcome: ''})[0], 'Ready for review');
  // A running process still Applying: the outcome only speaks for a session that is over.
  assert.equal(sessionState({status: 'running', live: true, outcome: 'submitted'})[0], 'Applying');
  // A stopped process (exit 129) whose application was submitted still reads Submitted.
  const stopped = {status: 'failed', note: 'Session stopped (exit 129)', endedAt: '2026-10-01T15:15:00Z', outcome: 'submitted', live: false};
  assert.equal(isSubmitted(stopped), true);
  assert.equal(sessionState(stopped, true)[0], 'Submitted');
  assert.equal(isSubmitted({status: 'failed', outcome: '', live: false}), false);
});

test('a form session (the Apply button) says the form is open until the extension reports it complete', () => {
  const form = {kind: 'form', status: 'done', outcome: '', live: false, endedAt: null};
  assert.deepEqual(sessionState(form), ['Form open', 'info']);
  assert.deepEqual(sessionState(form, true), SESSION_STATE.submit);
  assert.deepEqual(sessionState({...form, outcome: 'submitted'}), SESSION_STATE.submitted);
  assert.deepEqual(sessionState({status: 'done', outcome: '', endedAt: null}), SESSION_STATE.done);   // a Claude session is unchanged
});

test('a form session the extension cannot reach says so (no form, or an account is needed)', () => {
  const form = {kind: 'form', status: 'done', outcome: '', live: false, endedAt: null};
  assert.deepEqual(sessionState({...form, stuck: 'no-form'}), ['Can\'t reach form', 'warn']);
  assert.deepEqual(sessionState({...form, stuck: 'account'}), ['Needs an account', 'warn']);
});

test('a waiting session whose form is complete is ready for review, whatever Claude last asked', () => {
  const asked = {status: 'input', question: 'Send me the missing details (street, NPA) or finish it in Chrome.', brief: 'Send me the missing details?', live: false};
  assert.equal(sessionReview(asked), false);  // the form page said nothing: Claude's question stands
  assert.equal(sessionReview(asked, true), true);  // every required field filled: it is moot
  assert.deepEqual(sessionState(asked, true), ['Ready to submit', 'good']);
  assert.deepEqual(sessionState(asked, false), ['Question for you', 'warn']);
});
