// Hosted Always on, the data at rest (src/hosted-state.js): encrypted in R2 per account, only a run token reaches state, the person exports and deletes, nothing readable is stored.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {schedule, startRun} from '../src/hosted.js';
import {config, own, state} from '../src/hosted-state.js';

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
const r2 = () => { const m = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { m.delete(k); }}; };
const env = () => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', HOSTED_KEK: 'kek-for-tests', HOSTED_ALWAYS_ON: 'on'});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-16T10:00:00Z');
const req = (method, body, headers) => new Request('https://x/api/hosted/x', {method, headers, body});
async function setup() {
  const e = env();
  await schedule(new Request('https://x/s', {method: 'PUT', headers: {'x-api-key': await keyOf('install-aaaa1')}, body: JSON.stringify({on: true, email: 'a@example.com'})}), e, now);
  const run = await startRun(e, e.STATS.db.prepare('SELECT * FROM hosted_schedules').get(), now);
  return {e, run, headers: {authorization: `Bearer ${run.token}`}, app: {'x-api-key': await keyOf('install-aaaa1')}};
}

test('state is encrypted in R2, round-trips for the open run, and needs the run token', async () => {
  const {e, headers} = await setup();
  assert.equal((await state(req('GET', undefined, headers), e, now)).status, 404);   // first run: none yet
  const bytes = new TextEncoder().encode('SQLite format 3 secret-profile-words');
  assert.equal((await state(req('PUT', bytes, headers), e, now)).status, 200);
  const stored = [...e.HOSTED_STATE.m.values()][0];
  assert.ok(!new TextDecoder().decode(stored).includes('secret-profile-words'));   // not readable at rest
  assert.deepEqual(new Uint8Array(await (await state(req('GET', undefined, headers), e, now)).arrayBuffer()), bytes);
  assert.equal((await state(req('GET', undefined, {authorization: 'Bearer HR1.x.y'}), e, now)).status, 401);
  assert.equal((await state(req('GET', undefined, headers), e, new Date(now.getTime() + 31 * 60000))).status, 401);   // expired
  assert.equal((await state(req('GET', undefined, headers), {...e, HOSTED_ALWAYS_ON: 'off'}, now)).status, 404);
});

test('another account cannot read it: the key is per account', async () => {
  const {e, headers} = await setup();
  await state(req('PUT', new TextEncoder().encode('mine'), headers), e, now);
  const [key, value] = [...e.HOSTED_STATE.m.entries()][0];
  const other = {...e, HOSTED_STATE: r2()};
  other.HOSTED_STATE.m.set(key.replace(/hosted\/[^/]+\//, 'hosted/acc_other/'), value);
  await assert.rejects(async () => { const { open } = await import('../src/hosted-state.js'); await open(e, 'acc_other', value); });
});

test('the app pushes its config with its install key; the container reads it with the run token', async () => {
  const {e, headers, app} = await setup();
  assert.equal((await config(req('PUT', JSON.stringify({search: {role_keywords: ['sre']}, profile: 'P', cv: 'C'}), app), e, now)).status, 200);
  assert.equal((await config(req('PUT', 'x', app), e, now)).status, 400);
  assert.equal((await config(req('PUT', '{}', {'x-api-key': 'JPF1.nobody1.bad'}), e, now)).status, 401);
  const read = await (await config(req('GET', undefined, headers), e, now)).json();
  assert.deepEqual(read, {search: {role_keywords: ['sre']}, profile: 'P', cv: 'C'});
  assert.equal((await config(req('GET', undefined, app), e, now)).status, 401);   // the install key does not read it back through this route
});

test('export gives the person their data; delete removes objects, schedule, runs and inbox and returns a receipt', async () => {
  const {e, headers, app} = await setup();
  await state(req('PUT', new TextEncoder().encode('db'), headers), e, now);
  await config(req('PUT', JSON.stringify({search: {}, profile: 'P'}), app), e, now);
  e.STATS.db.exec("INSERT INTO hosted_inbox (account, run, job, payload, at) SELECT account, 'r', 'j1', '{\"title\":\"T\"}', '2026-10-16' FROM hosted_schedules");
  const exported = await (await own(req('GET', undefined, app), e)).json();
  assert.equal(exported.inbox[0].title, 'T');
  assert.equal(atob(exported.stateTgzBase64), 'db');
  const gone = await (await own(req('DELETE', undefined, app), e)).json();
  assert.deepEqual(gone.receipt, {objects: 2, inbox: 1, runs: 1, schedules: 1});
  assert.equal(e.HOSTED_STATE.m.size, 0);
  for (const table of ['hosted_schedules', 'hosted_runs', 'hosted_inbox']) assert.equal(e.STATS.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal((await own(req('GET', undefined, {'x-api-key': 'JPF1.nobody1.bad'}), e)).status, 401);
});
