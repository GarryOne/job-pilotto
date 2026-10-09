// A fill's record on the store keeps what Notion's run page shows (spec "Agent run shapes"): the field table without answer values,
// "Left for you" and step timings in fields.data. The columns stay as they were (desktop/test/extension-store.test.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRecord } from '../src/extension.js';

const run = {url: 'https://boards.greenhouse.io/acme/jobs/1', started: '2026-10-09T10:00:00Z', ended: '2026-10-09T10:03:00Z', fields: 3, unfilled: 1,
  kit: true, usd: 0.01, todo: ['Upload a portfolio'],
  trace: [{label: 'Email', required: true, source: 'your details', outcome: 'filled', reason: 'typed', value: 'secret@example.com'},
    {label: 'Salary', required: false, source: 'kit', outcome: 'filled', reason: 'typed', low: 'low confidence'},
    {label: 'Portfolio', required: true, source: '', outcome: 'skipped', reason: 'no answer in the kit'}],
  debug: {steps: [{step: 'read form', ms: 812.4}, {step: 'fill', ms: 2100}]}};

test('fields.data: the field table, left for you and step timings, never an answer value', () => {
  const {fields} = runRecord(run, {title: 'Engineer', company: 'Acme'});
  assert.deepEqual(fields.data.fields, [
    {label: 'Email', required: true, source: 'your details', outcome: 'filled', confidence: '', reason: 'typed'},
    {label: 'Salary', required: false, source: 'kit', outcome: 'filled', confidence: 'low', reason: 'typed · check: low confidence'},
    {label: 'Portfolio', required: true, source: '', outcome: 'left', confidence: '', reason: 'no answer in the kit'}]);
  assert.deepEqual(fields.data.left_for_you, ['Upload a portfolio']);
  assert.deepEqual(fields.data.attachments, []);
  assert.deepEqual(fields.data.steps, [{step: 'read form', ms: 812}, {step: 'fill', ms: 2100}]);
  assert.ok(!JSON.stringify(fields.data).includes('secret@example.com'));
  assert.equal(fields.status, 'Needs input');   // the columns as before
  assert.equal(fields.field_count, 3);
});

test('an older extension with no trace or debug still gives the shape', () => {
  const {fields} = runRecord({url: 'https://x.lever.co/a', started: '2026-10-09T10:00:00Z', ended: '2026-10-09T10:01:00Z'});
  assert.deepEqual(fields.data, {fields: [], left_for_you: [], attachments: [], steps: []});
});
