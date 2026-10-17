// The one filter for every list of open questions (owner, 17 Oct 2026): readable label, judged reusable, not already answered; the rest hidden, never deleted.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keyOf, looksLikeFieldId, visibleQuestions} from '../renderer/question-filter.js';

const verdicts = {
  [keyOf('Notice period')]: {reuse: 'reusable', covered_by: '', proposal: '', asked: 1},
  [keyOf('What is your earliest start date?')]: {reuse: 'reusable', covered_by: 'Notice period / earliest start', proposal: '3 months', asked: 2},
  [keyOf('Colonist Profile')]: {reuse: 'one_job', covered_by: '', proposal: ''},
  [keyOf('I hereby agree to the privacy policy (Art. 13 GDPR)')]: {reuse: 'consent', covered_by: '', proposal: ''},
  [keyOf('Visa sponsorship needed?')]: {reuse: 'reusable', covered_by: '', proposal: '', asked: 5},
};
const rows = ['text-3219', 'tel-3519', 'Colonist Profile', 'I hereby agree to the privacy policy (Art. 13 GDPR)', 'Notice period', 'What is your earliest start date?', 'Visa sponsorship needed?', 'Unjudged but readable question?']
  .map(question => ({question}));

test('field ids and non-reusable questions are hidden; covered ones carry the proposed answer; most asked first', () => {
  const {shown, hidden} = visibleQuestions(rows, verdicts);
  assert.deepEqual(hidden.map(row => row.question), ['text-3219', 'tel-3519', 'Colonist Profile', 'I hereby agree to the privacy policy (Art. 13 GDPR)']);
  assert.deepEqual(shown.map(row => row.question), ['Visa sponsorship needed?', 'What is your earliest start date?', 'Notice period', 'Unjudged but readable question?']);
  const covered = shown.find(row => row.coveredBy);
  assert.equal(covered.proposal, '3 months');
});

test('a field id is a shape, not a word list', () => {
  for (const id of ['text-3219', 'tel-3519', 'question_12', '_r_4_', 'input[3]', '']) assert.ok(looksLikeFieldId(id), id);
  for (const label of ['Notice period', 'Colonist Profile', 'Postal Code *']) assert.ok(!looksLikeFieldId(label), label);
});

test('no verdicts yet (no AI): only the readable-label rule applies', () => {
  assert.deepEqual(visibleQuestions(rows, {}).hidden.map(row => row.question), ['text-3219', 'tel-3519']);
});
