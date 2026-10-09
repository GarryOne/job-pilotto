// "Move my data to Notion" (lib/store-move.js): the engine's copy with its progress, the switch only after a finished copy, this Mac's files
// archived out of use, a stopped copy changing nothing, and a person not connected yet asked to connect first (the move then runs again).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {moveToNotion, STOPPED} from '../lib/store-move.js';

const connected = (settings = {store: 'sqlite'}) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-mv-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({...settings, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile-page'}});
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  fs.mkdirSync(storage.path('data/files/a1'), {recursive: true});
  fs.writeFileSync(storage.path('data/tracker.sqlite'), 'db');
  fs.writeFileSync(storage.path('data/files/a1/cv.pdf'), 'pdf');
  fs.writeFileSync(storage.path('profile.md'), '# Me');
  return storage;
};
const engine = (lines, {code = 0} = {}) => {
  const asked = [];
  const run = async (_storage, args, onLine) => { asked.push(args); for (const line of lines) onLine(line); return {code, stdout: lines.join('\n')}; };
  return {run, asked};
};
const MOVED = 'moving applications 1/2\nmoving applications 2/2\n{"moved": {"applications": 2, "events": 3, "kept": ["profile"]}}'.split('\n');

test('a finished copy: progress per entity, search settings published, the store switches and this Mac\'s files are archived', async () => {
  const storage = connected(), {run, asked} = engine(MOVED), progress = [], logged = [];
  let published = 0;
  const result = await moveToNotion(storage, {run, publish: async () => { published++; }, onProgress: p => progress.push(p),
    log: (...line) => logged.push(line), now: new Date('2026-10-09T15:00:00Z')});
  assert.deepEqual(asked[0], ['src.stores.copy', '--from', 'sqlite', '--to', 'notion']);
  assert.deepEqual(progress, [{entity: 'applications', done: 1, total: 2}, {entity: 'applications', done: 2, total: 2}]);
  assert.equal(published, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.moved, {applications: 2, events: 3});
  assert.deepEqual(result.kept, ['profile']);
  assert.equal(storage.settings().store, 'notion');
  for (const name of ['data/tracker.sqlite', 'data/files/a1/cv.pdf', 'profile.md']) {
    assert.ok(!fs.existsSync(storage.path(name)), `${name} left in use`);
    assert.ok(fs.existsSync(path.join(result.archive, name)), `${name} not archived`);
  }
  assert.deepEqual(logged.at(-1), ['store', 'moved', {to: 'notion', applications: 2, events: 3, kept: 1}]);
});

test('a copy that stops changes nothing: the store, the files and the settings stay as they were', async () => {
  const storage = connected(), {run} = engine(['moving applications 1/2', 'Traceback: ConnectionError'], {code: 1});
  const result = await moveToNotion(storage, {run, publish: async () => { throw new Error('must not publish'); }});
  assert.deepEqual(result, {ok: false, error: STOPPED});
  assert.equal(storage.settings().store, 'sqlite');
  assert.ok(fs.existsSync(storage.path('data/tracker.sqlite')));
});

test('not connected yet: the answer asks to connect (the window connects, then runs the move again); nothing runs', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-mv-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const {run, asked} = engine(MOVED);
  const result = await moveToNotion(storage, {run});
  assert.equal(result.needsNotion, true);
  assert.equal(result.text, 'Connect Notion to move your data there.');
  assert.equal(asked.length, 0);
});

test('data already in Notion: nothing to move', async () => {
  const {run, asked} = engine(MOVED);
  assert.equal((await moveToNotion(connected({store: 'notion'}), {run})).ok, false);
  assert.equal(asked.length, 0);
});
