// The person's data the desktop edits itself goes through the store (lib/store), so it works with the data on this Mac: the Profile's
// lines a CV change suggests, a setup goal, the form knowledge a contact proposal reads. Notion's side: cv-change / strategy-goals tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cvChange from '../lib/cv-change.js';
import * as goals from '../lib/goals.js';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';

function onThisMac(profile = '') {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-data-')), {encrypt: v => v, decrypt: v => v});
  storage.setSecret('NOTION_TOKEN', 'leftover');   // a Notion still connected must never be written
  storage.saveSettings({store: 'sqlite', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  storage.writeText('profile.md', profile);
  return storage;
}
const noNotion = async url => { throw new Error(`Notion was called: ${url}`); };

test('accepted CV changes are written to profile.md, bottom-up, never to Notion', async () => {
  const storage = onThisMac('## Experience\n- SRE at Acme, 2019–2024\n- Kubernetes on AWS\n- Old line to drop\n');
  const lines = (await store.openStore(storage).page('profile').blocks()).filter(b => b.text.trim());
  const accepted = [{kind: 'update', line: 1, block: lines[1], text: 'Staff SRE at Acme, 2019–2025'},
    {kind: 'add', line: 2, block: lines[2], text: 'Led the move to Argo CD'}, {kind: 'remove', line: 3, block: lines[3], text: ''}];
  assert.deepEqual(await cvChange.apply(storage, accepted, noNotion), {applied: 3, failed: []});
  assert.equal(storage.readText('profile.md'), '## Experience\n- Staff SRE at Acme, 2019–2025\n- Kubernetes on AWS\n- Led the move to Argo CD\n');
});

test('a setup goal is written to profile.md when Notion is not the store, even with a token left', async () => {
  const storage = onThisMac('# Profile\n');
  const lib = new Proxy({}, {get: () => () => { throw new Error('Notion was called'); }});
  assert.deepEqual(await goals.setGoal(storage, goals.GOALS[0], 'Senior', {lib}), {ok: true, where: 'local'});
  assert.match(storage.readText('profile.md'), /Senior/);
});

test('with the data on this Mac nothing is moved or published into a Notion left connected', async () => {
  const storage = onThisMac('# Profile\n');
  storage.saveSettings({setupDone: true});
  const {run} = await import('../lib/migrate.js');
  const ran = [];
  const step = {name: 'a step', run: async () => { ran.push('a step'); return true; }};   // run() catches a step's errors: record instead
  assert.deepEqual(await run(storage, () => {}, [step], noNotion), []);
  assert.deepEqual(ran, []);
  const {publishSearchSettings} = await import('../lib/strategy-settings.js');
  const never = () => { throw new Error('Notion was written'); };
  assert.equal(await publishSearchSettings(storage, {run: never, ensurePage: never, writePage: never}), null);
});
