// Trying (set up without Notion): the strategy is kept on this Mac until Notion is connected, and the engine reads it from there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as strategy from '../lib/strategy.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const trying = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('without Notion the Profile and answers are this Mac\'s files, and missing files read as empty', async () => {
  const storage = trying();
  assert.deepEqual(await strategy.profileTexts(storage), {profile: '', answers: ''});
  storage.writeText('profile.md', '# Me\nSRE');
  storage.writeText('answers.md', 'Notice: 1 month');
  assert.deepEqual(await strategy.profileTexts(storage), {profile: '# Me\nSRE', answers: 'Notice: 1 month'});
});

test('saveLocal writes both files owner-only, and null leaves a file as it is', () => {
  const storage = trying();
  strategy.saveLocal(storage, {profile: 'P1', answers: 'A1'});
  assert.equal(storage.readText('profile.md'), 'P1');
  if (process.platform !== 'win32') assert.equal(fs.statSync(storage.path('profile.md')).mode & 0o777, 0o600);  // Windows has no Unix modes
  strategy.saveLocal(storage, {profile: 'P2', answers: null});
  assert.equal(storage.readText('profile.md'), 'P2');
  assert.equal(storage.readText('answers.md'), 'A1');
});

test('saveLocal with backup keeps the replaced files in a backup folder first', () => {
  const storage = trying();
  strategy.saveLocal(storage, {profile: 'P1', answers: 'A1'});
  const folder = strategy.saveLocal(storage, {profile: 'P2', answers: 'A2'}, {backup: true});
  assert.ok(folder && fs.existsSync(path.join(folder, 'profile.md')));
  assert.equal(fs.readFileSync(path.join(folder, 'profile.md'), 'utf8'), 'P1');
  assert.equal(fs.readFileSync(path.join(folder, 'answers.md'), 'utf8'), 'A1');
  assert.equal(storage.readText('profile.md'), 'P2');
  // nothing to back up: no folder
  assert.equal(strategy.saveLocal(trying(), {profile: 'x', answers: 'y'}, {backup: true}), null);
});

import * as pipeline from '../lib/pipeline.js';
test('the sync after connecting spends no AI: every cap is 0 and the run is logged', () => {
  const args = pipeline.syncMatchesArgs();
  for (const flag of ['--enrich-max', '--score-max', '--auto-kit-max']) assert.equal(args[args.indexOf(flag) + 1], '0', flag);
  assert.ok(args.includes('--log-run'));
  assert.equal(args[args.indexOf('--mode') + 1], 'today');
  assert.ok(!args.includes('--send') && !args.includes('--insight'));
});
