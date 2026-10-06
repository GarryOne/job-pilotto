// Strategy → What you're targeting → Edit: the lists change in the search settings AND the Notion page (or neither), only lists from the fixed set.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EDITABLE_LISTS, cleanEdits, editLists} from '../lib/strategy.js';

function setup({writeFails = false} = {}) {
  const files = {'config/search.json': JSON.stringify({role_keywords: ['/vendeu(r|se)/', 'store manager'],
    locations: {top_tier: ['geneva', 'switzerland'], country_wide: [], abroad: []}, quality_stack_keywords: ['lightroom'], title_exclude_keywords: ['stage']})};
  const calls = [];
  const storage = {readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; calls.push(['write', name]); },
    secret: name => (name === 'NOTION_TOKEN' ? 'tok' : ''), settings: () => ({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_SEARCH_SETTINGS_PAGE: 'settings'}}), saveSettings() {}};
  const deps = {wait: async () => {}, run: async (_, args) => { calls.push(['run', args.slice(-1)[0]]); return {code: 0, stdout: '## Roles to look for\n- x\n'}; }, ensurePage: async () => 'settings',
    writePage: async (token, page) => { calls.push(['publish', page]); if (writeFails) throw new Error('Notion said no'); }};
  return {files, calls, storage, deps};
}
const search = files => JSON.parse(files['config/search.json']);

test('a place moves from Best places to Anywhere in, a role is added: read first, then written and published', async () => {
  const t = setup();
  const result = await editLists(t.storage, {places: {remove: ['switzerland']}, country: {add: ['Switzerland']}, roles: {add: ['Verkäufer']}}, t.deps);
  assert.deepEqual(result.changed.sort(), ['country', 'places', 'roles']);
  const now = search(t.files);
  assert.deepEqual(now.locations.top_tier, ['geneva']);
  assert.deepEqual(now.locations.country_wide, ['switzerland']);
  assert.deepEqual(now.role_keywords, ['/vendeu(r|se)/', 'store manager', 'verkäufer']);
  assert.deepEqual(now.title_exclude_keywords, ['stage']);          // other lists untouched
  assert.deepEqual(t.calls.slice(0, 2), [['run', 'sync'], ['write', 'config/search.json']]);
  assert.ok(t.calls.some(call => call[0] === 'publish'));
});

test('Notion refusing leaves the cached settings as they were', async () => {
  const t = setup({writeFails: true});
  const before = t.files['config/search.json'];
  await assert.rejects(editLists(t.storage, {places: {remove: ['switzerland']}}, t.deps), /Notion said no/);
  assert.equal(t.files['config/search.json'], before);
});

test('only the fixed lists, sane words, escaped as text', () => {
  assert.deepEqual(Object.keys(EDITABLE_LISTS).sort(), ['abroad', 'country', 'places', 'roles', 'stack']);
  assert.deepEqual(cleanEdits({title_exclude_keywords: {add: ['x y']}, roles: {add: ['a', 'c++ dev', 'x'.repeat(61), 'two\nlines']}}),
    {roles: {add: ['c\\+\\+ dev'], remove: []}});
  assert.deepEqual(cleanEdits({roles: {add: [], remove: []}}), {});
});

test('nothing asked, nothing read or written', async () => {
  const t = setup();
  assert.deepEqual(await editLists(t.storage, {}, t.deps), {changed: []});
  assert.deepEqual(t.calls, []);
});
