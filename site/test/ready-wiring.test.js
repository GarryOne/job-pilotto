// Ready to send, the wiring (src/ready-tick.js, ready-morning.js, ready-consume.js): the cron starts a due night once, finishes an over-time one, the owner's morning calls reach the runner with the night token, and nothing is reachable by anyone else.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {ready, readyToken} from '../src/ready.js';
import {consume} from '../src/ready-consume.js';
import {tick} from '../src/ready-tick.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }, text, args});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const r2 = () => { const m = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { m.delete(k); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key}))})}; };
const env = (extra = {}) => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek-for-tests', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const evening = new Date('2026-10-17T21:00:00Z');
const call = async (e, method, path, body, headers = {}, at = evening) => ready(new Request(`https://x/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, at);
const owner = async () => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')});
const batchBody = fillAt => ({night: '2026-10-18', readyBy: '07:30', ...(fillAt ? {fillAt} : {}), contact: {name: 'Alex Example', email: 'alex@example.invalid'},
  jobs: [{id: 'j1', url: 'https://boards.example.com/acme/jobs/1', title: 'SRE', company: 'Acme', fit: 80, kit: {}, letter: '', cv: ''}]});
const queue = () => { const sent = []; return {sent, send: async m => { sent.push(m); }}; };
const runner = () => { const seen = []; return {seen, fetch: async request => { seen.push(request.url); return new Response('{"ok":true}', {status: 200}); }}; };

test('the tick starts a due night once, with its token, and not before its fill time or without the Queue', async () => {
  const e = env({READY_QUEUE: queue()});
  const made = await (await call(e, 'POST', 'batch', batchBody('2026-10-18T01:00:00Z'), await owner())).json();
  assert.deepEqual(await tick(e, new Date('2026-10-18T00:30:00Z')), {started: 0, finished: 0});   // not yet
  assert.deepEqual(await tick(e, new Date('2026-10-18T01:05:00Z')), {started: 1, finished: 0});
  assert.deepEqual(await tick(e, new Date('2026-10-18T01:10:00Z')), {started: 0, finished: 0});   // once
  const [message] = e.READY_QUEUE.sent;
  assert.equal(message.batch, made.batch);
  assert.equal(message.token, await readyToken(e, made.batch));
  const noQueue = env();
  await call(noQueue, 'POST', 'batch', batchBody(), await owner());
  assert.equal((await tick(noQueue, new Date('2026-10-18T01:05:00Z'))).started, 0);
  assert.equal(noQueue.STATS.db.prepare("SELECT state FROM ready_batches").get().state, 'queued');
  assert.deepEqual(await tick(env({READY_TO_SEND: 'off', READY_QUEUE: queue()}), new Date('2026-10-18T01:05:00Z')), {started: 0, finished: 0});
});

test('a night past its end is finished: unfilled jobs fail with timeout and its tabs are closed', async () => {
  const runnerFake = runner();
  const e = env({READY_QUEUE: queue(), READY_RUNNER: runnerFake});
  const made = await (await call(e, 'POST', 'batch', batchBody(), await owner())).json();
  await tick(e, new Date('2026-10-18T01:05:00Z'));
  const expires = e.STATS.db.prepare('SELECT expires_at FROM ready_batches').get().expires_at;
  const out = await tick(e, new Date(new Date(expires).getTime() + 60000));
  assert.equal(out.finished, 1);
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches').get().state, 'finished');
  const job = e.STATS.db.prepare('SELECT state, wall FROM ready_jobs').get();
  assert.deepEqual({...job}, {state: 'failed', wall: 'timeout'});
  assert.ok(runnerFake.seen.some(url => url.startsWith(`https://runner/close?batch=${made.batch}`)));
});

test('the morning routes: owner only, 503 while the runner is not wired, the right path and token when it is', async () => {
  const wired = env({READY_QUEUE: queue(), READY_RUNNER: runner()});
  const made = await (await call(wired, 'POST', 'batch', batchBody(), await owner())).json();
  await tick(wired, new Date('2026-10-18T01:05:00Z'));
  const stranger = {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')};
  for (const sub of ['live', 'handoff', 'held']) {
    assert.equal((await call(wired, 'GET', `${sub}?job=j1`, undefined, stranger)).status, 401, `${sub} stranger`);
    assert.equal((await call(wired, 'GET', `${sub}?job=j1`)).status, 401, `${sub} anonymous`);
    const response = await call(wired, 'GET', `${sub}?job=j1`, undefined, await owner());
    assert.equal(response.status, 200, sub);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const urls = wired.READY_RUNNER.seen;
  assert.ok(urls.some(url => url.startsWith(`https://runner/handoff?batch=${made.batch}&t=${encodeURIComponent(`RR1.${made.batch}.`)}`) && url.endsWith('&job=j1')), urls.join('\n'));
  const unwired = env({READY_QUEUE: queue()});
  await call(unwired, 'POST', 'batch', batchBody(), await owner());
  await tick(unwired, new Date('2026-10-18T01:05:00Z'));
  for (const sub of ['live', 'handoff', 'held']) assert.equal((await call(unwired, 'GET', `${sub}?job=j1`, undefined, await owner())).status, 503, sub);
});

test('the consumer starts each night once and always acknowledges, even when the container fails', async () => {
  const acked = [];
  const batch = {messages: [{body: {batch: 'a', token: 't', site: 's'}, ack: () => acked.push('a')}, {body: {batch: 'b', token: 't', site: 's'}, ack: () => acked.push('b')}]};
  const bodies = [];
  const done = await consume(batch, night => ({fetch: async request => { bodies.push(await request.text()); if (night === 'b') throw new Error('no container'); return new Response('{}', {status: 202}); }}), {error: () => {}});
  assert.deepEqual(done, {ok: 1, failed: 1});
  assert.deepEqual(acked.sort(), ['a', 'b']);
  assert.deepEqual(JSON.parse(bodies[0]), {token: 't', site: 's'});
});

test('the owner runs a queued night by hand: owner only, once, and only with the Queue', async () => {
  const e = env({READY_QUEUE: queue()});
  const stranger = {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')};
  assert.equal((await call(e, 'POST', 'run', undefined, stranger)).status, 401);
  assert.equal((await call(e, 'POST', 'run', undefined, await owner())).status, 404);   // nothing queued
  const made = await (await call(e, 'POST', 'batch', batchBody('2099-01-01T00:00:00Z'), await owner())).json();   // its fill time is far away
  assert.equal((await call(e, 'GET', 'run', undefined, await owner())).status, 405);
  assert.equal((await call(e, 'POST', 'run', undefined, await owner())).status, 202);
  assert.equal(e.READY_QUEUE.sent[0].batch, made.batch);
  assert.equal((await call(e, 'POST', 'run', undefined, await owner())).status, 404);   // started: not queued any more
  const unwired = env();
  await call(unwired, 'POST', 'batch', batchBody(), await owner());
  assert.equal((await call(unwired, 'POST', 'run', undefined, await owner())).status, 503);
});

test('the site config binds the Queue and the runner Worker the code expects, and the runner consumes that Queue', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /binding = "READY_QUEUE"\s+queue = "ready-runs"/);
  assert.match(config, /binding = "READY_RUNNER"\s+service = "www-ready-runner"/);
  const runner = readFileSync(new URL('../ready-runner/wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(runner, /"name": "www-ready-runner"/);
  assert.match(runner, /"queue": "ready-runs"/);
});

// 18 Oct 2026, the owner's app after #1429: "still Ready to send is not on for this install." A deploy dropped the held tabs; the site's call woke a fresh container
// (still the old image while the runner's release ran), whose night-token check answered 401, passed through as the owner's own refusal. The owner was already checked here:
// any way the container says it does not hold this night or tab is "gone" (410), whatever image it runs.
test('the container not holding the night or the tab reads as gone (410), never as a refused owner', async () => {
  for (const [status, body] of [[401, {ok: false, error: 'unauthorized'}], [404, {ok: false, error: 'not held'}], [410, {ok: false, error: 'gone: this container holds no night'}]]) {
    const refusing = {seen: [], fetch: async request => { refusing.seen.push(request.url); return new Response(JSON.stringify(body), {status}); }};
    const e = env({READY_QUEUE: queue(), READY_RUNNER: refusing});
    await call(e, 'POST', 'batch', batchBody(), await owner());
    await tick(e, new Date('2026-10-18T01:05:00Z'));
    for (const sub of ['handoff', 'held']) {
      const response = await call(e, 'GET', `${sub}?job=j1`, undefined, await owner());
      assert.equal(response.status, 410, `${sub} after the container's ${status}`);
      assert.match((await response.json()).error, /no longer holds/);
    }
  }
  const failing = {fetch: async () => new Response('{"ok":false,"error":"boom"}', {status: 500})};
  const e = env({READY_QUEUE: queue(), READY_RUNNER: failing});
  await call(e, 'POST', 'batch', batchBody(), await owner());
  await tick(e, new Date('2026-10-18T01:05:00Z'));
  assert.equal((await call(e, 'GET', 'handoff?job=j1', undefined, await owner())).status, 500, 'a real failure stays a failure');
});

test('Fill now: a night sent for later starts at the press, not at its fill time; /state says why it waits before that and after a silent start (19 Oct 2026)', async () => {
  const e = env({READY_QUEUE: queue()});
  const state = async at => (await (await call(e, 'GET', 'state', undefined, await owner(), at)).json()).batch;
  await call(e, 'POST', 'batch', batchBody('2026-10-18T01:00:00Z'), await owner());   // the auto-send: tonight's fill time is hours away
  assert.equal(await tick(e, evening).then(out => out.started), 0, 'the cron waits for the fill time');
  assert.deepEqual(await state(evening).then(batch => [batch.state, batch.why.kind, batch.why.at]), ['queued', 'later', '2026-10-18T01:00:00.000Z']);
  const started = await call(e, 'POST', 'run', {}, await owner());   // the press: within this one call, not a tick
  assert.equal(started.status, 202);
  assert.equal(e.READY_QUEUE.sent.length, 1);
  assert.equal((await state(evening)).why.kind, 'starting');
  assert.equal((await state(new Date(evening.getTime() + 10 * 60000))).why.kind, 'silent');   // told 10 minutes ago, no form reported
  e.STATS.db.prepare("UPDATE ready_jobs SET state = 'filling', step = 'form', started_at = ?").run(evening.toISOString());
  assert.equal((await state(new Date(evening.getTime() + 10 * 60000))).why, null);   // the first form is working: the rest take turns
});

test('a Queue that refuses the message puts the night back to queued, for the press and for the cron, so it never sits "running" with nothing to start it (19 Oct 2026)', async () => {
  let fail = true;
  const sent = [], flaky = {send: async message => { if (fail) throw new Error('queue down'); sent.push(message); }};
  const e = env({READY_QUEUE: flaky});
  await call(e, 'POST', 'batch', batchBody('2026-10-18T01:00:00Z'), await owner());
  const state = () => e.STATS.db.prepare('SELECT state, expires_at FROM ready_batches').get();
  const press = await call(e, 'POST', 'run', {}, await owner());
  assert.equal(press.status, 502);
  assert.deepEqual({...state()}, {state: 'queued', expires_at: null});
  assert.equal((await tick(e, new Date('2026-10-18T01:05:00Z'))).started, 0);   // the cron's try fails the same way and leaves it queued
  assert.equal(state().state, 'queued');
  fail = false;
  assert.equal((await tick(e, new Date('2026-10-18T01:10:00Z'))).started, 1);   // the next tick starts it
  assert.equal(state().state, 'running');
  assert.equal(sent.length, 1);
});
