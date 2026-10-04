// Tune my strategy (lib/strategy.js applyTune/tuned/retune): only the ticked proposals change ⚙️ Search settings, and the
// change is checked to have stayed.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as strategy from '../lib/strategy.js';
import * as pipeline from '../lib/pipeline.js';

const SEARCH = {role_keywords: ['data analyst', '\\bbi\\b'], title_exclude_keywords: ['\\bsales\\b'],
  locations: {top_tier: ['z[uü]rich'], country_wide: ['switzerland'], abroad: ['berlin', 'dublin']}};
const DROP_BI = {kind: 'drop_role', list: 'role_keywords', fragment: '\\bbi\\b', label: 'bi'};
const DROP_BERLIN = {kind: 'drop_place', list: 'abroad', fragment: 'berlin', label: 'berlin'};
const SKIP_MARKETING = {kind: 'exclude_title', list: 'title_exclude_keywords', fragment: '\\bmarketing\\b', label: 'marketing'};

test('each kind of change lands where it belongs, and nothing else moves', () => {
  const next = strategy.applyTune(SEARCH, [DROP_BI, DROP_BERLIN, SKIP_MARKETING]);
  assert.deepEqual(next.role_keywords, ['data analyst']);
  assert.deepEqual(next.locations, {top_tier: ['z[uü]rich'], country_wide: ['switzerland'], abroad: ['dublin']});
  assert.deepEqual(next.title_exclude_keywords, ['\\bsales\\b', '\\bmarketing\\b']);
  assert.deepEqual(SEARCH.role_keywords, ['data analyst', '\\bbi\\b']);  // the input is not changed in place
  assert.ok(strategy.tuned(next, [DROP_BI, DROP_BERLIN, SKIP_MARKETING]));
  assert.ok(!strategy.tuned(SEARCH, [DROP_BI]));
});

test('an exclusion already there is not added twice', () => {
  const next = strategy.applyTune(SEARCH, [{...SKIP_MARKETING, fragment: '\\bsales\\b'}]);
  assert.deepEqual(next.title_exclude_keywords, ['\\bsales\\b']);
});

test('a place list the engine never names is left alone', () => {
  const next = strategy.applyTune(SEARCH, [{...DROP_BERLIN, list: 'role_keywords'}]);
  assert.deepEqual(next, {...SEARCH, locations: {...SEARCH.locations}});
});

function connected() {
  const files = {'config/search.json': JSON.stringify(SEARCH)};
  const storage = {readText: name => files[name], writeText: (name, text) => { files[name] = text; }, saveSettings: () => {},
    settings: () => ({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_SEARCH_SETTINGS_PAGE: 'page'}}), secret: () => 'token'};
  const written = [];
  const deps = {run: async () => ({code: 0, stdout: 'rendered'}), ensurePage: async () => 'page', writePage: async (token, page, text) => { written.push(page); }};
  return {files, storage, deps, written};
}

test('retune writes the ticked change and publishes it to the Search settings page', async () => {
  const {files, storage, deps, written} = connected();
  assert.deepEqual(await strategy.retune(storage, [DROP_BI], deps), {changed: ['bi']});
  assert.deepEqual(JSON.parse(files['config/search.json']).role_keywords, ['data analyst']);
  assert.deepEqual(written, ['page']);
});

test('a refused publish puts the file back: Notion and the cache never disagree', async () => {
  const {files, storage, deps} = connected();
  await assert.rejects(strategy.retune(storage, [DROP_BI], {...deps, writePage: async () => { throw new Error('Notion said no'); }}), /Notion said no/);
  assert.deepEqual(JSON.parse(files['config/search.json']), SEARCH);
  assert.deepEqual(await strategy.retune(storage, [], deps), {changed: []});
});

test('Prepare top matches reads its result line', () => {
  assert.equal(pipeline.taskSummary('kits', ['Auto-drafted 2 of 2 kit(s); 0 failed', 'Kits ready: 2']), 'Kits ready: 2');
  assert.equal(pipeline.TASKS.kits.name, 'Prepare top matches');
});
