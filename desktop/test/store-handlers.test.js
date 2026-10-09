// Settings → Your data (lib/store-handlers.js): the card's state from capabilities, keeping the data on this Mac only while trying
// (the one switch made by hand; leaving a store is the one-way move), and "Move my data to Notion" (lib/store-move.js, its own test).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {registerStoreHandlers, settleStore, STORE_CHOICE, storeState} from '../lib/store-handlers.js';

const make = (settings = {}, token = '') => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sh-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  if (token) storage.setSecret('NOTION_TOKEN', token);
  return storage;
};
const handlers = (storage, choice = true, extra = {}) => {
  const map = {}, logged = [], sent = [];
  registerStoreHandlers({ipcMain: {handle: (name, fn) => { map[name] = fn; }}, storage, DEMO: false, log: (...line) => logged.push(line), choice,
    toWindow: (...message) => sent.push(message), ...extra});
  return {map, logged, sent};
};

test('the card\'s state: a label and capabilities, never an adapter name', () => {
  assert.deepEqual(storeState(make({store: 'sqlite'})), {label: 'This Mac', caps: [], trying: false, notionConnected: false, choice: true});
  const notion = storeState(make({notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}}, 't'));
  assert.equal(notion.label, 'Notion');
  assert.deepEqual(notion.caps.sort(), ['cloud', 'files', 'links']);
  assert.equal(storeState(make()).trying, true);
});

test('keep it on this Mac: only while trying, and logged', async () => {
  const storage = make();
  const {map, logged} = handlers(storage);
  assert.equal((await map.keepOnThisMac()).ok, true);
  assert.equal(storage.settings().store, 'sqlite');
  assert.deepEqual(logged[0].slice(0, 2), ['store', 'chosen']);
  const connected = make({notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}}, 't');
  assert.equal((await handlers(connected).map.keepOnThisMac()).ok, false);
  assert.equal(connected.settings().store, undefined);
});

test('move my data to Notion: progress reaches the window, a second press waits for the first, the card gets the new state', async () => {
  let calls = 0, finish;
  const move = (storage, {onProgress}) => { calls++; onProgress({entity: 'applications', done: 1, total: 2}); return new Promise(done => { finish = done; }); };
  const storage = make({store: 'sqlite'});
  const {map, sent} = handlers(storage, true, {move});
  const first = map.moveToNotion(), second = map.moveToNotion();
  storage.saveSettings({store: 'notion'});
  finish({ok: true, moved: {applications: 2}});
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.store.label, 'Notion');
  assert.deepEqual(sent[0], ['storeMoveProgress', {entity: 'applications', done: 1, total: 2}]);
});

test('with the choice off (JOB_PILOTTO_STORE_CHOICE=0, the only way now), there is no switch to this Mac', async () => {
  const storage = make();
  assert.equal((await handlers(storage, false).map.keepOnThisMac()).ok, false);
  assert.equal(storage.settings().store, undefined);
  assert.equal(STORE_CHOICE, process.env.JOB_PILOTTO_STORE_CHOICE !== '0', 'it ships on');
});

test('at start, an install with no store gets its home once: Notion when connected (no change, D7), else this Mac', () => {
  const fresh = make(), logged = [];
  assert.equal(settleStore(fresh, {choice: true, log: (...line) => logged.push(line)}), 'sqlite');
  assert.equal(fresh.settings().store, 'sqlite');
  assert.deepEqual(logged[0].slice(0, 2), ['store', 'chosen']);
  assert.equal(storeState(fresh, {choice: true}).trying, false, 'a new install tracks at once, with nothing to set up');
  // Connecting Notion later (for Always on) does not move the data: only "Move my data to Notion" does.
  fresh.setSecret('NOTION_TOKEN', 't'); fresh.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}});
  assert.equal(settleStore(fresh, {choice: true}), null);
  assert.equal(storeState(fresh, {choice: true}).label, 'This Mac');

  const onNotion = make({notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}}, 't');
  assert.equal(settleStore(onNotion, {choice: true}), 'notion');
  assert.equal(storeState(onNotion, {choice: true}).label, 'Notion');

  const chosen = make({store: 'sqlite'}, 't');
  assert.equal(settleStore(chosen, {choice: true}), null, 'a home once chosen is never changed here');
  const off = make();
  assert.equal(settleStore(off, {choice: false}), null);
  assert.equal(off.settings().store, undefined, 'with the choice off, nothing is written (the old app)');
});
