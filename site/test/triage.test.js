// Recurring problems wait for the private triage to pull them (src/triage.js); the push into GitHub is gone for them.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {dispatch} from '../src/index.js';
import {queue, queued, triage} from '../src/triage.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0007_triage.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'secret'});
const call = (e, method, body) => triage(new Request('https://x/api/triage', {method, headers: {Authorization: 'Bearer secret'}, body: body ? JSON.stringify(body) : undefined}), e, new Date('2026-10-02T12:00:00Z'));

test('the report and problem workflows are queued, not pushed to GitHub; others still go to GitHub', async () => {
  const e = env();
  assert.deepEqual([queued('fill-failure-intake.yml'), queued('telemetry-triage.yml'), queued('product-brain.yml')], [true, true, false]);
  await dispatch(e, {report: '{"site":"x"}', trusted: 'false'}, 'fill-failure-intake.yml');
  await dispatch(e, {problems: '[]'}, 'telemetry-triage.yml');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM triage_queue').get().n, 2);
  const calls = [];
  await dispatch({...e, GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't'}, {x: '1'}, 'product-brain.yml', async url => { calls.push(url); return {status: 204}; });
  assert.match(calls[0], /api\.github\.com\/repos\/o\/r\/actions\/workflows\/product-brain\.yml/);
});

test('only the owner reads the queue; items are taken once and old taken ones are dropped', async () => {
  const e = env();
  await queue(e, {problems: '[1]'}, 'telemetry-triage.yml');
  await queue(e, {report: '{}'}, 'fill-failure-intake.yml');
  assert.equal((await triage(new Request('https://x/api/triage'), e)).status, 404);
  const items = (await (await call(e, 'GET')).json()).items;
  assert.deepEqual(items.map(i => [i.kind, Object.keys(i.payload)[0]]), [['problems', 'problems'], ['report', 'report']]);
  assert.deepEqual(await (await call(e, 'POST', {ids: [items[0].id, 999, 'x']})).json(), {ok: true, taken: 2});   // an unknown id changes nothing
  assert.deepEqual((await (await call(e, 'GET')).json()).items.map(i => i.kind), ['report']);
  e.STATS.db.prepare("UPDATE triage_queue SET taken_at = '2026-08-01T00:00:00Z' WHERE kind = 'problems'").run();
  await call(e, 'POST', {ids: []});
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM triage_queue WHERE kind = 'problems'").get().n, 0);
  await assert.rejects(queue(e, {}, 'something-else.yml'), /nothing to queue/);
});
