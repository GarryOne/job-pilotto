// The tidy of the answers page (lib/answers-tidy.js), on both adapters (this Mac's file and Notion through fake-notion.js): field ids and one-job questions
// that have a job go; reusable, covered, answered and job-less one-job rows stay; the lists run it before reading (owner, 17 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {tidy} from '../lib/answers-tidy.js';
import * as lists from '../lib/question-lists.js';
import {keyOf} from '../renderer/question-filter.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tidy-')), plainCrypto);
  storage.saveSettings(settings);
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}
const ADAPTERS = {
  sqlite: () => ({storage: storageWith({store: 'sqlite', telemetry: false})}),
  notion: () => {
    const page = fakeNotion();
    return {storage: storageWith({store: 'notion', telemetry: false, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'}), fetcher: page.fetcher};
  },
};
const LINES = ['text-3219: ❓', 'tel-3519: ❓ (asked by Acme)', 'Colonist Profile: ❓ (asked by Colonist)', 'Why DeepJudge?: ❓',
  'Visa sponsorship needed?: ❓', 'Earliest start date?: ❓', 'text-4000: 3 months', 'Notice period: 3 months'];
const VERDICTS = {
  [keyOf('Colonist Profile')]: {reuse: 'one_job', jobs: [{url: 'https://colonist.io/jobs/1', company: 'Colonist'}]},
  [keyOf('Why DeepJudge?')]: {reuse: 'one_job', jobs: []},   // no job kept with it: nowhere to move it, it stays
  [keyOf('Visa sponsorship needed?')]: {reuse: 'reusable'},
  [keyOf('Earliest start date?')]: {reuse: 'reusable', covered_by: 'Notice period'}};

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: field ids and one-job questions with a job are removed; everything else stays`, async () => {
    const {storage, fetcher} = make();
    storage.saveSettings({questionVerdicts: VERDICTS});
    const page = store.openStore(storage, {fetcher}).page('answers');
    await page.append(LINES);
    const gone = await tidy(storage, {fetcher, force: true});
    assert.deepEqual(gone.map(item => [item.question, item.why]), [['text-3219', 'field id'], ['tel-3519', 'field id'], ['Colonist Profile', 'one job']]);
    assert.deepEqual((await page.blocks()).map(block => block.text),
      ['Why DeepJudge?: ❓', 'Visa sponsorship needed?: ❓', 'Earliest start date?: ❓', 'text-4000: 3 months', 'Notice period: 3 months']);
    assert.deepEqual(await tidy(storage, {fetcher, force: true}), [], 'a second pass finds nothing');
    assert.equal(storage.settings().questionVerdicts[keyOf('Colonist Profile')].jobs[0].url, 'https://colonist.io/jobs/1', 'the question stays on its job');
  });

  test(`${name}: the lists tidy before they read, and only once an hour`, async () => {
    const {storage, fetcher} = make();
    storage.saveSettings({questionVerdicts: VERDICTS});
    const page = store.openStore(storage, {fetcher}).page('answers');
    await page.append(['text-3219: ❓', 'Visa sponsorship needed?: ❓']);
    await lists.openShown(storage, {fetcher, ai: {}});
    assert.deepEqual((await page.blocks()).map(block => block.text), ['Visa sponsorship needed?: ❓']);
    await page.append(['tel-1: ❓']);
    await lists.openShown(storage, {fetcher, ai: {}});
    assert.equal((await page.blocks()).length, 2, 'the page is not read again within the hour');
  });
}
