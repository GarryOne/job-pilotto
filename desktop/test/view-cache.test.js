// Jobs, Focus and Strategy show their last good read at once, then the fresh one (lib/view-cache.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as viewCache from '../lib/view-cache.js';

const storage = () => {
  const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cache-')), {encrypt: v => v, decrypt: v => v});
  s.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-1'}, viewCache: true});
  return s;
};

test('a good read is kept and handed back; errors and out-of-date lists are not kept', () => {
  const s = storage();
  assert.equal(viewCache.recall(s, 'jobs'), null);
  viewCache.remember(s, 'jobs', {jobs: [{title: 'SRE'}], total: 1});
  assert.deepEqual(viewCache.recall(s, 'jobs').result, {jobs: [{title: 'SRE'}], total: 1});
  viewCache.remember(s, 'jobs', {jobs: [], stale: true});  // Notion unreachable: the good one stays
  viewCache.remember(s, 'focus', {ok: false, error: 'Notion down'});
  assert.equal(viewCache.recall(s, 'jobs').result.total, 1);
  assert.equal(viewCache.recall(s, 'focus'), null);
  assert.equal(viewCache.recall(s, '../settings'), null);  // only the three screens
});

test("another Notion workspace never sees this one's saved screens", () => {
  const s = storage();
  viewCache.remember(s, 'strategy', {ok: true, roles: ['SRE']});
  s.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-2'}});
  assert.equal(viewCache.recall(s, 'strategy'), null);
});

test('saved screens live in their own folder, not Chromium\'s Cache (same name on a case-insensitive Mac disk)', () => {
  const s = storage();
  viewCache.remember(s, 'focus', {ok: true, focus: {}});
  assert.ok(fs.existsSync(s.path('view-cache/focus.json')));
  assert.ok(!fs.existsSync(s.path('cache')));
});

test('while the view cache is off, screens load fresh (nothing handed back), but reads are still saved', () => {
  const s = storage();
  s.saveSettings({viewCache: false});
  viewCache.remember(s, 'jobs', {jobs: [], total: 0});
  assert.equal(viewCache.recall(s, 'jobs'), null);
  s.saveSettings({viewCache: true});
  assert.equal(viewCache.recall(s, 'jobs').result.total, 0);
});

test('the view cache is on unless settings say "viewCache": false', () => {
  const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cache-')), {encrypt: v => v, decrypt: v => v});
  s.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-1'}});  // never set: on
  viewCache.remember(s, 'focus', {ok: true, focus: {items: []}});
  assert.ok(viewCache.recall(s, 'focus'));
  s.saveSettings({viewCache: false});
  assert.equal(viewCache.recall(s, 'focus'), null);
});

test('a status write shows in the saved Jobs list and drops the saved Focus: a reload never brings back a dismissed job', () => {
  const s = storage();
  viewCache.remember(s, 'jobs', {jobs: [{url: 'https://x/ember', status: 'applied', stage: 'Interview scheduled'}, {url: 'https://x/alder', status: 'unreviewed', stage: ''}]});
  viewCache.remember(s, 'focus', {ok: true, focus: {}});
  const at = viewCache.recall(s, 'jobs').at;
  viewCache.statusChanged(s, 'https://x/ember', 'dismissed', 'Closed');
  const saved = viewCache.recall(s, 'jobs');
  assert.deepEqual(saved.result.jobs[0], {url: 'https://x/ember', status: 'dismissed', stage: 'Closed'});
  assert.equal(saved.result.jobs[1].status, 'unreviewed');
  assert.equal(saved.at, at);  // still says how old the read is
  assert.equal(viewCache.recall(s, 'focus'), null);
  viewCache.statusChanged(s, 'https://x/alder', 'saved');  // no Notion: the status alone
  assert.deepEqual(viewCache.recall(s, 'jobs').result.jobs[1], {url: 'https://x/alder', status: 'saved', stage: ''});
});

// 7 Oct 2026: Strategy's `stale` counts jobs waiting for a new score; a read with one was never kept, so every visit painted a copy
// from the morning (old places, remote Yes) before the fresh read. Only `stale: true` (a list from the cache) is refused.
test('a Strategy read with jobs waiting for a new score is kept', () => {
  const s = storage();
  viewCache.remember(s, 'strategy', {ok: true, lists: {country: [{fragment: 'Switzerland'}]}, remote_jobs: true, stale: 0});
  viewCache.remember(s, 'strategy', {ok: true, lists: {country: [{fragment: 'Romandie'}]}, remote_jobs: false, stale: 2594});
  const kept = viewCache.recall(s, 'strategy').result;
  assert.deepEqual([kept.lists.country[0].fragment, kept.remote_jobs], ['Romandie', false]);
});
