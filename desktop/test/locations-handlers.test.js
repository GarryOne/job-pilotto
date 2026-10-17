// "Which locations are right?" over IPC (owner, 17 Oct 2026): the first read moves the Profile's places in once and lists the conflicts, a pick is written and
// read back and says "Your search changed", no AI means nothing moves and it is tried again, an unknown choice is refused, demo shows one fictional conflict.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {registerLocationsHandlers} from '../lib/locations-handlers.js';

const PROFILE = '## Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Countries | Switzerland (anywhere) |\n| Home base | Zurich |\n';
const SEARCH = {locations: {top_tier: [], country_wide: ['netherlands', 'germany'], abroad: []}};
const GOOD = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({preferred: [], acceptable: ['Switzerland'], relocation: 'unspecified', destinations: []})}]})}}};

async function harness({ai = () => ({}), DEMO = false, settings = {store: 'sqlite'}} = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-locw-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  await store.openStore(storage).page('profile').write(PROFILE);
  storage.writeText('config/search.json', JSON.stringify(SEARCH));
  const handlers = {}, logged = [];
  registerLocationsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO, needsNotion: () => null,
    settingsDeps: null, log: (...line) => logged.push(line), ai, backup: () => ({file: 'backup.zip'})});   // never the real backup folders
  return {storage, handlers, logged};
}

test('no AI: nothing moves, nothing is marked, the next read tries again', async () => {
  const {storage, handlers} = await harness();
  const got = await handlers.locationsWhich();
  assert.deepEqual(got.conflicts, []);
  assert.equal(storage.settings().locationsMovedAt, undefined);
});

test('the first read moves once, lists the conflict, a pick closes it and says the search changed', async () => {
  const {storage, handlers, logged} = await harness({ai: () => GOOD});
  const got = await handlers.locationsWhich();
  assert.equal(got.error, '');
  assert.equal(got.conflicts.length, 1);
  assert.equal(got.conflicts[0].kind, 'acceptable');
  assert.ok(storage.settings().locationsMovedAt);
  assert.deepEqual(logged[0].slice(0, 2), ['strategy', 'places moved into Locations']);
  assert.ok(!JSON.stringify(logged).includes('Switzerland'), 'counts only, never a place');
  await handlers.locationsWhich();
  assert.equal(logged.length, 1, 'never moves twice');
  assert.deepEqual(await handlers.resolveLocationConflict('acceptable', 'nonsense'), {ok: false, error: 'Unknown choice'});
  assert.equal(storage.settings().searchChangedAt, undefined);
  assert.equal((await handlers.resolveLocationConflict('acceptable', 'profile')).ok, true);
  assert.deepEqual(JSON.parse(storage.readText('config/search.json')).locations.country_wide, ['Switzerland']);
  assert.ok(storage.settings().searchChangedAt);
  assert.deepEqual((await handlers.locationsWhich()).conflicts, []);
});

test('demo shows one fictional conflict and writes nothing', async () => {
  const {storage, handlers} = await harness({DEMO: true});
  assert.equal((await handlers.locationsWhich()).conflicts.length, 1);
  assert.deepEqual(await handlers.resolveLocationConflict('acceptable', 'profile'), {ok: true});
  assert.deepEqual(JSON.parse(storage.readText('config/search.json')), SEARCH);
});
