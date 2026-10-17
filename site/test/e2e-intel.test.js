// /e2e/data: CI sends each finished e2e run and its red suites once; a red whose cause was "open" is rewritten when the fix lands; one snapshot row, no table scan per page load.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {buildSnapshot} from '../src/e2e-intel.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {db, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const call = (e, init = {}, path = '/e2e/data') => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const run = (runId, conclusion = 'failure', extra = {}) => ({runId, createdAt: '2026-10-17T20:01:00Z', kind: 'beta', conclusion, minutes: 26, ...extra});
const fail = (runId, suite, platform, cause, extra = {}) => ({runId, suite, platform, cause, minutes: 12, day: '2026-10-17', ...extra});
const now = new Date('2026-10-18T12:00:00Z');

test('the publish key is needed; without it the address does not exist', async () => {
  const e = env();
  assert.equal((await put(e, {rules: 1, runs: [], fails: []}, 'wrong')).status, 404);
  assert.equal((await call(e, {method: 'GET'})).status, 404);
});

test('a run and its red suites are stored once; a later cause for the same red replaces "open"', async () => {
  const e = env();
  const first = await put(e, {rules: 1, runs: [run(1)], fails: [fail(1, 'apply', 'mac', 'open'), fail(1, 'apply', 'windows', 'credit')]});
  assert.equal(first.status, 200);
  await put(e, {rules: 1, runs: [run(1)], fails: [fail(1, 'apply', 'mac', 'test'), fail(1, 'apply', 'windows', 'open')]});
  const causes = Object.fromEntries(e.STATS.db.prepare('SELECT platform, cause FROM e2e_fails').all().map(row => [row.platform, row.cause]));
  assert.deepEqual(causes, {mac: 'test', windows: 'credit'}, 'open becomes test; a settled cause is not overwritten by open');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM e2e_runs').get().n, 1);
});

test('GET lists the settled runs and the pending ones (a red still open or unknown)', async () => {
  const e = env();
  await put(e, {rules: 1, runs: [run(1), run(2), run(3, 'success')], fails: [fail(1, 'apply', 'mac', 'test'), fail(2, 'quality', 'mac', 'open'), fail(2, 'quality', 'windows', 'unknown')]});
  const body = await (await call(e, {method: 'GET', headers: {Authorization: 'Bearer pub'}}, '/e2e/data?v=1')).json();
  assert.deepEqual(body.have.sort(), [1, 3]);
  assert.deepEqual(body.pending, [2]);
});

test('bad rows are dropped: an unknown cause, a run without a number, too many rows', async () => {
  const e = env();
  const response = await put(e, {rules: 1, runs: [run(1), {...run(2), runId: 'x'}], fails: [fail(1, 'apply', 'mac', 'because'), fail(1, 'apply', 'mac', 'flake')]});
  assert.equal((await response.json()).stored, 2);
  assert.equal(e.STATS.db.prepare('SELECT cause FROM e2e_fails').all().length, 1);
  assert.equal((await put(e, {rules: 1, runs: Array.from({length: 600}, (_, i) => run(i + 1)), fails: []})).status, 400);
});

test('the snapshot holds the last 30 days per day and per suite, and the page reads one row', async () => {
  const e = env();
  await put(e, {rules: 1, runs: [run(1), run(2, 'success'), run(3, 'failure', {createdAt: '2026-08-01T10:00:00Z'})], fails: [fail(1, 'apply', 'mac', 'test'), fail(1, 'apply', 'windows', 'test'), fail(3, 'old', 'mac', 'flake', {day: '2026-08-01'})]});
  const snapshot = await buildSnapshot(e.STATS, now);
  assert.deepEqual(snapshot.days.map(d => [d.day, d.runs, d.reds, d.greens, d.redMin]), [['2026-10-17', 2, 1, 1, 26]]);
  assert.deepEqual(snapshot.fails.map(f => [f.suite, f.platform, f.cause, f.n]).sort(), [['apply', 'mac', 'test', 1], ['apply', 'windows', 'test', 1]]);
  const stored = e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get();
  assert.equal(JSON.parse(stored.body).schema, snapshot.schema);
});
