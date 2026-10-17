// Form-time questions kept on the Standard answers page: no field id, only what the AI judges reusable (owner, 17 Oct 2026: Needs review held junk).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as questions from '../lib/questions.js';
import {classify, looksLikeFieldId, reusable} from '../lib/question-reuse.js';
import {createStorage} from '../lib/storage.js';

function storage() {
  const s = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  s.setSecret('NOTION_TOKEN', 'ntn');
  s.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, telemetry: false});
  return s;
}
const NO = questions.NO_ANSWER;
const field = label => ({required: true, reason: NO, label});
const fake = verdicts => ({messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts})}]})}});

test('a field id is not a question; real labels are', () => {
  for (const id of ['text-3219', 'tel-3519', 'question_12', '_r_4_', 'input[3]']) assert.ok(looksLikeFieldId(id), id);
  for (const label of ['Notice period', 'Visa sponsorship?', 'Colonist Profile', 'Q1 goals review', 'Postal Code *']) assert.ok(!looksLikeFieldId(label), label);
});

test('collect: no field id, and only what the AI judges reusable', async () => {
  const added = [];
  const fetchAdd = async (url, init = {}) => { if (init.method === 'PATCH') added.push(JSON.parse(init.body)); return {ok: true, json: async () => ({results: [], has_more: false})}; };
  const run = {trace: [field('text-3219'), field('tel-3519'), field('Colonist Profile'), field('What is your motivation to apply?'), field('Notice period')]};
  const asked = [];
  const judge = async labels => { asked.push(labels); return new Set(labels.filter(l => l === 'Notice period')); };
  assert.equal(await questions.collect(storage(), run, 'Colonist', fetchAdd, judge), 1);
  assert.deepEqual(asked[0], ['Colonist Profile', 'What is your motivation to apply?', 'Notice period'], 'ids never reach the AI');
  assert.match(JSON.stringify(added), /Notice period/);
  assert.doesNotMatch(JSON.stringify(added), /text-3219|tel-3519|Colonist Profile|motivation/);
});

test('classify: the fixed answer is validated; unknown labels, a covered_by that is not a saved answer and a missing engine keep nothing', async () => {
  const labels = ['Notice period', 'Why Colonist?', 'Earliest start?'];
  const answered = [{question: 'Notice period / earliest start', answer: '3 months'}];
  const got = await classify({labels, answered, client: fake([{label: 'Notice period', verdict: 'reusable', covered_by: ''}, {label: 'Why Colonist?', verdict: 'one_job', covered_by: ''},
    {label: 'Earliest start?', verdict: 'reusable', covered_by: 'Notice period / earliest start'}, {label: 'Invented', verdict: 'reusable', covered_by: ''}, {label: 'Notice period', verdict: 'maybe', covered_by: ''}])});
  assert.deepEqual([...got.keys()], ['Notice period', 'Why Colonist?', 'Earliest start?']);
  assert.equal(got.get('Earliest start?').proposal, '3 months');
  const bad = await classify({labels, answered, client: fake([{label: 'Earliest start?', verdict: 'reusable', covered_by: 'A question that is not saved'}])});
  assert.equal(bad.get('Earliest start?').covered_by, '', 'an invented covered_by is dropped');
  assert.equal((await classify({labels, client: fake([])})).size, 0, 'no verdict = nothing');
  assert.equal((await classify({labels})).size, 0, 'no AI engine = nothing');
  assert.deepEqual([...await reusable({labels, answered, client: fake([{label: 'Notice period', verdict: 'reusable', covered_by: ''}, {label: 'Earliest start?', verdict: 'reusable', covered_by: 'Notice period / earliest start'}])})], ['Notice period']);
});
