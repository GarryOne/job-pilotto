import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {handleUpdate} from '../../worker/src/index.js';
import * as pipeline from '../lib/pipeline.js';
import {due} from '../lib/schedule.js';
import {createStorage} from '../lib/storage.js';
import * as telegram from '../lib/telegram.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
const HOUR = 3600 * 1000;

test('a search is due every 4 hours after setup, unless switched off', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(due({setupDone: false}, now), false);
  assert.equal(due({setupDone: true}, now), true);
  assert.equal(due({setupDone: true, lastSearchAt: new Date(now - 3 * HOUR).toISOString()}, now), false);
  assert.equal(due({setupDone: true, lastSearchAt: new Date(now - 5 * HOUR).toISOString()}, now), true);
  assert.equal(due({setupDone: true, autoSearch: false}, now), false);
});

test('Telegram actions run the same pipeline command as the GitHub workflow', () => {
  const storage = tempStorage();
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'today'}), ['src', 'daily', '--mode', 'today']);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  storage.setSecret('TELEGRAM_BOT_TOKEN', '1:abc');
  storage.saveSettings({telegramChatId: '42'});
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'scheduled'}),
    ['src', 'daily', '--mode', 'scheduled', '--send', '--enrich-max', '100', '--score-max', '60', '--insight']);
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'apply', job: 'ab12cd34', action: 'saved'}),
    ['src', 'daily', '--mode', 'apply', '--send', '--job', 'ab12cd34', '--action', 'saved']);
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'more', seed: 7, page: 2}),
    ['src', 'daily', '--mode', 'more', '--send', '--page', '2', '--seed', '7']);
});

test('pairing waits for Start in a private chat, then greets the user', async () => {
  const sent = [];
  let polls = 0;
  const fetcher = async (url, init) => {
    const method = url.split('/').pop();
    const body = JSON.parse(init.body);
    sent.push([method, body]);
    const ok = result => new Response(JSON.stringify({ok: true, result}));
    if (method === 'getMe') return ok({username: 'my_pilot_bot'});
    if (method === 'getUpdates') {
      polls += 1;
      return ok(polls === 1 ? [{update_id: 5, message: {chat: {id: 99, type: 'group'}, text: '/start'}}]
        : polls === 2 ? [{update_id: 6, message: {chat: {id: 42, type: 'private'}, text: '/start'}}] : []);
    }
    return ok({});
  };
  const result = await telegram.pair('1:abc', 5, fetcher);
  assert.deepEqual(result, {chatId: '42', username: 'my_pilot_bot'});
  assert.equal(sent.find(([m]) => m === 'sendMessage')[1].chat_id, 42);
});

test('a bot with a webhook is refused with a clear message', async () => {
  const fetcher = async url => new Response(JSON.stringify(url.endsWith('getMe') ? {ok: true, result: {username: 'b'}}
    : {ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active'}));
  await assert.rejects(telegram.pair('1:abc', 5, fetcher), /webhook/);
});

test('the Worker\'s command handling runs locally through the app\'s dispatch', async () => {
  const dispatched = [];
  const replies = [];
  globalThis.fetch = async (url, init) => { replies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ok: true, result: {}})); };
  const env = {TELEGRAM_BOT_TOKEN: '1:abc', OWNER_CHAT_ID: '42', dispatch: async (inputs, workflow) => dispatched.push([inputs, workflow])};
  await handleUpdate(env, {message: {chat: {id: 42}, text: '/run'}});
  await handleUpdate(env, {message: {chat: {id: 7}, text: '/run'}}); // a stranger: ignored
  assert.deepEqual(dispatched, [[{mode: 'run'}, undefined]]);
  assert.match(replies[0].text, /Crawling now/);
});
