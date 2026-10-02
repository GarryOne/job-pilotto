// The questions a form asked that no answer matched are reported as wording only; anything that could be personal stays on this Mac.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanLabel, flowState, unplaced} from '../lib/question-labels.js';

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
