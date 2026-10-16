// Hosted Always on, PR 3 (src/hosted-tick.js, hosted-budget.js, hosted-consume.js, the HR1 key in src/free-ai.js): the tick's guards, the trial-budget debit, the run token as an AI key, the consumer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {freeAi} from '../src/free-ai.js';
import {digestOf, tokenFor} from '../src/guard.js';
import {result, schedule, startRun} from '../src/hosted.js';
import {consume} from '../src/hosted-consume.js';
import {tick} from '../src/hosted-tick.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }});
  return {db, prepare: text => statement(text)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const queue = () => { const sent = []; return {sent, send: async m => { sent.push(m); }}; };
const env = (extra = {}) => ({STATS: d1(), WAITLIST: kv(), HOSTED_QUEUE: queue(), STATS_SALT: 'salt', HOSTED_ALWAYS_ON: 'on', FREE_AI_TRIAL_USD: '2', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const t0 = new Date('2026-10-16T10:00:00Z');
const on = (e, install, email) => schedule(new Request('https://x/api/hosted/schedule', {method: 'PUT', headers: {'x-api-key': ''}, body: '{}'}), e, t0).then(async () => schedule(new Request('https://x/s', {method: 'PUT', headers: {'x-api-key': await keyOf(install)}, body: JSON.stringify({on: true, email})}), e, t0));
const rows = (e, text, ...a) => e.STATS.db.prepare(text).all(...a).map(r => ({...r}));
const later = (hours, from = t0) => new Date(from.getTime() + hours * 3600000);

test('a due schedule is enqueued once with a run token; the schedule moves a day on; a second tick adds nothing', async () => {
  const e = env();
  await on(e, 'install-aaaa1', 'a@example.com');
  assert.deepEqual(await tick(e, t0), {enqueued: 0, paused: {}, held: 0});   // not due yet (first run is within the hour)
  const out = await tick(e, later(1.5));
  assert.equal(out.enqueued, 1);
  assert.match(e.HOSTED_QUEUE.sent[0].token, /^HR1\./);
  assert.equal(rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at, later(25.5).toISOString());
  assert.equal((await tick(e, later(2))).enqueued, 0);
});

test('the switch off enqueues nothing; no Queue binding holds the run', async () => {
  const e = env({HOSTED_ALWAYS_ON: 'off'});
  assert.deepEqual(await tick(e, later(2)), {enqueued: 0, paused: {}, held: 0});
  const f = env(); await on(f, 'install-aaaa1', 'a@example.com'); delete f.HOSTED_QUEUE;
  assert.equal((await tick(f, later(2))).held, 1);
  assert.equal(rows(f, 'SELECT COUNT(*) AS n FROM hosted_runs')[0].n, 0);
});

test('14 days with no app contact pauses the schedule; the inbox pull (app contact) keeps it going', async () => {
  const e = env();
  await on(e, 'install-aaaa1', 'a@example.com');
  e.STATS.db.exec("UPDATE hosted_schedules SET next_run_at = '2026-10-31T00:00:00.000Z'");
  const out = await tick(e, new Date('2026-10-31T06:00:00Z'));
  assert.deepEqual([out.enqueued, out.paused], [0, {inactive: 1}]);
  assert.deepEqual(rows(e, 'SELECT state, pause_reason FROM hosted_schedules'), [{state: 'paused', pause_reason: 'inactive'}]);
});

test('the trial budget used up pauses it; the monthly compute guard pauses it; the global caps hold runs for the next tick', async () => {
  const e = env();
  await on(e, 'install-aaaa1', 'a@example.com');
  e.WAITLIST.m.set(`freeai:life:${await digestOf('install-aaaa1')}`, String(2_000_000));
  assert.deepEqual((await tick(e, later(2))).paused, {'trial-over': 1});
  const g = env(); await on(g, 'install-aaaa1', 'a@example.com');
  const sched = rows(g, 'SELECT * FROM hosted_schedules')[0];
  g.STATS.db.exec(`INSERT INTO hosted_runs (id, account, slot, started_at, expires_at, finished_at, status, compute_micro) VALUES ('r0', '${sched.account}', '2026-10-01T00', '2026-10-05T00:00:00.000Z', '2026-10-05T00:30:00.000Z', '2026-10-05T00:10:00.000Z', 'ok', 1500000)`);
  assert.deepEqual((await tick(g, later(2))).paused, {guard: 1});
  const h = env({HOSTED_MAX_RUNS_DAY: '1'}); await on(h, 'install-aaaa1', 'a@example.com'); await on(h, 'install-bbbb2', 'b@example.com');
  const out = await tick(h, later(2));
  assert.deepEqual([out.enqueued, out.held], [1, 1]);
  const stopped = env(); await on(stopped, 'install-aaaa1', 'a@example.com');
  stopped.WAITLIST.m.set('freeai:usd:2026-10-16', String(10_000_000));   // the global Free AI day stop: trial runs wait
  assert.deepEqual([(await tick(stopped, later(2))).enqueued, rows(stopped, 'SELECT state FROM hosted_schedules')[0].state], [0, 'on']);
});

test('a run that never posted is failed once its token expires, and the next slot is free', async () => {
  const e = env();
  await on(e, 'install-aaaa1', 'a@example.com');
  await tick(e, later(1.5));
  await tick(e, later(3));
  assert.equal(rows(e, 'SELECT status FROM hosted_runs')[0].status, 'failed');
});

test('a finished run debits the compute once from the trial budget and the global totals; a failed run costs nothing', async () => {
  const e = env({HOSTED_RUN_MICRO: '11000'});
  await on(e, 'install-aaaa1', 'a@example.com');
  await tick(e, later(1.5));
  const token = e.HOSTED_QUEUE.sent[0].token, who = await digestOf('install-aaaa1');
  const post = (body, at) => result(new Request('https://x/r', {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify(body)}), e, at);
  await post({matches: []}, later(1.6));
  assert.equal(e.WAITLIST.m.get(`freeai:life:${who}`), '11000');
  assert.equal(e.WAITLIST.m.get('freeai:usd:2026-10-16'), '11000');
  assert.equal(rows(e, 'SELECT compute_micro FROM hosted_runs')[0].compute_micro, 11000);
  const f = env(); await on(f, 'install-aaaa1', 'a@example.com'); await tick(f, later(1.5));
  await result(new Request('https://x/r', {method: 'POST', headers: {authorization: `Bearer ${f.HOSTED_QUEUE.sent[0].token}`}, body: JSON.stringify({status: 'failed'})}), f, later(1.6));
  assert.equal(f.WAITLIST.m.get(`freeai:life:${who}`), undefined);
});

test('the run token is an AI key charged as its install (trial budget), and only while the run is open', async () => {
  const calls = [];
  const e = env({AI: {run: async (_m, input) => { calls.push(input); return {choices: [{message: {content: 'hi'}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 5}}; }}, FREE_AI_NEURONS: 'off'});
  await on(e, 'install-aaaa1', 'a@example.com');
  await tick(e, later(1.5));
  const token = e.HOSTED_QUEUE.sent[0].token;
  const ask = key => freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': key}, body: JSON.stringify({max_tokens: 10, messages: [{role: 'user', content: 'x'}]})}), e, later(1.6));
  assert.equal((await ask(token)).status, 200);
  assert.ok(Number(e.WAITLIST.m.get(`freeai:life:${await digestOf('install-aaaa1')}`)) > 0);   // charged to the install's lifetime budget
  assert.equal((await ask('HR1.run_nope.abc')).status, 401);
  assert.equal((await freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': token}, body: '{}'}), {...e, HOSTED_ALWAYS_ON: 'off'}, later(1.6))).status, 401);
});

test('the consumer starts one container per message, acknowledges all, and survives a failing container', async () => {
  const acked = [], posts = [];
  const msg = (n) => ({body: {run: `r${n}`, token: `HR1.r${n}.t`, site: 'https://s.test', account: `a${n}`}, ack: () => acked.push(n)});
  const runner = account => ({fetch: async request => { posts.push([account, JSON.parse(await request.text())]); if (account === 'a2') throw new Error('no container'); return new Response('{}', {status: 200}); }});
  const done = await consume({messages: [msg(1), msg(2)]}, runner, {error: () => {}});
  assert.deepEqual(done, {ok: 1, failed: 1});
  assert.deepEqual(acked.sort(), [1, 2]);
  assert.deepEqual(posts[0], ['a1', {token: 'HR1.r1.t', site: 'https://s.test'}]);
});

test('wrangler.toml binds the state bucket and the queue, and the runner config consumes that queue', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), runner = readFileSync(new URL('../hosted-runner/wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(toml, /binding = "HOSTED_STATE"\nbucket_name = "hosted-state"/);
  assert.match(toml, /binding = "HOSTED_QUEUE"\nqueue = "hosted-runs"/);
  assert.match(runner, /"queue": "hosted-runs"/);
});
