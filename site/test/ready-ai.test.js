// Ready to send, the night's AI relay (src/ready-ai.js): the container holds no key, the site forwards one fixed kind of call, counts its cost toward the night's cap and stops at it; the facts it answers from are sealed with the batch.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {ready, start} from '../src/ready.js';
import {clean, costMicro} from '../src/ready-ai.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }, text, args});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const r2 = () => { const m = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { m.delete(k); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key}))})}; };
const sent = [];
const model = usage => async (url, init) => { sent.push({url, init}); return new Response(JSON.stringify({content: [{type: 'text', text: '{}'}], usage}), {status: 200}); };
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const MINE = 'sk-ant-the-users-own-key-0123456789';
const env = (extra = {}) => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek-for-tests', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', READY_NIGHT_MAX_USD: '0.01', WAITLIST: kv(), AI: {run: async () => ({choices: [{message: {content: '{}'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1000, completion_tokens: 100}}), toMarkdown: async () => []},
  fetchFn: model({input_tokens: 1000, output_tokens: 100}), ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-18T02:00:00Z');
const call = (e, method, path, body, headers = {}) => ready(new Request(`https://x/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, now);
async function night(e, ai = {key: MINE}) {
  const made = await (await call(e, 'POST', 'batch', {night: '2026-10-18', readyBy: '07:30', ai, facts: {profile: 'secretprofile Alex', standard: 'secretstandard'},
    jobs: [{id: 'j1', url: 'https://boards.example.com/a/1', title: 'SRE', company: 'Acme', fit: 80, kit: {}}]}, {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')})).json();
  const token = await start(e, made.batch, now);
  return {made, bearer: {authorization: `Bearer ${token}`}};
}
const ask = {model: 'claude-opus-9', max_tokens: 999999, system: 'sys', messages: [{role: 'user', content: 'q'}], output_config: {format: {type: 'json_schema', schema: {}}}, tools: [{name: 'x'}]};

test('the cost of a call is priced like the normal Apply and only a fixed kind of call goes on', () => {
  assert.equal(costMicro({input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000}), 2000 + 1000 + 1000 + 2500);
  const params = clean(ask, {});
  assert.equal(params.model, 'claude-sonnet-5-5');   // the model is the site's, not the container's
  assert.equal(params.max_tokens, 16000);
  assert.ok(!('tools' in params));
  assert.equal(clean({messages: []}, {}), null);
});

test('the facts are sealed at rest and the night token reads them back; a stranger and no key get nothing', async () => {
  const e = env(); const {made, bearer} = await night(e);
  assert.ok(![...e.HOSTED_STATE.m.values()].some(v => new TextDecoder().decode(v).includes('secretprofile')));
  const read = await (await call(e, 'GET', 'batch', undefined, bearer)).json();
  assert.equal(read.facts.profile, 'secretprofile Alex');
  assert.equal(read.facts.search, '');
  assert.equal((await call(e, 'POST', 'ai', ask, {authorization: `Bearer RR1.${made.batch}.wrong`})).status, 401);
  assert.equal((await call(e, 'POST', 'ai', ask, {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')})).status, 401);   // the owner's key is not a night token
  assert.ok(![...e.HOSTED_STATE.m.values()].some(v => new TextDecoder().decode(v).includes(MINE)));   // the user's key is sealed too
  assert.ok(!JSON.stringify(read).includes(MINE));   // and never read back
});

test('a call is forwarded with the site key and fixed model, its cost counts, and the night stops at the cap', async () => {
  sent.length = 0;
  const e = env(); const {bearer} = await night(e);   // cap $0.01; one call = 1000*2 + 100*10 = 3000 micro
  for (let i = 0; i < 3; i++) assert.equal((await call(e, 'POST', 'ai', ask, bearer)).status, 200);
  const forwarded = JSON.parse(sent[0].init.body);
  assert.equal(sent[0].init.headers['x-api-key'], MINE);
  assert.equal(forwarded.model, 'claude-sonnet-5-5');
  assert.equal(e.STATS.db.prepare('SELECT cost_micro, state FROM ready_batches').get().cost_micro, 9000);
  assert.equal((await call(e, 'POST', 'ai', ask, bearer)).status, 200);   // 12000 >= 10000: this one reaches the cap
  const row = e.STATS.db.prepare('SELECT cost_micro, state FROM ready_batches').get();
  assert.equal(row.state, 'capped');
  assert.equal((await call(e, 'POST', 'ai', ask, bearer)).status, 402);   // nothing more once capped
  assert.equal(e.STATS.db.prepare("SELECT usd FROM ai_cost_runs WHERE job = 'ready-fill'").get().usd, 0.012);
});

test('a model error costs nothing and is not passed on in detail', async () => {
  const e = env({fetchFn: async () => new Response('{"error":{"message":"the key invalid"}}', {status: 401})}); const {bearer} = await night(e);
  const response = await call(e, 'POST', 'ai', ask, bearer);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(MINE));
  assert.equal(e.STATS.db.prepare('SELECT cost_micro FROM ready_batches').get().cost_micro, 0);
});

test('without a key of his own the night uses the install\'s Free AI: no product key, Free AI limits stop it and the morning says so', async () => {
  const e = env(); const {bearer} = await night(e, null);
  assert.equal(e.READY_ANTHROPIC_KEY, undefined);
  const ok = await call(e, 'POST', 'ai', ask, bearer);
  assert.equal(ok.status, 200);
  const message = await ok.json();
  assert.ok(message.content && message.usage, JSON.stringify(message));
  assert.equal(sent.length, 0 + sent.length);   // nothing went to api.anthropic.com for this call
  assert.ok(e.STATS.db.prepare('SELECT cost_micro FROM ready_batches').get().cost_micro > 0);
  for (const k of [...e.WAITLIST.m.keys()]) if (k.startsWith('freeai:dusd:')) e.WAITLIST.m.set(k, String(0.5 * 1e6));   // the install's day is used up
  assert.equal((await call(e, 'POST', 'ai', ask, bearer)).status, 402);
  assert.equal(e.STATS.db.prepare('SELECT ai_stopped FROM ready_batches').get().ai_stopped, 1);
  const state = await (await call(e, 'GET', 'state', undefined, {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')})).json();
  assert.equal(state.batch.aiStopped, true);
});

test('his own key that Anthropic refuses (401) also stops the night\'s AI, and a bad key shape is not stored', async () => {
  const e = env({fetchFn: async () => new Response('{}', {status: 401})}); const {bearer} = await night(e);
  assert.equal((await call(e, 'POST', 'ai', ask, bearer)).status, 502);
  assert.equal(e.STATS.db.prepare('SELECT ai_stopped FROM ready_batches').get().ai_stopped, 1);
  const f = env(); const second = await night(f, {key: 'not-a-claude-key'});
  sent.length = 0; assert.equal((await call(f, 'POST', 'ai', ask, second.bearer)).status, 200);   // fell back to Free AI
  assert.equal(sent.length, 0);
});
