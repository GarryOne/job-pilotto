// Your details' fact sections reach the screen (owner, 17 Oct 2026): each section has its panel (⌘K lists it), the screen saves them with Contact through
// the one bar, the handlers read, save and resolve through lib/profile-sections.js and lib/profile-move.js, and the move runs once, never twice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {registerDetailsFactsHandlers} from '../lib/details-facts-handlers.js';
import * as sections from '../lib/profile-sections.js';
import * as store from '../lib/store/index.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('every section has its own panel on Your details, and the screen draws exactly those', async () => {
  const html = read('renderer/index.html');
  const keys = JSON.parse(read('renderer/pages/details-facts.js').match(/KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(keys, Object.keys(sections.SECTIONS));
  for (const key of keys) assert.match(html, new RegExp(`id="setting-${key}" data-profile-panel="details"[\\s\\S]*?data-facts="${key}"`), key);
  assert.match(html, /id="setting-which" data-profile-panel="details" data-wanted="0" hidden/);
});

test('one Save bar: Contact, then the fact sections; Discard redraws them', () => {
  const profile = read('renderer/pages/profile.js');
  assert.match(profile, /saved\.ok \? await window\.pilot\.saveDetailsFacts\(factsNow\(\)\) : saved/);
  assert.match(profile, /showFacts\(\);/);
});

function harness(settings = {store: 'sqlite'}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  const handlers = {}, logged = [];
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false,
    connected: () => true, needsNotion: () => null, log: (...line) => logged.push(line)});
  return {storage, handlers, logged};
}

test('handlers: saved lines read back; with no AI nothing moves and the move is tried again next time', async () => {
  const {storage, handlers} = harness();
  await store.openStore(storage).page('profile').write('## Targets\n- **Notice period:** 2 months\n');
  assert.deepEqual((await handlers.saveDetailsFacts({languages: [{label: 'English', value: 'native'}, {label: 'German', value: ''}]})), {ok: true});
  const got = await handlers.detailsFacts();
  assert.equal(got.ok, true);
  assert.deepEqual(got.sections.languages, [{label: 'English', value: 'native'}]);
  assert.equal(storage.settings().profileMovedAt, undefined, 'no AI: not marked moved');
  assert.match(await store.openStore(storage).page('profile').text(), /Notice period/);
  assert.deepEqual(await handlers.resolveDetailsConflict('nothing open', 0), {ok: false, error: 'That choice is no longer open'});
});

test('handlers: once the move ran, opening Your details never moves again', async () => {
  const {handlers, logged} = harness({store: 'sqlite', profileMovedAt: '2026-10-17T10:00:00Z'});
  await handlers.detailsFacts();
  assert.equal(logged.length, 0);
});
