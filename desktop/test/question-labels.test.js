// The questions a form asked that no answer matched are reported as wording only; anything that could be personal stays on this Mac.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanLabel, flowState, leftCounts, missedQuestions, submitCounts, unplaced} from '../lib/question-labels.js';

test('a label is lower-cased and tidied, and what could carry personal data is dropped', () => {
  assert.equal(cleanLabel('  Heimatort *'), 'heimatort');
  assert.equal(cleanLabel('1. Notice period (optional):'), 'notice period');
  assert.equal(cleanLabel('Are you legally authorized to work in the UK?'), 'are you legally authorized to work in the uk');
  for (const bad of ['Email jane@example.com', 'See https://x.test/privacy', 'Call 0791234567', 'ab', '12345 6', '<b>Name</b>', '', null, 'x'.repeat(101)]) {
    assert.equal(cleanLabel(bad), '', String(bad));
  }
});

test('only the questions no answer matched are reported, once each, never files, with their kind', () => {
  const NO = 'no answer in the kit, Profile or your details';
  const trace = [{label: 'Heimatort *', type: 'text', required: true, reason: NO}, {label: 'Heimatort', type: 'text', reason: NO},
    {label: 'CV', type: 'file', reason: NO}, {label: 'First name', type: 'text', reason: ''}, {label: 'Street', type: 'text', reason: 'answer given, but the field did not take it'},
    {label: 'Salary expectation', type: 'select', required: false, reason: NO}, null];
  assert.deepEqual(unplaced(trace), [{label: 'heimatort', kind: 'text', required: true}, {label: 'salary expectation', kind: 'select', required: false}]);
  assert.deepEqual(unplaced(undefined), []);
  assert.equal(unplaced(Array.from({length: 40}, (_, i) => ({label: `question number ${i} here`, type: 'text', reason: NO}))).length, 20);
});

test('a page of an application becomes one word', () => {
  assert.equal(flowState({role: 'form', ok: true}), 'filled');
  assert.equal(flowState({role: 'form', ok: false}), 'fill-error');
  assert.equal(flowState({role: 'account'}), 'account');
  assert.equal(flowState({role: 'no-form', pressed: true}), 'no-form-after-apply');
  assert.equal(flowState({role: 'no-form'}), 'no-form');
  assert.equal(flowState({role: 'weird'}), '');
  assert.equal(flowState(null), '');
});

test('a required question the reader did not read counts as "unread", whichever wording the fill used', () => {
  assert.deepEqual(leftCounts([{outcome: 'left', reason: 'question on the page not read'}, {outcome: 'left', reason: 'question text not found on the page'},
    {outcome: 'left', reason: 'no answer in the kit, Profile or your details'}, {outcome: 'filled', reason: ''}]),
  [{reason: 'unread', n: 2}, {reason: 'no_answer', n: 1}]);
});

test('at Submit: what you answered yourself (left vs never read) and what the page flagged, as counts and cleaned labels', () => {
  const payload = {byYou: [{label: 'Notice period', kind: 'text'}, {label: 'How much has AI increased your speed?', kind: 'unread', unread: true}],
    invalid: ['Phone']};
  assert.deepEqual(submitCounts(payload), [{reason: 'by_you', n: 1}, {reason: 'by_you_unread', n: 1}, {reason: 'page_error', n: 1}]);
  assert.deepEqual(missedQuestions(payload).map(q => q.kind), ['text', 'unread']);
  assert.deepEqual(submitCounts({}), []);
});

test('the site accepts exactly the reason words the app sends (site/src/knowledge.js)', async () => {
  const {LEFT_REASONS} = await import('../lib/question-labels.js');
  const site = (await import('node:fs')).readFileSync(new URL('../../site/src/knowledge.js', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(site.match(/export const LEFT_REASONS = (\[[^\]]*\])/)[1].replace(/'/g, '"')), LEFT_REASONS);
});

test('a proposed answer is its own reason, apart from "no answer" (9 Oct 2026)', async () => {
  const {leftReason} = await import('../lib/question-labels.js');
  assert.equal(leftReason('proposed for you to confirm'), 'proposed');
  assert.equal(leftReason('no answer in the kit, Profile or your details'), 'no_answer');
});
