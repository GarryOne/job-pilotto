// A written answer the AI drafted from the person's facts (owner, 16 Oct 2026): typed, marked draft until read, traced "drafted", listed to review; an outline stays marked
// while "• Add:" lines are left. Guards extension/page/fill.js, fill-marks.js markDraft and categories.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fakeFillPage} from './fake-fill-page.js';

const rows = [
  {field: 'why', label: 'Describe cloud infrastructure you have built.', type: 'textarea', required: true, filled: true, value: 'I built our Kubernetes platform at Acme.'},
  {field: 'inc', label: 'Describe a production incident you personally root-caused.', type: 'textarea', required: true, filled: true, value: '• Add: which incident and its cause'}];

test('a drafted written answer is traced "drafted", marked draft on its box and listed to review; an outline is traced as one', async () => {
  const {elements, fill} = fakeFillPage(rows);
  const summary = await fill([
    {field: 'why', value: rows[0].value, category: 'written', use: 'fill', draft: 'draft', confidence: 'medium', source: 'Claude (on the page)'},
    {field: 'inc', value: rows[1].value, category: 'written', use: 'fill', draft: 'outline', confidence: 'low', source: 'Claude (on the page)'}]);
  assert.equal(elements.why.dataset.jobpilottoDraft, 'draft');
  assert.equal(elements.inc.dataset.jobpilottoDraft, 'outline');
  assert.equal(elements.why.dataset.jobpilottoCategory, 'written');
  assert.deepEqual(summary.trace.filter(row => row.type === 'textarea').map(row => row.reason), ['drafted: review it', 'outline: add your own details']);
  assert.ok(summary.todo.some(item => /^Review: Describe cloud infrastructure.*\(drafted for you\)$/.test(item)), JSON.stringify(summary.todo));
  assert.ok(summary.todo.some(item => /^Complete: Describe a production incident/.test(item)));
});

test('an answer that is not a draft is not marked (a typed fact stays an ordinary answer)', async () => {
  const {elements, fill} = fakeFillPage(rows.slice(0, 1));
  await fill([{field: 'why', value: rows[0].value, category: 'normal', use: 'fill', source: 'Claude (on the page)'}]);
  assert.equal(elements.why.dataset.jobpilottoDraft, undefined);
});
