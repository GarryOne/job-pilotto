// Adding role terms after the app says the search is narrow: the terms land in the search settings AND in the Notion page (or neither).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ROLE_TERM, addRoles} from '../lib/strategy.js';

function setup({keywords = ['\\bsre\\b', 'devops'], notion = true, writeFails = false} = {}) {
  const files = {'config/search.json': JSON.stringify({role_keywords: keywords, locations: {top_tier: ['zurich']}})};
  const calls = [];
  const storage = {readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; calls.push(['write', name]); },
    secret: name => (name === 'NOTION_TOKEN' && notion ? 'tok' : ''), settings: () => ({notionIds: notion ? {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_SEARCH_SETTINGS_PAGE: 'settings'} : {}}), saveSettings() {}};
  const deps = {run: async (_, args) => { calls.push(['run', args.slice(-1)[0]]); return {code: 0, stdout: '## Roles to look for\n- sre\n'}; }, ensurePage: async () => 'settings',
    writePage: async (token, page, text) => { calls.push(['publish', page]); if (writeFails) throw new Error('Notion said no'); }};
  return {files, calls, storage, deps};
}
const roles = files => JSON.parse(files['config/search.json']).role_keywords;

test('terms are added to the role keywords and published to the Notion page, after reading it first', async () => {
  const t = setup();
  const result = await addRoles(t.storage, ['Backend', 'distributed systems', 'c++'], t.deps);
  assert.deepEqual(result.added, ['backend', 'distributed systems', 'c++']);
  assert.deepEqual(roles(t.files), ['\\bsre\\b', 'devops', 'backend', 'distributed systems', 'c\\+\\+']);   // regex-safe fragments
  assert.deepEqual(JSON.parse(t.files['config/search.json']).locations, {top_tier: ['zurich']}, 'nothing else changes');
  assert.deepEqual(t.calls.map(c => c[0] + ':' + c[1]), ['run:sync', 'write:config/search.json', 'run:render', 'publish:settings']);   // read, change, write the page
});

test('when Notion refuses, the search settings are put back so the two never disagree', async () => {
  const t = setup({writeFails: true});
  const before = t.files['config/search.json'];
  await assert.rejects(addRoles(t.storage, ['backend'], t.deps), /Notion said no/);
  assert.equal(t.files['config/search.json'], before);
});

test('terms already there, invalid terms and an empty list change nothing and touch nothing', async () => {
  const t = setup({keywords: ['\\bsre\\b', 'backend']});
  assert.deepEqual((await addRoles(t.storage, ['Backend'], t.deps)).added, []);                       // already a keyword
  assert.deepEqual((await addRoles(t.storage, ['<script>', 'a', '', 'x'.repeat(60), 'rm -rf /; ls'], t.deps)).added, []);
  assert.deepEqual((await addRoles(t.storage, [], t.deps)).added, []);
  assert.deepEqual((await addRoles(t.storage, undefined, t.deps)).added, []);
  assert.equal(t.calls.filter(c => c[0] === 'publish').length, 0);
  assert.ok(ROLE_TERM.test('distributed systems') && ROLE_TERM.test('back-end') && !ROLE_TERM.test('ab') && !ROLE_TERM.test('1starts with digit'));
});

test('without Notion connected the change stays in the local settings', async () => {
  const t = setup({notion: false});
  assert.deepEqual((await addRoles(t.storage, ['backend'], t.deps)).added, ['backend']);
  assert.deepEqual(roles(t.files), ['\\bsre\\b', 'devops', 'backend']);
  assert.equal(t.calls.filter(c => c[0] === 'publish').length, 0);
});
