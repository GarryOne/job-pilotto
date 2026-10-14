// A CI recording run's rows reach the pool table (src/applying-ci-rows.js): the narrow key, main only, the same ingest as the Mac's uploads.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {ciRowsIngest} from '../src/applying-ci-rows.js';
import {latestRuns} from '../src/applying-store.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-14T20:00:00Z');
const rows = [{name: 'A row', host: 'jobs.example.test', reached: 'none', filled: 0, left: 0, note: 'site refused', ending: 'site-refused'}];

test('a run on main moves the row, as main\'s; the key is narrow; a branch\'s run never reaches the page', async () => {
  const STATS = d1(), env = {STATS, REPLAYS_PUBLISH_KEY: 'k'};
  const put = (body, key = 'k') => ciRowsIngest(new Request('https://w.dev/applying/ci-rows', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), env, now);
  assert.equal((await put({branch: 'main', day: '2026-10-14', rows}, 'wrong')).status, 404);
  const refused = await put({branch: 'fix-upload', day: '2026-10-14', rows});
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /only a run on main/);
  assert.equal((await latestRuns(STATS)).length, 0, 'nothing stored for a branch');
  const sent = await put({branch: 'main', day: '2026-10-14', version: '0.7.0', rows});
  assert.deepEqual(await sent.json(), {ok: true, stored: 1});
  const [run] = await latestRuns(STATS);
  assert.deepEqual([run.name, run.kind, run.on_main, run.reached], ['A row', 'smoke', 1, 'none']);
});
