// "Help the pool grow" is opt-in: off by default, nothing in the run environment or the user's GitHub repo until switched on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as poolShare from '../lib/pool-share.js';
import {pipelineEnv} from '../lib/pipeline.js';
import * as github from '../lib/github.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const fresh = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('off by default: no variable reaches the run environment', () => {
  const storage = fresh();
  assert.equal(poolShare.on(storage), false);
  assert.equal(poolShare.variables(storage), null);
  const env = pipelineEnv(storage, {});
  assert.equal(env.JOB_PILOTTO_SHARE_EMPLOYERS, undefined);
  assert.equal(env.JOB_PILOTTO_INSTALL_ID, undefined);
});

test('switched on: the run environment gets the switch and the same random id technical reports use', () => {
  const storage = fresh();
  storage.saveSettings({telemetryId: 'existing-random-id'});
  poolShare.set(storage, true);
  const env = pipelineEnv(storage, {});
  assert.equal(env.JOB_PILOTTO_SHARE_EMPLOYERS, '1');
  assert.equal(env.JOB_PILOTTO_INSTALL_ID, 'existing-random-id');
});

test('switching on makes an id when there is none; switching off removes everything again', () => {
  const storage = fresh();
  poolShare.set(storage, true);
  assert.match(storage.settings().telemetryId, /^[0-9a-f-]{36}$/);
  poolShare.set(storage, false);
  assert.equal(pipelineEnv(storage, {}).JOB_PILOTTO_SHARE_EMPLOYERS, undefined);
});

test('Always on follows the switch: variables set when on, removed when off', async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => { calls.push(`${options.method || 'GET'} ${new URL(url).pathname}`); return new Response('{}', {status: 200}); };
  const storage = fresh();
  storage.saveSettings({cloud: {repo: 'me/job-pilotto-private'}});
  storage.setSecret('GITHUB_TOKEN', 'ghu_x');
  await github.updateRepo(storage, {fetcher});
  assert.ok(calls.some(c => c.startsWith('DELETE') && c.includes('JOB_PILOTTO_SHARE_EMPLOYERS')), calls.join('\n'));
  assert.ok(!calls.some(c => c.startsWith('POST') && c.includes('/variables')));
  calls.length = 0;
  poolShare.set(storage, true);
  await github.updateRepo(storage, {fetcher});
  assert.ok(calls.some(c => c.includes('/actions/variables')), calls.join('\n'));
  assert.ok(!calls.some(c => c.startsWith('DELETE') && c.includes('JOB_PILOTTO_SHARE_EMPLOYERS')));
});
