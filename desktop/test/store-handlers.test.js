// Settings → Your data (lib/store-handlers.js): the card's state from capabilities, keeping the data on this Mac only while trying
// (the one switch made by hand; leaving a store is the one-way move), and "Move my data to Notion" a stub until P4.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {registerStoreHandlers, storeState} from '../lib/store-handlers.js';

const make = (settings = {}, token = '') => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sh-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  if (token) storage.setSecret('NOTION_TOKEN', token);
  return storage;
};
const handlers = (storage, choice = true) => {
  const map = {}, logged = [];
  registerStoreHandlers({ipcMain: {handle: (name, fn) => { map[name] = fn; }}, storage, DEMO: false, log: (...line) => logged.push(line), choice});
  return {map, logged};
};

test('the card\'s state: a label and capabilities, never an adapter name', () => {
  assert.deepEqual(storeState(make({store: 'sqlite'})), {label: 'This Mac', caps: [], trying: false, notionConnected: false, choice: false});
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

test('move my data to Notion: a stub that says so (P4 builds it)', async () => {
  assert.deepEqual(await handlers(make({store: 'sqlite'})).map.moveToNotion(), {ok: false, text: 'Not built yet', error: 'Not built yet'});
});

test('the choice is off until the engine side is done: no switch, and the default build hides it', async () => {
  const storage = make();
  assert.equal((await handlers(storage, false).map.keepOnThisMac()).ok, false);
  assert.equal(storage.settings().store, undefined);
  const {STORE_CHOICE} = await import('../lib/store-handlers.js');
  assert.equal(STORE_CHOICE, process.env.JOB_PILOTTO_STORE_CHOICE === '1');
});
