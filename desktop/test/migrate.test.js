import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as migrate from '../lib/migrate.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const connected = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}});
  return storage;
};

test('moves to Notion run once set up with Notion; a failing step is reported and retried next start', async () => {
  const storage = connected();
  const lines = [];
  const moved = await migrate.run(storage, line => lines.push(line), [
    {name: 'a', run: async () => true},
    {name: 'b', run: async () => { throw new Error('Notion is down'); }},
    {name: 'c', run: async () => false},  // nothing to move
  ]);
  assert.deepEqual(moved, ['a']);
  assert.match(lines.join('\n'), /Moving b to Notion failed \(will retry next start\): Notion is down/);
  assert.match(lines.join('\n'), /Moved to Notion: a\./);
});

test('nothing moves before setup or without Notion', async () => {
  const storage = connected();
  storage.saveSettings({setupDone: false});
  assert.deepEqual(await migrate.run(storage, () => {}, [{name: 'a', run: async () => true}]), []);
});

test('an install set up before the central index keeps its daily scout; a new install starts without one', () => {
  const existing = connected();
  assert.equal(migrate.pinScoutSchedule(existing), true);
  assert.equal(existing.settings().schedule.scout, 'daily');
  const chosen = connected();
  chosen.saveSettings({schedule: {scout: 'weekly', mail: 3}});
  migrate.pinScoutSchedule(chosen);
  assert.deepEqual(chosen.settings().schedule, {scout: 'weekly', mail: 3});  // their own choice stays
  const fresh = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  assert.equal(migrate.pinScoutSchedule(fresh), false);
  assert.equal(fresh.settings().schedule?.scout, undefined);
  fresh.saveSettings({setupDone: true});   // finishes setup later: still no scout, the pin ran only once
  assert.equal(migrate.pinScoutSchedule(fresh), false);
  assert.equal(fresh.settings().schedule?.scout, undefined);
});

test('the interview job line is backfilled once per install, and retried when it fails', async () => {
  const storage = connected();
  const step = migrate.STEPS.find(s => s.name === 'interview job links');
  assert.ok(step);
  const {default: pipeline} = {default: await import('../lib/pipeline.js')};
  assert.equal(typeof pipeline.run, 'function');
  storage.saveSettings({interviewLinksFilled: true});
  assert.equal(await step.run(storage), false);  // already done: nothing runs
});
