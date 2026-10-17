// A question's kind of answer is kept with it (owner, 17 Oct 2026: "Title", "Country/Region of Residence" and a GDPR box were text fields): the fill's field type and
// options become a mark on the store's line, the same on every adapter; this Mac keeps every field's format; the AI judges old rows once, validated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as questions from '../lib/questions.js';
import * as formats from '../lib/question-formats.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-formats-')), plainCrypto);
  storage.saveSettings({telemetry: false, ...settings});
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}
const ADAPTERS = {
  sqlite: () => ({storage: storageWith({store: 'sqlite'}), fetcher: undefined}),
  notion: () => ({storage: storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'}), fetcher: fakeNotion().fetcher}),
};
const NO = questions.NO_ANSWER;
// The owner's five live examples (17 Oct 2026), as a fill reads them.
const TRACE = [
  {label: 'Yes, I live in Switzerland, or am willing to relocate if I currently live elsewhere', type: 'checkbox', required: true, reason: NO},
  {label: 'Do you have a valid permission to work in Switzerland?', type: 'radio', options: ['Yes', 'No'], required: true, reason: NO},
  {label: 'To be eligible to work in Switzerland, please select', type: 'select', options: ['Swiss citizen', 'EU/EFTA citizen', 'Work permit', 'None'], required: true, reason: NO},
  {label: 'Title', type: 'select', options: ['Mr', 'Mrs', 'Ms'], required: true, reason: NO},
  {label: 'Country/Region of Residence', type: 'combobox', options: [], required: true, reason: NO},
  {label: 'Notice period', type: 'text', required: true, reason: NO},
];

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: a fill's question keeps its kind and options, and an answer keeps them`, async () => {
    const {storage, fetcher} = make();
    assert.equal(await questions.collect(storage, {trace: TRACE}, 'Adnovum', fetcher), TRACE.length);
    const open = await questions.list(storage, fetcher);
    const by = Object.fromEntries(open.map(q => [q.question, q]));
    assert.equal(by['Yes, I live in Switzerland, or am willing to relocate if I currently live elsewhere'].mark.kind, 'yes_no');
    assert.deepEqual(by['Do you have a valid permission to work in Switzerland?'].mark, {kind: 'single', options: ['Yes', 'No']});
    assert.deepEqual(by.Title.mark, {kind: 'single', options: ['Mr', 'Mrs', 'Ms']});
    assert.equal(by['Country/Region of Residence'].mark.kind, 'single');
    assert.equal(by['Notice period'].mark, null, 'a text question carries no mark');
    assert.equal(by.Title.company, 'Adnovum', 'the asked-by part is still read');
    // Answering keeps the mark on the line: the next screen draws the same control.
    assert.deepEqual(await questions.answer(storage, by.Title.key, 'Mr', fetcher), {ok: true});
    const groups = await questions.standardAnswers(storage, fetcher);
    const notes = groups.flatMap(group => group.items).map(item => item.answer).join('\n');
    assert.match(notes, /Title: Mr/);
    assert.doesNotMatch(notes, /\[pick one/, 'the answers the AI judges coverage against carry no mark');
    assert.ok(!(await questions.list(storage, fetcher)).some(q => q.question === 'Title'), 'answered: no longer open');
  });
}

test('this Mac keeps each field\'s format from the fill; a closed menu keeps the options read before', () => {
  const storage = storageWith({});
  formats.noteFields(storage, [{label: 'Title', type: 'select', options: ['Mr', 'Mrs']}, {label: 'text-3219', type: 'text'}, {label: 'Password', type: 'password'}, {label: 'CV', type: 'file'}]);
  assert.deepEqual(Object.values(formats.kept(storage)).map(f => [f.kind, f.options]), [['single', ['Mr', 'Mrs']]], 'no field id, password or file');
  formats.noteFields(storage, [{label: 'Title', type: 'select', options: []}]);
  assert.deepEqual(formats.keptFor(storage, 'Title').options, ['Mr', 'Mrs']);
  formats.noteFields(storage, [{label: 'Title', type: 'text'}]);
  assert.equal(formats.keptFor(storage, 'Title').kind, 'text', 'the latest fill decides the kind');
});

const fake = list => ({messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({formats: list})}], usage: {input_tokens: 1}})}});
test('the AI judges old rows once; its answer is validated', async () => {
  const storage = storageWith({});
  const labels = ['Title', 'Country/Region of Residence', 'Why us?'];
  await formats.ensure(storage, labels, {ai: {client: fake([
    {label: 'Title', kind: 'single', options: ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof', 'Rev', 'Sir', 'Lady'], list: ''},
    {label: 'Country/Region of Residence', kind: 'single', options: ['ignored'], list: 'countries'},
    {label: 'Why us?', kind: 'essay', options: [], list: ''},
    {label: 'Invented', kind: 'text', options: [], list: ''}])}});
  const kept = formats.kept(storage);
  assert.equal(formats.keptFor(storage, 'Title').options.length, 8, 'at most 8 options');
  assert.deepEqual(formats.keptFor(storage, 'Country/Region of Residence'), {...formats.keptFor(storage, 'Country/Region of Residence'), kind: 'single', list: 'countries', options: []});
  assert.equal(formats.keptFor(storage, 'Why us?').kind, 'text', 'an unknown kind is kept as text, judged once');
  assert.equal(Object.keys(kept).length, 3, 'a label we did not ask keeps nothing');
  let calls = 0;
  await formats.ensure(storage, labels.slice(0, 2), {ai: {client: {messages: {create: async () => { calls++; return {content: []}; }}}}});
  assert.equal(calls, 0, 'judged once: no second call for the same labels');
  assert.deepEqual((await formats.ensure(storageWith({}), ['Title'])).formats, {}, 'no AI engine: nothing new');
});

test('a kind mark never becomes one of the person\'s own values (privacy tripwire)', async () => {
  const {personalValues} = await import('../lib/owner-values.js');
  const values = personalValues(['Preferred name: ❓ (asked by Acme) [pick one: Option | Another]', 'Full name: Ana Pop']);
  assert.deepEqual([...values.keys()].sort(), ['ana', 'pop']);
});
