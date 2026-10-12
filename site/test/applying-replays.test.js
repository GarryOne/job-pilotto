// /admin/applying's Fixed-site replays come from CI on main only (src/applying-replays.js): one PUT per merge (Bearer REPLAYS_PUBLISH_KEY) with the build's sha,
// stored as ONE row (the D1 free plan: 11 Oct 2026), the last 10 runs. A local upload of kind 'recorded' is refused: it showed work-in-progress branches as "failed".
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {replaysIngest} from '../src/applying-replays.js';

function d1() {
  const db = new DatabaseSync(':memory:'), log = {read: 0, written: 0};
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values),
    run: async () => { const done = db.prepare(sql).run(...args); log.written += Number(done.changes); return done; },
    all: async () => { const results = db.prepare(sql).all(...args); log.read += results.length; return {results}; },
    first: async () => { const row = db.prepare(sql).get(...args); log.read += row ? 1 : 0; return row; }});
  return {db, log, prepare: sql => statement(sql)};
}
const KEY = 'k'.repeat(64);
const put = (db, body, {key = KEY, envKey = KEY, at = '2026-10-12T10:00:00Z'} = {}) => replaysIngest(new Request('https://x.test/applying/replays', {method: 'PUT',
  headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}), {STATS: db, REPLAYS_PUBLISH_KEY: envKey}, new Date(at));
const names = Array.from({length: 54}, (_, at) => `case-${String(at).padStart(2, '0')}`);
const run = (sha, failing = [], extra = {}) => ({sha, version: '0.9.200', rows: names.map(name => ({name, ok: !failing.includes(name), rung: 2, note: failing.includes(name) ? `${name} stopped` : ''})), ...extra});

test('only the publish key writes; without the Worker secret every PUT is a 404', async () => {
  const db = d1();
  assert.equal((await put(db, run('abc1234'), {key: 'wrong'})).status, 404);
  assert.equal((await put(db, run('abc1234'), {envKey: ''})).status, 404);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM applying_replays').get().n, 0);
  assert.equal((await put(db, run('abc1234'))).status, 200);
});

test('one merge of 54 cases is ONE row written; the same sha again with the same results writes nothing', async () => {
  const db = d1();
  db.log.written = 0;
  assert.deepEqual(await (await put(db, run('abc1234'))).json(), {ok: true, stored: 54});
  assert.equal(db.log.written, 1, 'one batched row per merge');
  db.log.written = 0;
  await put(db, run('abc1234'));
  assert.equal(db.log.written, 0, 'unchanged: nothing written');
});

test('a bad sha, a name with an address, and no rows are refused or dropped', async () => {
  const db = d1();
  assert.equal((await put(db, run('not-a-sha'))).status, 400);
  assert.equal((await put(db, {sha: 'abc1234', rows: []})).status, 400);
  const answer = await (await put(db, {sha: 'abc1234', rows: [{name: 'https://jobs.example.com/1?x=y', ok: true}, {name: 'fine-case', ok: true}]})).json();
  assert.equal(answer.stored, 1);
});

test('the page shows CI on main only: sha and time per case, the last 10 runs, since when, and a case no longer on main is gone', async () => {
  const db = d1();
  for (let at = 0; at < 12; at++) await put(db, run(`aaaa${String(at).padStart(3, '0')}`, at >= 9 ? ['case-03'] : []), {at: `2026-10-12T${String(at + 8).padStart(2, '0')}:00:00Z`});
  await put(db, {...run('bbbb999', ['case-03']), rows: run('bbbb999', ['case-03']).rows.filter(row => row.name !== 'case-53')}, {at: '2026-10-12T21:00:00Z'});
  const {cases, tiles} = await data(db, new Date('2026-10-12T22:00:00Z'));
  assert.equal(cases.length, 53, 'case-53 left main');
  const bad = cases.find(item => item.name === 'case-03'), good = cases.find(item => item.name === 'case-00');
  assert.deepEqual({ok: bad.ok, sha: bad.sha, at: bad.at, note: bad.note}, {ok: false, sha: 'bbbb999', at: '2026-10-12T21:00:00.000Z', note: 'case-03 stopped'});
  assert.deepEqual(bad.history, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0], 'the last 10 runs, oldest first');
  assert.deepEqual(bad.since, {sha: 'aaaa009', at: '2026-10-12T17:00:00.000Z'});
  assert.equal(good.history.length, 10);
  assert.deepEqual({cases: tiles.cases, casesFailing: tiles.casesFailing}, {cases: 53, casesFailing: 1});
  assert.match(PAGE, /c\.sha/, 'the table shows each row\'s sha');
});

test('a local upload of recorded results is refused: the table is CI on main only', async () => {
  const db = d1();
  const answer = await ingest(db, {kind: 'recorded', day: '2026-10-12', rows: [{name: 'case-00', ok: false}]}, new Date('2026-10-12T10:00:00Z'));
  assert.equal(answer.ok, false);
  assert.match(answer.error, /CI on main/);
  assert.equal((await data(db, new Date('2026-10-12T10:00:00Z'))).cases.length, 0);
});

test('a page load reads one replays row', async () => {
  const db = d1();
  await put(db, run('abc1234'));
  db.log.read = 0;
  const {readReplays} = await import('../src/applying-replays.js');
  await readReplays(db);
  assert.equal(db.log.read, 1);
});
