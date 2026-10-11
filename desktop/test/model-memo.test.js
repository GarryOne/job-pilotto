// The model-call cache of the e2e harness (lib/ai/model-memo.js): one answer per normalised request, only under the e2e env, never in the app's real folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {memoFile, memoKey, withMemo} from '../lib/ai/model-memo.js';

const ask = (text, extra = {}) => ({model: 'claude-haiku-5-5', max_tokens: 500, system: 'Say what kind of page this is.', messages: [{role: 'user', content: text}], ...extra});

test('volatile fields do not change the key: query strings, timestamps, long ids, uuids', () => {
  const a = memoKey(ask('page https://jobs.example.com/o/role?token=abc&utm=1 at 2026-10-11T02:09:18.786Z id 1791685394882 ref 3f2a9c1e-7b2d-4c1a-9e0f-1a2b3c4d5e6f hash 0123456789abcdef0123'));
  const b = memoKey(ask('page https://jobs.example.com/o/role?token=zzz at 2026-10-12T11:00:00Z id 1791699999999 ref 00000000-1111-2222-3333-444444444444 hash fedcba9876543210fedc'));
  assert.equal(a, b);
});

test('what the model is really asked changes the key: the page, the system prompt, the schema, the model', () => {
  const base = memoKey(ask('buttons: [1] Apply [2] Share'));
  assert.notEqual(base, memoKey(ask('buttons: [1] Share [2] Apply')), 'a numbered list keeps its order: the number is the answer');
  assert.notEqual(base, memoKey({...ask('buttons: [1] Apply [2] Share'), system: 'Another prompt line.'}));
  assert.notEqual(base, memoKey({...ask('buttons: [1] Apply [2] Share'), output_config: {format: {type: 'json_schema', schema: {type: 'object'}}}}));
  assert.notEqual(base, memoKey({...ask('buttons: [1] Apply [2] Share'), model: 'claude-sonnet-5-5'}));
  assert.notEqual(memoKey(ask('job 12345')), memoKey(ask('job 12346')), 'a short number (a field id, a count) is kept');
});

test('a hit answers without asking; a miss asks once and is kept on disk for the next run', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  let calls = 0;
  const client = {engine: 'cli', messages: {create: async () => { calls += 1; return {content: [{type: 'text', text: '{"kind":"form"}'}], stop_reason: 'end_turn', usage: {input_tokens: 9, output_tokens: 3}}; }}};
  withMemo(client, file);
  const first = await client.messages.create(ask('a form page'));
  const second = await client.messages.create(ask('a form page'));
  assert.equal(calls, 1);
  assert.deepEqual(second.content, first.content);
  assert.equal(client.engine, 'cli', 'the adapter keeps its own properties');
  const again = {messages: {create: async () => { throw new Error('must not ask'); }}};
  withMemo(again, file);
  assert.deepEqual((await again.messages.create(ask('a form page'))).content, first.content);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.keys(stored).length, 1);
  assert.ok(!JSON.stringify(stored).includes('a form page'), 'the request text is not stored, only its hash and the answer');
});

test('a failed ask is not kept', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  const client = {messages: {create: async () => { throw new Error('limit'); }}};
  withMemo(client, file);
  await assert.rejects(client.messages.create(ask('x')));
  assert.equal(fs.existsSync(file), false);
});

test('the cache exists only under the e2e env, and never in the app\'s own folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-'));
  assert.equal(memoFile({JOB_PILOTTO_MODEL_MEMO: path.join(dir, 'm.json')}), '', 'no JOB_PILOTTO_E2E: the person\'s app never memoizes');
  assert.equal(memoFile({JOB_PILOTTO_E2E: '1'}), '');
  assert.equal(memoFile({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO: path.join(dir, 'm.json')}), path.join(dir, 'm.json'));
  const real = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto', 'model-memo.json');
  assert.equal(memoFile({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO: real}), '');
});

test('the app\'s AI client is memoized through one place only', () => {
  const index = fs.readFileSync(new URL('../lib/ai/index.js', import.meta.url), 'utf8');
  assert.match(index, /withMemo\(/);
  const users = fs.readdirSync(new URL('../lib', import.meta.url), {recursive: true}).filter(file => String(file).endsWith('.js'))
    .filter(file => fs.readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8').includes('withMemo('));
  assert.deepEqual(users.map(String).sort(), ['ai/index.js', 'ai/model-memo.js']);
});
