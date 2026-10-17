// An answer for one job only (owner, 17 Oct 2026: "Reuse for matching questions" off) is kept with that job's application, through the store interface (the engine's
// applications section, every adapter: tests/store_contract.py), and found again for that job only. Guarded here with a fake store call.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JOB_ANSWERS_SECTION} from '../shared/worker/job-answers.js';
import {extensionStore} from '../lib/store/extension-store.js';
import * as jobAnswers from '../lib/job-answers.js';
import {keyOf} from '../renderer/question-filter.js';

const ACME = {id: 'a1', url: 'https://jobs.example.test/acme/1', title: 'SRE', company: 'Acme AG'};
const BETA = {id: 'a2', url: 'https://jobs.example.test/beta/2', title: 'SRE', company: 'Beta GmbH'};
const Q = 'What is your earliest start date, and are there any constraints we should be aware of?';
function fakeStore(rows = [ACME, BETA]) {
  const sections = new Map(), calls = [];
  const call = async (_, entity, method, kwargs) => {
    calls.push(`${entity}.${method}`);
    if (entity !== 'applications') throw new Error(`unexpected ${entity}.${method}`);
    if (method === 'list') return rows;
    if (method === 'get') return rows.find(row => row.url === kwargs.url) || null;
    if (method === 'section') return sections.get(`${kwargs.app_id}|${kwargs.name}`) ?? null;
    if (method === 'set_section') { sections.set(`${kwargs.app_id}|${kwargs.name}`, kwargs.markdown); return null; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {call, sections, calls};
}
const storageWith = verdicts => ({settings: () => ({questionVerdicts: verdicts})});
const verdicts = jobs => ({[keyOf(Q)]: {question: Q, reuse: 'reusable', jobs}});

test('the answer is written into that job\'s own section, found by the company that asked, and read back for that job only', async () => {
  const fake = fakeStore();
  const storage = storageWith(verdicts([{url: ACME.url, company: 'Acme AG'}, {url: BETA.url, company: 'Beta GmbH'}]));
  const saved = await jobAnswers.save(storage, Q, '1 December 2026; no constraints', {company: 'beta gmbh', call: fake.call});
  assert.equal(saved.ok, true);
  assert.equal(saved.job.company, 'Beta GmbH');
  assert.equal(fake.sections.get(`a2|${JOB_ANSWERS_SECTION}`), `- ${Q} — 1 December 2026; no constraints`);
  assert.equal(fake.sections.has(`a1|${JOB_ANSWERS_SECTION}`), false, 'the other job holds nothing');
  assert.deepEqual(await jobAnswers.forUrl(storage, BETA.url, {call: fake.call}), [{question: Q, answer: '1 December 2026; no constraints'}]);
  assert.deepEqual(await jobAnswers.forUrl(storage, ACME.url, {call: fake.call}), []);
  assert.deepEqual(await extensionStore({}, {call: fake.call}).jobAnswers('a2'), [{question: Q, answer: '1 December 2026; no constraints'}], 'the fill\'s reader sees the same');
});

test('a second answer to the same question replaces the first, and the others stay', async () => {
  const fake = fakeStore();
  const storage = storageWith(verdicts([{url: ACME.url, company: 'Acme AG'}]));
  await jobAnswers.save(storage, 'Notice period', '3 months', {company: 'Acme AG', call: fake.call, url: ACME.url});
  await jobAnswers.save(storage, Q, '1 December 2026', {company: 'Acme AG', call: fake.call});
  await jobAnswers.save(storage, 'Notice period', '1 month', {company: 'Acme AG', call: fake.call, url: ACME.url});
  assert.deepEqual((await jobAnswers.forUrl(storage, ACME.url, {call: fake.call})).map(each => each.answer), ['1 month', '1 December 2026']);
});

test('a question no job can be found for is not saved: the person is told, nothing is written', async () => {
  const fake = fakeStore([ACME, {...ACME, id: 'a3', url: 'https://jobs.example.test/acme/3'}]);
  const result = await jobAnswers.save(storageWith({}), Q, 'x', {company: 'Acme AG', call: fake.call});
  assert.equal(result.ok, false);
  assert.match(result.error, /which application/i);
  assert.equal(fake.sections.size, 0);
});

test('the same company asked twice with no way to tell which: not guessed', async () => {
  const fake = fakeStore([ACME, {...ACME, id: 'a3', url: 'https://jobs.example.test/acme/3'}]);
  const storage = storageWith(verdicts([{url: ACME.url, company: 'Acme AG'}, {url: 'https://jobs.example.test/acme/3', company: 'Acme AG'}]));
  assert.equal((await jobAnswers.save(storage, Q, 'x', {company: 'Acme AG', call: fake.call})).ok, false);
});
