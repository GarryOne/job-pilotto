// "Reuse for matching questions" off (owner, 17 Oct 2026: "Job-specific details stay with this application"): the answer is kept with the job that asked, the open
// question leaves the queue, and it never reaches the standard answers or Your details, on every store the text pages live in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as questions from '../lib/questions.js';
import * as sections from '../lib/profile-sections.js';
import {JOB_ANSWERS_SECTION} from '../shared/worker/job-answers.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-job-only-')), plainCrypto);
  storage.saveSettings({telemetry: false, ...settings});
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}
const ADAPTERS = {
  sqlite: () => ({storage: storageWith({store: 'sqlite'}), fetcher: undefined}),
  notion: () => ({storage: storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'}), fetcher: fakeNotion().fetcher}),
};
const START = 'What is your earliest start date, and are there any constraints we should be aware of?';
const TRACE = [{label: START, type: 'date', required: true, reason: questions.NO_ANSWER}, {label: 'Why us?', type: 'textarea', required: true, reason: questions.NO_ANSWER}];
const ACME = {id: 'a1', url: 'https://jobs.example.test/acme/1', title: 'SRE', company: 'Acme AG'};

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: a job-only answer goes to that job's section; the question leaves the queue; no standard answer, no Your details line`, async () => {
    const {storage, fetcher} = make();
    await questions.collect(storage, {trace: TRACE}, 'Acme AG', fetcher);
    const open = (await questions.list(storage, fetcher)).find(q => q.question === START);
    const written = [];
    const call = async (_, entity, method, kwargs) => {
      if (method === 'list') return [ACME];
      if (method === 'section') return null;
      if (method === 'set_section') { written.push(kwargs); return null; }
      throw new Error(`unexpected ${entity}.${method}`);
    };
    const result = await questions.answer(storage, open.key, '1 December 2026; no constraints', fetcher, {kind: 'date', options: [], constraints: true},
      {ai: {}, jobOnly: {company: 'Acme AG', call}});
    assert.equal(result.ok, true);
    assert.equal(result.jobOnly, true);
    assert.match(result.homeName, /Acme AG/);
    assert.deepEqual(written.map(each => [each.app_id, each.name]), [['a1', JOB_ANSWERS_SECTION]]);
    assert.match(written[0].markdown, /1 December 2026; no constraints/);
    assert.ok(!(await questions.list(storage, fetcher)).some(q => q.question === START), 'no longer open');
    const notes = (await questions.standardAnswers(storage, fetcher)).flatMap(group => group.items).map(item => `${item.question} ${item.answer}`).join('\n');
    assert.doesNotMatch(notes, /1 December 2026/, 'never a standard answer');
    const details = JSON.stringify(await sections.read(storage, fetcher));
    assert.doesNotMatch(details, /1 December 2026/, 'never a line of Your details');
  });

  test(`${name}: when no job can be found nothing is written and the question stays open`, async () => {
    const {storage, fetcher} = make();
    await questions.collect(storage, {trace: TRACE}, 'Acme AG', fetcher);
    const open = (await questions.list(storage, fetcher)).find(q => q.question === START);
    const call = async (_, entity, method) => { if (method === 'list') return []; throw new Error(`unexpected write ${method}`); };
    const result = await questions.answer(storage, open.key, '1 December 2026', fetcher, null, {ai: {}, jobOnly: {company: 'Acme AG', call}});
    assert.equal(result.ok, false);
    assert.ok((await questions.list(storage, fetcher)).some(q => q.question === START), 'still open');
  });
}
