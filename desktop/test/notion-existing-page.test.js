// Reconnecting an existing Notion workspace (a reinstall, a second Mac, a reset) must find the pages it already has. 2 Oct 2026: ensurePage always created
// a page, so the migration made a second "⚙️ Search settings" from the Mac's example file and the person's real settings in Notion were ignored.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as migrate from '../lib/migrate.js';
import {ensurePage, findPageBeside} from '../lib/notion.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const PARENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const page = (id, title, parent = PARENT) => ({object: 'page', id, parent: {type: 'page_id', page_id: parent}, archived: false,
  properties: {title: {type: 'title', title: [{plain_text: title}]}}});

// A Notion that has these pages; records what was created or written.
function notionWith(pages) {
  const log = [];
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const reply = body => ({ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body)});
    if (route === 'pages/profile') return reply({...page('profile', 'Profile — CV and Preferences')});
    if (route === 'search') return reply({results: pages, has_more: false});
    if (route === 'pages' && init.method === 'POST') { log.push('create'); return reply({id: 'new-page-id'}); }
    if (route.startsWith('blocks/')) { log.push(`write ${route}`); return reply({results: [], has_more: false});}
    return reply({});
  };
  return {fetcher, log};
}

test('an existing page with that title beside the Profile is found, with or without the emoji', async () => {
  const there = notionWith([page('bbbbbbbb-0000-0000-0000-000000000002', 'Search settings'), page('cccccccc-0000-0000-0000-000000000003', 'Search settings', 'other-parent')]);
  assert.equal(await findPageBeside('ntn_x', 'profile', '⚙️ Search settings', there.fetcher), 'bbbbbbbb000000000000000000000002');
  assert.equal(await findPageBeside('ntn_x', 'profile', '🧠 Form knowledge', there.fetcher), null);
});

test('ensurePage reuses the page that is there and creates one only when there is none', async () => {
  const there = notionWith([page('bbbbbbbb-0000-0000-0000-000000000002', 'Search settings')]);
  assert.equal(await ensurePage('ntn_x', 'profile', '⚙️ Search settings', '', there.fetcher), 'bbbbbbbb000000000000000000000002');
  assert.deepEqual(there.log, [], 'nothing was created');
  const empty = notionWith([]);
  assert.equal(await ensurePage('ntn_x', 'profile', '⚙️ Search settings', 'intro', empty.fetcher), 'newpageid');
  assert.deepEqual(empty.log, ['create']);
});

test('connecting a workspace that already has Search settings links it and never overwrites it with this Mac\'s example file', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  const there = notionWith([page('bbbbbbbb-0000-0000-0000-000000000002', 'Search settings')]);
  const step = migrate.STEPS.find(item => item.name === 'search settings');
  assert.equal(await step.run(storage, there.fetcher), true);
  assert.equal(storage.settings().notionIds.NOTION_SEARCH_SETTINGS_PAGE, 'bbbbbbbb000000000000000000000002');
  assert.deepEqual(there.log, [], 'no page created, nothing written over the person\'s settings');
});
