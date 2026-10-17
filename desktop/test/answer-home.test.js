// Answer once is an inbox (owner, 17 Oct 2026): an answer that is a fact of Your details goes to its section and leaves the standard answers page;
// anything else stays a standard answer, on every store. The class: every way an answer is saved (Answer once's Save, a session's "Remember").
// A failed write, no AI or a skip keeps today's behaviour, so nothing is ever lost.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as sections from '../lib/profile-sections.js';
import * as questions from '../lib/questions.js';
import {writeHome} from '../lib/answer-home.js';
import {fakeNotion} from './fake-notion.js';

const PROFILE = ['## Targets', '**Roles:** Site Reliability Engineer'];
const ANSWERS = ['## Common questions', 'Notice period: ❓ (asked by Acme)', 'How did you hear about us?: ❓', 'Salary expectation: CHF 120,000',
  {table: [['Question', 'Answer'], ['Need visa sponsorship?', '❓'], ['Pronouns', '❓ optional']]}];
const markdown = lines => lines.map(line => (typeof line === 'object' ? line.table.map((cells, i) => `| ${cells.join(' | ')} |${i === 0 ? '\n|---|---|' : ''}`).join('\n')
  : line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';

// The AI's fixed answer by what the line says (a fake: the real one reads meaning in any language).
const RULES = [[/visa sponsorship/, 'eligibility'], [/Notice period/, 'availability'], [/Salary expectation/, 'availability'], [/Languages/, 'languages']];
const ai = (calls = []) => ({client: {messages: {create: async request => {
  const items = JSON.parse(request.messages[0].content);
  calls.push(items);
  return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => ({id, home: RULES.find(([pattern]) => pattern.test(line))?.[1] || 'stay', topic: 'a fact'}))})}]};
}}}});

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-home-')), plainCrypto); s.saveSettings(settings); return s; };
const ADAPTERS = {
  sqlite: async () => {
    const storage = fresh({store: 'sqlite'});
    const opened = store.openStore(storage);
    await opened.page('profile').write(markdown(PROFILE));
    await opened.page('answers').write(markdown(ANSWERS));
    return {storage, fetcher: undefined};
  },
  notion: async () => {
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    const fetcher = (url, init) => {
      const route = url.replace('https://api.notion.com/v1/', '');
      return (route.startsWith('blocks/profile') || route.startsWith('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
    };
    const storage = fresh({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    storage.setSecret('NOTION_TOKEN', 'secret');
    return {storage, fetcher};
  },
};
const answersText = (storage, fetcher) => store.openStore(storage, {fetcher}).page('answers').text();
const openKey = async (storage, fetcher, question) => (await questions.list(storage, fetcher)).find(q => q.question === question).key;

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: Answer once sends a Your details fact to its section (a line and a table row) and keeps any other answer a standard answer`, async () => {
    const {storage, fetcher} = await make();
    const line = await questions.answer(storage, await openKey(storage, fetcher, 'Notice period'), '3 months', fetcher, null, {ai: ai()});
    assert.deepEqual(line, {ok: true, home: 'availability', homeName: 'Your details → 💶 Availability & compensation'});
    const row = await questions.answer(storage, await openKey(storage, fetcher, 'Need visa sponsorship?'), 'No', fetcher, null, {ai: ai()});
    assert.equal(row.home, 'eligibility');
    const other = await questions.answer(storage, await openKey(storage, fetcher, 'How did you hear about us?'), 'LinkedIn', fetcher, null, {ai: ai()});
    assert.deepEqual(other, {ok: true});
    const read = await sections.read(storage, fetcher);
    assert.deepEqual(read.availability, [{label: 'Notice period', value: '3 months'}]);
    assert.deepEqual(read.eligibility, [{label: 'Need visa sponsorship?', value: 'No'}]);
    const answers = await answersText(storage, fetcher);
    assert.doesNotMatch(answers, /Notice period|visa sponsorship/, 'the open questions left the answers page');
    assert.match(answers, /How did you hear about us\?: LinkedIn/);
    assert.match(answers, /Pronouns/, 'the rest of the table stays');
  });

  test(`${name}: a session's Remember sends a fact to its section and takes the old line off the answers page`, async () => {
    const {storage, fetcher} = await make();
    assert.equal((await questions.remember(storage, 'Salary expectation', 'CHF 140,000', fetcher, {ai: ai()})).home, 'availability');
    assert.equal((await questions.remember(storage, 'Notice period', '1 month', fetcher, {ai: ai()})).home, 'availability', 'an open question of that fact is answered there too');
    assert.deepEqual((await sections.read(storage, fetcher)).availability, [{label: 'Salary expectation', value: 'CHF 140,000'}, {label: 'Notice period', value: '1 month'}]);
    assert.doesNotMatch(await answersText(storage, fetcher), /Salary expectation|Notice period/);
  });
}

test('no AI, a skip or a failed write: the answer stays on the answers page as today, nothing removed', async () => {
  const {storage} = await ADAPTERS.sqlite();
  const calls = [];
  assert.deepEqual(await questions.answer(storage, await openKey(storage, undefined, 'Notice period'), '3 months'), {ok: true}, 'no AI');
  assert.match(await answersText(storage), /Notice period: 3 months/);
  assert.deepEqual(await questions.answer(storage, await openKey(storage, undefined, 'Need visa sponsorship?'), '', undefined, null, {ai: ai(calls)}), {ok: true});
  assert.equal(calls.length, 0, 'a skip asks no AI');
  assert.match(await answersText(storage), /Need visa sponsorship\? \| — \(leave blank\)/);
  const before = await sections.read(storage);
  const broken = {client: {messages: {create: async () => { throw new Error('busy'); }}}};
  assert.deepEqual(await questions.remember(storage, 'Salary expectation', 'CHF 150,000', undefined, {ai: broken}), {ok: true}, 'the AI failed');
  assert.match(await answersText(storage), /Salary expectation: CHF 150,000/);
  assert.deepEqual(await sections.read(storage), before);
  assert.equal(await writeHome(storage, 'availability', 'Notice period', '2 months', undefined, async () => []), false, 'a write that did not land reads back false');
});

test('a fact already in its section is replaced, never written twice', async () => {
  const {storage} = await ADAPTERS.sqlite();
  await sections.save(storage, 'availability', [{label: 'Notice period', value: '2 months'}, {label: 'Earliest start', value: 'January'}]);
  await questions.answer(storage, await openKey(storage, undefined, 'Notice period'), '3 months', undefined, null, {ai: ai()});
  assert.deepEqual((await sections.read(storage)).availability, [{label: 'Earliest start', value: 'January'}, {label: 'Notice period', value: '3 months'}]);
});
