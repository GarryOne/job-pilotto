// Honest pool labels (owner, 15 Oct 2026): a hold, a CI block or an old mark is never a failure, and every view reads the one judgement of the row's newest run.
// One loop over the cases: the page's data() (pool row, tiles, Needs a fix) and the CI upload. Guards: applying-status.js, applying-ci-rows.js, applying.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {data, ingest} from '../src/applying.js';
import {ciRowsIngest} from '../src/applying-ci-rows.js';
import {CI_BLOCKED} from '../src/applying-status.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-15T12:00:00Z');
const day = '2026-10-15';

// name, the run, what the row must read: its state, whether it is a regression, and whether the Needs a fix list holds it.
const CASES = [
  ['Closed posting', {reached: 'posting', note: 'posting closed: held'}, 'held', false, false],
  ['Apply by e-mail', {reached: 'posting', note: 'applies by email: told'}, 'held', false, false],
  ['CI blocked', {reached: 'posting', note: CI_BLOCKED}, 'site', false, false],
  ['Explained fields, old mark', {reached: 'form', filled: 5, left: 4, asked: 5, unexplained: 0, regression: true}, 'works', false, false],
  ['Still a fix, mark stays', {reached: 'form', filled: 5, left: 4, asked: 5, unexplained: 1, regression: true}, 'fix', true, true],
  ['Stopped early', {reached: 'posting', rung: 2, signal: 'failed'}, 'fix', false, true],
];

test('each row reads one judgement in the pool row, the tiles and Needs a fix: holds and CI blocks are no failure, a mark clears with the fix', async () => {
  const db = d1();
  await ingest(db, {kind: 'pool', day, rows: CASES.map(([name]) => ({name, start_host: 'x.example'}))}, now);
  for (const [name, run] of CASES) await ingest(db, {kind: 'smoke', day, rows: [{name, host: 'x.example', ...run}]}, now);
  const json = JSON.parse(JSON.stringify(await data(db, now))), by = Object.fromEntries(json.pool.map(row => [row.shape, row]));
  for (const [name, , state, regression, listed] of CASES) {
    assert.equal(by[name].status.state, state, name + ' state');
    assert.equal(by[name].regression, regression, name + ' regression mark');
    assert.equal(json.sites.find(site => site.name === name).regression, regression, name + ' regression mark on the run list');
    assert.equal(by[name].status.state === 'fix', listed, name + ' on Needs a fix');
  }
  const ci = by['CI blocked'].status;
  assert.deepEqual([ci.rule, ci.next], ['blocked in CI (data-centre IP)', 'needs a Mac recording']);
  const failing = CASES.filter(row => row[4]).length;
  assert.equal(json.tiles.needFix, failing, 'the tile counts the Needs a fix list');
  assert.equal(json.tiles.regressions, CASES.filter(row => row[3]).length, 'the regression tile counts marks of rows still a fix');
  assert.equal(json.tiles.gone, 1, 'a CI block is a site problem, never a fix');
});

test('a closed posting is not a live site: it stays out of the reached-the-form share', async () => {
  const db = d1();
  await ingest(db, {kind: 'smoke', day, rows: [{name: 'Closed', host: 'x.example', reached: 'posting', note: 'posting closed: held'}, {name: 'Works', host: 'y.example', reached: 'form', filled: 3, left: 0}]}, now);
  assert.equal((await data(db, now)).tiles.reachedForm, 100);
});

test('a refusal the CI upload sends is stored as "blocked in CI"; the same refusal from a Mac upload keeps its word', async () => {
  const STATS = d1(), env = {STATS, REPLAYS_PUBLISH_KEY: 'k'};
  const row = name => ({name, host: 'x.example', reached: 'posting', note: 'site refused: retry later'});
  const response = await ciRowsIngest(new Request('https://w.dev/applying/ci-rows', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify({branch: 'main', day, rows: [row('From CI')]})}), env, now);
  assert.equal(response.status, 200);
  await ingest(STATS, {kind: 'smoke', day, rows: [row('From Mac')]}, now);
  const by = Object.fromEntries((await data(STATS, now)).pool.map(item => [item.shape, item.status]));
  assert.deepEqual([by['From CI'].rule, by['From Mac'].rule], ['blocked in CI (data-centre IP)', 'site refused']);
});
