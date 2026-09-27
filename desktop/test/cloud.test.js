import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {due} from '../lib/schedule.js';
import {createStorage} from '../lib/storage.js';
import {telegramEnv} from '../lib/telegram.js';

const sodium = createRequire(import.meta.url)('libsodium-wrappers');
const fakeCrypto = {encrypt: s => s, decrypt: s => s};

function userStorage() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cloud-')), fakeCrypto);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-test');
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  storage.setSecret('TELEGRAM_BOT_TOKEN', '123:bot');
  storage.saveSettings({telegramChatId: 42, notionIds: {NOTION_APPLICATIONS_DB: 'apps', NOTION_MATCHES_DB: 'matches'}, setupDone: true});
  storage.writeText('config/search.json', '{"locations": ["zurich"]}\n');
  storage.writeText('config/preferences.json', '{"excluded_companies": ["Acme"]}\n');
  return storage;
}

// A small GitHub: records calls, answers like the real API.
async function fakeGitHub({repoExists = false, variableExists = []} = {}) {
  await sodium.ready;
  const keys = sodium.crypto_box_keypair();
  const calls = [];
  const files = {};
  const fetcher = async (url, {method = 'GET', body} = {}) => {
    const route = url.replace('https://api.github.com', '');
    const data = body ? JSON.parse(body) : undefined;
    calls.push({method, route, data});
    const json = (status, value) => ({ok: status < 300, status, json: async () => value});
    if (route === '/user') return json(200, {login: 'ada'});
    if (route === '/repos/ada/job-pilotto-private') return repoExists ? json(200, {private: true}) : json(404, {message: 'Not Found'});
    if (route === '/user/repos') return json(201, {});
    const content = route.match(/^\/repos\/ada\/job-pilotto-private\/contents\/(.+)$/);
    if (content && method === 'GET') return files[content[1]] ? json(200, files[content[1]]) : json(404, {});
    if (content && method === 'PUT') { files[content[1]] = {content: data.content, sha: 'x'}; return json(201, {}); }
    if (route.endsWith('/actions/secrets/public-key')) return json(200, {key: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL), key_id: 'k1'});
    if (route.includes('/actions/secrets/')) return json(201, {});
    if (route.endsWith('/actions/variables') && method === 'POST') return variableExists.includes(data.name) ? json(409, {}) : json(201, {});
    if (route.includes('/actions/variables/')) return json(204, null);
    if (route.includes('/dispatches')) return {ok: true, status: 204, json: async () => null};
    throw new Error(`unexpected ${method} ${route}`);
  };
  const open = sealed => sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), keys.publicKey, keys.privateKey));
  return {fetcher, calls, files, open};
}

test('turning it on creates the private repo with the schedules, settings, sealed keys and Notion IDs', async () => {
  const storage = userStorage();
  const gh = await fakeGitHub({variableExists: ['NOTION_MATCHES_DB']});
  const result = await github.connect(storage, 'gho_token', {fetcher: gh.fetcher});

  assert.equal(result.repo, 'ada/job-pilotto-private');
  assert.equal(result.created, true);
  assert.deepEqual(gh.calls.find(c => c.route === '/user/repos').data.private, true);
  for (const file of ['.github/workflows/daily.yml', '.github/workflows/scout.yml', '.github/workflows/mail.yml', 'README.md',
    'config/search.json', 'config/preferences.json']) assert.ok(gh.files[file], file);
  assert.match(Buffer.from(gh.files['.github/workflows/daily.yml'].content, 'base64').toString(), /GarryOne\/job-pilotto\/.github\/workflows\/daily.yml@main/);

  const secrets = Object.fromEntries(gh.calls.filter(c => c.method === 'PUT' && c.route.includes('/actions/secrets/'))
    .map(c => [c.route.split('/').pop(), gh.open(c.data.encrypted_value)]));
  assert.deepEqual(secrets, {ANTHROPIC_API_KEY: 'sk-ant-test', NOTION_TOKEN: 'ntn_test', TELEGRAM_BOT_TOKEN: '123:bot', TELEGRAM_CHAT_ID: '42'});
  assert.ok(gh.calls.some(c => c.method === 'PATCH' && c.route.endsWith('/actions/variables/NOTION_MATCHES_DB')));  // existing: updated
  assert.ok(gh.calls.some(c => c.method === 'POST' && c.data?.name === 'JOB_PILOTTO_SCORE_MODEL'));
  assert.equal(storage.settings().cloud.repo, 'ada/job-pilotto-private');
});

test('running it again reuses the repo and leaves unchanged files alone', async () => {
  const storage = userStorage();
  const gh = await fakeGitHub({repoExists: true});
  await github.connect(storage, 't', {fetcher: gh.fetcher});
  const writes = gh.calls.filter(c => c.method === 'PUT' && c.route.includes('/contents/')).length;
  gh.calls.length = 0;
  const again = await github.connect(storage, 't', {fetcher: gh.fetcher});
  assert.equal(again.created, false);
  assert.ok(writes > 0);
  assert.equal(gh.calls.filter(c => c.method === 'PUT' && c.route.includes('/contents/')).length, 0);
});

test('with the cloud on: no local timer, and buttons start runs in the repo', async () => {
  const storage = userStorage();
  storage.setSecret('GITHUB_TOKEN', 'gho_token');
  storage.saveSettings({cloud: {repo: 'ada/job-pilotto-private'}});
  assert.equal(due(storage.settings()), false);
  const gh = await fakeGitHub();
  await github.cloudDispatch(storage, () => {}, gh.fetcher)({mode: 'apply', job: 'ab12', page: undefined, seed: 7}, 'daily.yml');
  const call = gh.calls.find(c => c.route.includes('/dispatches'));
  assert.equal(call.route, '/repos/ada/job-pilotto-private/actions/workflows/daily.yml/dispatches');
  assert.deepEqual(call.data, {ref: 'main', inputs: {mode: 'apply', job: 'ab12', seed: '7'}});
  assert.match(telegramEnv(storage).status(), /even with the Mac off/);
});
