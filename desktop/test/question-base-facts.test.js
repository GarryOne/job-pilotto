// Base facts are never asked again (owner, 17 Oct 2026, Decision 2): a form label that means a Your details fact is answered from there and hidden
// ("N answered from Your details"); same-topic wordings in any language are one item; the three counts agree. The AI is a fake here (no spend).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify} from '../lib/question-reuse.js';
import {keyOf, visibleQuestions} from '../renderer/question-filter.js';

const fake = (verdicts, seen = []) => ({messages: {create: async request => { seen.push(request); return {content: [{type: 'text', text: JSON.stringify({verdicts})}]}; }}});
const facts = [{label: 'Street', value: 'Seestrasse 4'}, {label: 'Postal code', value: '8001'}, {label: 'Notice period', value: '3 months'}];
const row = (label, fact = '', topic = '') => ({label, verdict: 'reusable', covered_by: '', value: '', topic, fact});

test('classify: a label maps to a fact of Your details from the given list; an invented fact keeps nothing', async () => {
  const got = await classify({labels: ['Rue, n°', 'Strasse und Nr.', 'Earliest start?', 'Favourite colour?'], facts, client: fake([
    row('Rue, n°', 'Street', 'street'), row('Strasse und Nr.', 'Street', 'street'), row('Earliest start?', 'Visa status', 'start'), row('Favourite colour?', '', 'colour')])});
  assert.equal(got.get('Rue, n°').reuse, 'details');
  assert.equal(got.get('Rue, n°').fact, 'Street');
  assert.equal(got.get('Strasse und Nr.').fact, 'Street');
  assert.equal(got.get('Earliest start?').reuse, 'reusable', 'a fact that is not in Your details is not trusted');
  assert.equal(got.get('Earliest start?').fact, '');
  assert.equal(got.get('Favourite colour?').reuse, 'reusable');
});

test('classify: the facts go to the AI with their labels only, never their values', async () => {
  const seen = [];
  await classify({labels: ['Rue, n°'], facts, client: fake([row('Rue, n°', 'Street', 'street')], seen)});
  const sent = JSON.stringify(seen[0]);
  assert.match(sent, /Postal code/);
  assert.doesNotMatch(sent, /Seestrasse|8001/, 'values stay on this Mac');
});

test('classify: with no facts nothing maps (a person with an empty Your details is asked)', async () => {
  const got = await classify({labels: ['Rue, n°'], facts: [], client: fake([row('Rue, n°', 'Street', 'street')])});
  assert.equal(got.get('Rue, n°').reuse, 'reusable');
});

test('visibleQuestions: base-fact questions leave the list and are counted apart, whatever their wording', () => {
  const verdicts = {
    [keyOf('Rue, n°')]: {reuse: 'details', fact: 'Street'}, [keyOf('Street, No.')]: {reuse: 'details', fact: 'Street'},
    [keyOf('Quand es-tu disponible ?')]: {reuse: 'reusable', topic: 'start date'}, [keyOf('Earliest start date')]: {reuse: 'reusable', topic: 'start date'},
    [keyOf('Notice period')]: {reuse: 'reusable', topic: 'start date'}, [keyOf('Salary?')]: {reuse: 'reusable', topic: 'salary'},
  };
  const rows = ['Rue, n°', 'Street, No.', 'Quand es-tu disponible ?', 'Earliest start date', 'Notice period', 'Salary?'].map(question => ({question}));
  const {shown, hidden, fromDetails} = visibleQuestions(rows, verdicts);
  assert.deepEqual(fromDetails.map(r => r.question), ['Rue, n°', 'Street, No.']);
  assert.deepEqual(hidden, [], 'they are not "hidden", they are answered');
  assert.equal(shown.length, 2, 'three wordings of one topic are one item');
  const start = shown.find(r => r.question === 'Quand es-tu disponible ?');
  assert.deepEqual(start.also.map(r => r.question), ['Earliest start date', 'Notice period']);
});

// ---- where a new question is written, and same-topic wordings at the fill ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as questions from '../lib/questions.js';
import {createStorage} from '../lib/storage.js';

const local = () => {
  const s = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  s.saveSettings({store: 'sqlite', telemetry: false});
  return s;
};
const field = label => ({required: true, reason: questions.NO_ANSWER, label});
const PAGE = '# Cover letter style\n\n- Be brief\n\n## Form-filling time\n\n- Fill what you can\n';

test('collect: a new question goes under its own heading, never inside "Form-filling time"', async () => {
  const s = local();
  s.writeText('answers.md', PAGE);
  assert.equal(await questions.collect(s, {trace: [field('Do you need a visa?')]}, 'Acme'), 1);
  const text = s.readText('answers.md');
  const lines = text.split('\n');
  const at = lines.findIndex(line => line.includes('Do you need a visa?'));
  const heading = lines.slice(0, at).reverse().find(line => line.startsWith('#'));
  assert.match(heading, /Questions to answer/);
  assert.equal(await questions.collect(s, {trace: [field('Another question?')]}, 'Acme'), 1);
  assert.equal(s.readText('answers.md').split('\n').filter(line => /Questions to answer/.test(line)).length, 1, 'one heading, reused');
});

test('collect: a question worded another way, same topic as an open one, is not added again', async () => {
  const s = local();
  s.writeText('answers.md', `${PAGE}\n## ❓ Questions to answer\n\n- When can you start?: ❓ (asked by Acme)\n`);
  s.saveSettings({questionVerdicts: {[keyOf('When can you start?')]: {reuse: 'reusable', topic: 'start date', question: 'When can you start?'}}});
  const added = await questions.collect(s, {trace: [field('Earliest start date')]}, 'Beta', undefined, async labels => {
    s.saveSettings({questionVerdicts: {...s.settings().questionVerdicts, [keyOf('Earliest start date')]: {reuse: 'reusable', topic: 'start date'}}});
    return new Set(labels);
  });
  assert.equal(added, 0);
  assert.doesNotMatch(s.readText('answers.md'), /Earliest start date/);
});

test('collect: a long question is kept whole', async () => {
  const s = local();
  const long = 'We would like to meet in person two to four times a year in Zurich for team days, which are mandatory. Are you able to attend these meetings, including travel?';
  assert.ok(long.length > 120);
  await questions.collect(s, {trace: [field(long)]}, 'Acme');
  assert.match(s.readText('answers.md'), new RegExp(long.replace(/[?]/g, '\\?')));
});

test('answerAll: one item in the queue answers every wording it stands for', async () => {
  const s = local();
  s.writeText('answers.md', '## Q\n\n- When can you start?: ❓\n- Earliest start date: ❓\n- Other: ❓\n');
  const open = await questions.list(s);
  const [first, second] = open;
  const result = await questions.answerAll(s, [first.key, second.key], '3 months');
  assert.equal(result.ok, true);
  const text = s.readText('answers.md');
  assert.match(text, /When can you start\?: 3 months/);
  assert.match(text, /Earliest start date: 3 months/);
  assert.match(text, /Other: ❓/);
});
