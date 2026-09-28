import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as tgCloud from '../lib/telegram-cloud.js';
import {createStorage} from '../lib/storage.js';

function ready() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tgc-')), {encrypt: v => v, decrypt: v => v});
  storage.setSecret('TELEGRAM_BOT_TOKEN', '123:bot');
  storage.setSecret('GITHUB_TOKEN', 'ghu_x');
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({telegramChatId: 42, cloud: {repo: 'alex/job-pilotto-private'}, notionIds: {NOTION_APPLICATIONS_DB: 'db1', NOTION_MATCHES_DB: ''}});
  return storage;
}

function fakeCloudflare({subdomain = 'alex'} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, method: init.method, body: init.body});
    const route = url.replace('https://api.cloudflare.com/client/v4', '');
    const ok = result => new Response(JSON.stringify({success: true, result}));
    if (route === '/accounts') return ok([{id: 'acc1'}]);
    if (route.endsWith('/workers/subdomain') && init.method === 'GET') return subdomain ? ok({subdomain}) : new Response(JSON.stringify({success: false, errors: [{code: 10007, message: 'none'}]}), {status: 404});
    if (route.endsWith('/workers/subdomain') && init.method === 'PUT') return ok({subdomain: JSON.parse(init.body).subdomain});
    return ok({});
  };
  return {calls, fetcher};
}

test('turning it on needs the Telegram bot and "Keep working while my Mac is off" first', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tgc-')), {encrypt: v => v, decrypt: v => v});
  assert.match((await tgCloud.turnOn(storage, 'cf')).error, /Telegram/);
  storage.setSecret('TELEGRAM_BOT_TOKEN', '1:a'); storage.saveSettings({telegramChatId: 1});
  assert.match((await tgCloud.turnOn(storage, 'cf')).error, /Mac is off/);
});

test('the Worker gets the chat, repo and Notion ids as plain values and the keys as secrets', () => {
  const list = tgCloud.bindings(ready(), 'hook');
  const by = Object.fromEntries(list.map(b => [b.name, b]));
  assert.deepEqual(by.OWNER_CHAT_ID, {type: 'plain_text', name: 'OWNER_CHAT_ID', text: '42'});
  assert.equal(by.GITHUB_REPO.text, 'alex/job-pilotto-private');
  assert.equal(by.WORKFLOW_FILE.text, 'daily.yml');
  assert.equal(by.NOTION_APPLICATIONS_DB.text, 'db1');
  assert.equal(by.NOTION_MATCHES_DB, undefined);
  for (const name of ['TELEGRAM_BOT_TOKEN', 'WEBHOOK_SECRET', 'GITHUB_TOKEN', 'NOTION_TOKEN']) assert.equal(by[name].type, 'secret_text');
  assert.equal(by.ANTHROPIC_API_KEY, undefined);  // not set: not sent
});

test('turning it on uploads the bot, gives it an address, points the webhook there and stops the app polling', async () => {
  const storage = ready();
  const {calls, fetcher} = fakeCloudflare();
  const telegram = [];
  const result = await tgCloud.turnOn(storage, ' cf-token ', {fetcher, bundle: () => 'export default {}', random: () => 'secret123456',
    telegram: async (token, method, body) => { telegram.push([token, method, body]); return true; }});
  assert.deepEqual(result, {ok: true, url: 'https://job-pilotto-bot.alex.workers.dev'});
  const upload = calls.find(c => c.method === 'PUT' && c.url.endsWith('/workers/scripts/job-pilotto-bot'));
  assert.ok(upload.body instanceof FormData);
  assert.equal(JSON.parse(await upload.body.get('metadata').text()).main_module, 'index.js');
  assert.ok(calls.some(c => c.url.endsWith('/job-pilotto-bot/subdomain') && c.method === 'POST'));
  assert.deepEqual(telegram[0], ['123:bot', 'setWebhook', {url: 'https://job-pilotto-bot.alex.workers.dev/telegram',
    secret_token: 'secret123456', allowed_updates: ['message', 'callback_query']}]);
  assert.equal(storage.secret('CLOUDFLARE_API_TOKEN'), 'cf-token');
  assert.equal(storage.settings().telegramCloud.url, 'https://job-pilotto-bot.alex.workers.dev');
});

test('an account without a workers.dev address gets one', async () => {
  const {calls, fetcher} = fakeCloudflare({subdomain: ''});
  const result = await tgCloud.turnOn(ready(), 'cf', {fetcher, bundle: () => '', random: () => 'abcdef123', telegram: async () => true});
  assert.equal(result.url, 'https://job-pilotto-bot.jobpilotto-abcdef.workers.dev');
  assert.ok(calls.some(c => c.method === 'PUT' && c.url.endsWith('/workers/subdomain')));
});

test('a token without the right permissions says which ones', async () => {
  const fetcher = async () => new Response(JSON.stringify({success: false, errors: [{code: 10000, message: 'Authentication error'}]}), {status: 403});
  const result = await tgCloud.turnOn(ready(), 'cf', {fetcher, telegram: async () => true});
  assert.match(result.error, /Workers Scripts: Edit/);
});

test('turning it off removes the webhook and the Worker and forgets the token', async () => {
  const storage = ready();
  storage.setSecret('CLOUDFLARE_API_TOKEN', 'cf');
  storage.saveSettings({telegramCloud: {url: 'https://x', account: 'acc1'}});
  const {calls, fetcher} = fakeCloudflare();
  const telegram = [];
  await tgCloud.turnOff(storage, {fetcher, telegram: async (t, method) => { telegram.push(method); return true; }});
  assert.deepEqual(telegram, ['deleteWebhook']);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.includes('/workers/scripts/job-pilotto-bot')));
  assert.equal(storage.secret('CLOUDFLARE_API_TOKEN'), '');
  assert.equal(storage.settings().telegramCloud, null);
});
