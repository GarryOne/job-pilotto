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

test('Origin is backfilled once, after the workspace step adds the column; a failed run is retried next start', async () => {
  const names = migrate.STEPS.map(s => s.name);
  assert.ok(names.indexOf('workspace') < names.indexOf('origin'));
  const step = migrate.STEPS.find(s => s.name === 'origin');
  const storage = connected(), calls = [];
  await assert.rejects(step.run(storage, undefined, async (_, args) => { calls.push(args); return {code: 1}; }), /could not fill Origin/);
  assert.equal(storage.settings().originFilled, undefined);  // not marked: next start tries again
  assert.equal(await step.run(storage, undefined, async (_, args) => { calls.push(args); return {code: 0}; }), true);
  assert.deepEqual(calls[1], ['src.notion.origin', '--backfill', '--apply']);
  assert.equal(storage.settings().originFilled, true);
  assert.equal(await step.run(storage, undefined, async () => { throw new Error('must not run again'); }), false);
});

// ---- Notion later: the strategy kept on this Mac while trying moves in at connect ----
const withLocal = mode => {
  const storage = connected();
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'prof', NOTION_ANSWERS_PAGE_ID: 'ans'}, notionMoveIn: mode});
  storage.writeText('profile.md', '# Me\nSRE');
  storage.writeText('answers.md', 'Notice: 1 month');
  return storage;
};
const step = () => migrate.STEPS.find(s => s.name === 'strategy from this Mac');

test('strategy from this Mac: a fresh workspace gets the local Profile, answers and search settings, then the files go', async () => {
  const storage = withLocal('fresh');
  const written = [];
  const writePage = async (_token, page, text) => { written.push([page, text]); };
  const run = async () => ({code: 0, stdout: '## Roles\n- sre'});
  const ensurePage = async () => 'search-page';
  assert.equal(await step().run(storage, undefined, {writePage, run, ensurePage}), true);
  assert.deepEqual(written, [['prof', '# Me\nSRE'], ['ans', 'Notice: 1 month'], ['search-page', '## Roles\n- sre']]);
  assert.equal(storage.readText('profile.md'), '');
  assert.equal(storage.readText('answers.md'), '');
  assert.equal(storage.settings().notionMoveIn, undefined);
});

test('strategy from this Mac: an existing workspace wins; the files are only backed up', async () => {
  const storage = withLocal('existing');
  const writePage = async () => { throw new Error('must not write'); };
  assert.equal(await step().run(storage, undefined, {writePage}), true);
  const folder = storage.settings().notionKeptFolder;
  assert.ok(folder && fs.readFileSync(path.join(folder, 'profile.md'), 'utf8') === '# Me\nSRE');
  assert.equal(fs.readFileSync(path.join(folder, 'answers.md'), 'utf8'), 'Notice: 1 month');
  assert.equal(storage.readText('profile.md'), '');
  assert.equal(storage.settings().notionMoveIn, undefined);
});

test('strategy from this Mac: a failed write keeps both files and the flag, so the next start finishes the job', async () => {
  const storage = withLocal('fresh');
  const writePage = async (_t, page) => { if (page === 'ans') throw new Error('429'); };
  await assert.rejects(step().run(storage, undefined, {writePage, run: async () => ({code: 0, stdout: 'x'}), ensurePage: async () => 'sp'}), /429/);
  assert.equal(storage.readText('profile.md'), '# Me\nSRE');
  assert.equal(storage.readText('answers.md'), 'Notice: 1 month');
  assert.equal(storage.settings().notionMoveIn, 'fresh');
  // retry succeeds
  assert.equal(await step().run(storage, undefined, {writePage: async () => {}, run: async () => ({code: 0, stdout: 'x'}), ensurePage: async () => 'sp'}), true);
  assert.equal(storage.readText('profile.md'), '');
});

test('strategy from this Mac: without the flag (installs that already had Notion) it does nothing', async () => {
  const storage = connected();
  storage.writeText('profile.md', 'old copy');
  assert.equal(await step().run(storage, undefined, {writePage: async () => { throw new Error('no'); }}), false);
  assert.equal(storage.readText('profile.md'), 'old copy');
});

test('strategy from this Mac runs after the workspace step and before the steps that would hide it', () => {
  const names = migrate.STEPS.map(s => s.name);
  const at = names.indexOf('strategy from this Mac');
  assert.ok(names.indexOf('workspace') < at);
  assert.ok(at < names.indexOf('profile copies'));
  assert.ok(at < names.indexOf('search settings'));
});
