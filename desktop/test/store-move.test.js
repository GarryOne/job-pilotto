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
// The workspace repair (lib/schema.js) answers Notion; here it only hands the ids back.
const kept = async (_token, ids) => ({ids});
const MOVED = 'moving applications 1/2\nmoving applications 2/2\n{"moved": {"applications": 2, "events": 3, "kept": ["profile"]}}'.split('\n');

test('a finished copy: progress per entity, search settings published, the store switches and this Mac\'s files are archived', async () => {
  const storage = connected(), {run, asked} = engine(MOVED), progress = [], logged = [];
  let published = 0;
  const result = await moveToNotion(storage, {repair: kept, run, publish: async () => { published++; }, onProgress: p => progress.push(p),
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

test('form knowledge to move: the Knowledge page is made before the copy writes it; none to move, no page', async () => {
  const storage = connected(), order = [];
  fs.writeFileSync(storage.path('knowledge.md'), '- [workday.com · site] phone: needs a country code');
  const run = async () => { order.push('copy'); return {code: 0, stdout: '{"moved": {}}'}; };
  await moveToNotion(storage, {repair: kept, run, publish: async () => {}, knowledgePage: async () => { order.push('page'); }});
  assert.deepEqual(order, ['page', 'copy']);
  const empty = connected(), made = [];
  await moveToNotion(empty, {repair: kept, run: async () => ({code: 0, stdout: '{"moved": {}}'}), publish: async () => {}, knowledgePage: async () => { made.push(1); }});
  assert.equal(made.length, 0);
});

test('a copy that stops changes nothing: the store, the files and the settings stay as they were', async () => {
  const storage = connected(), {run} = engine(['moving applications 1/2', 'Traceback: ConnectionError'], {code: 1});
  const result = await moveToNotion(storage, {repair: kept, run, publish: async () => { throw new Error('must not publish'); }});
  assert.deepEqual(result, {ok: false, error: STOPPED});
  assert.equal(storage.settings().store, 'sqlite');
  assert.ok(fs.existsSync(storage.path('data/tracker.sqlite')));
});

test('not connected yet: the answer asks to connect (the window connects, then runs the move again); nothing runs', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-mv-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const {run, asked} = engine(MOVED);
  const result = await moveToNotion(storage, {repair: kept, run});
  assert.equal(result.needsNotion, true);
  assert.equal(result.text, 'Connect Notion to move your data there.');
  assert.equal(asked.length, 0);
});

test('data already in Notion: nothing to move', async () => {
  const {run, asked} = engine(MOVED);
  assert.equal((await moveToNotion(connected({store: 'notion'}), {run})).ok, false);
  assert.equal(asked.length, 0);
});

test('the workspace is repaired before the copy, and its ids are kept (migrate runs nothing on this Mac\'s store)', async () => {
  const storage = connected(), order = [];
  const repair = async (token, ids) => { order.push(['repair', token, ids.NOTION_PROFILE_PAGE_ID]); return {ids: {...ids, NOTION_EVENTS_DB: 'events-db'}}; };
  const run = async () => { order.push(['copy']); return {code: 0, stdout: '{"moved": {}}'}; };
  await moveToNotion(storage, {run, repair, publish: async () => {}});
  assert.deepEqual(order, [['repair', 'ntn_test', 'profile-page'], ['copy']]);
  assert.equal(storage.settings().notionIds.NOTION_EVENTS_DB, 'events-db');
});

test('a workspace the connect just built: the copy writes this Mac\'s texts over its template text; the flag goes after the move', async () => {
  const storage = connected({store: 'sqlite', storeTextsWin: true}), {run, asked} = engine(['{"moved": {}}']);
  await moveToNotion(storage, {run, repair: kept, publish: async () => {}});
  assert.deepEqual(asked[0], ['src.stores.copy', '--from', 'sqlite', '--to', 'notion', '--source-texts-win']);
  assert.equal(storage.settings().storeTextsWin, undefined);
  const before = connected({store: 'sqlite', storeTextsWin: false}), other = engine(['{"moved": {}}']);
  await moveToNotion(before, {run: other.run, repair: kept, publish: async () => {}});
  assert.deepEqual(other.asked[0], ['src.stores.copy', '--from', 'sqlite', '--to', 'notion']);
});
