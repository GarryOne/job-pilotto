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
