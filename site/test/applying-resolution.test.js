// The Resolution tile of /admin/applying (src/applying-resolution.js; the outcome contract, spec docs/superpowers/specs/2026-10-12-one-next-move.md phase 1a): each pool row's newest
// ending (the owner's Mac uploads and CI's runs on main), the share resolved raw and weighted by real demand with its sample per platform, the rows held by the test apart, the
// unresolved rows first, and a weekly trend. CI's endings arrive with the narrow key, in one write.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {endingsIngest, readEndings, resolution, storeEndings} from '../src/applying-resolution.js';
import {ingest} from '../src/applying.js';
import {latestRuns} from '../src/applying-store.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T20:00:00Z');
const record = (row, ending, extra = {}) => ({row, ending, run: '42', branch: 'main', sha: 'abcdef1', at: '2026-10-12T18:00:00.000Z', ...extra});

test('CI\'s endings are stored in one row with the narrow key; fixed words only; a re-sent run adds nothing; a wrong key is a 404', async () => {
  const STATS = d1(), env = {STATS, REPLAYS_PUBLISH_KEY: 'k'};
  const put = (body, key = 'k') => endingsIngest(new Request('https://w.dev/applying/endings', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), env, now);
  assert.equal((await put({records: [record('A', 'unresolved')]}, 'wrong')).status, 404);
  assert.deepEqual(await (await put({records: [record('A', 'unresolved'), record('B', 'held'), record('C', 'Send your CV to jane@x.example'), record('https://x.example/a', 'ready')]})).json(), {ok: true, stored: 2});
  assert.deepEqual(await (await put({records: [record('A', 'unresolved')]})).json(), {ok: true, stored: 0});
  assert.deepEqual((await readEndings(STATS)).map(item => [item.row, item.ending, item.branch]), [['A', 'unresolved', 'main'], ['B', 'held', 'main']]);
  assert.equal(STATS.db.prepare('SELECT COUNT(*) AS n FROM applying_endings').get().n, 1, 'one row: one write per upload');
  assert.deepEqual(await storeEndings(STATS, {records: []}, now), {ok: false, error: 'records are required'});
});

test('a Mac run counts only when the extension it ran is main\'s: a branch\'s run, or an older upload that does not say, stays out of the tile', async () => {
  const STATS = d1();
  await ingest(STATS, {kind: 'smoke', day: '2026-10-12', onMain: true, rows: [{name: 'Main row', reached: 'ready', ending: 'ready'}]}, now);
  await ingest(STATS, {kind: 'smoke', day: '2026-10-12', onMain: false, rows: [{name: 'Branch row', reached: 'form', ending: 'unresolved'}]}, now);
  await ingest(STATS, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Old row', reached: 'form', ending: 'unresolved'}]}, now);
  const runs = await latestRuns(STATS);
  assert.deepEqual(runs.map(run => [run.name, run.on_main]).sort(), [['Branch row', 0], ['Main row', 1], ['Old row', 0]]);
  const pool = ['Main row', 'Branch row', 'Old row'].map(shape => ({shape, platform: 'Custom'}));
  const r = resolution({runs, pool, now});
  assert.deepEqual([r.measured, r.resolved, r.unresolved.length], [1, 1, 0], 'only the main build\'s run is measured');
  assert.equal(resolution({runs: [{kind: 'smoke', name: 'Old row', at: '2026-10-11T10:00:00Z', ending: 'ready'}], pool, now}).measured, 0, 'a run with no on_main (before migration 0061) is not main\'s');
});

test('the Mac\'s upload carries each row\'s ending into its run; a word outside the list is dropped', async () => {
  const STATS = d1();
  await ingest(STATS, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'A', reached: 'form', ending: 'data_missing'}, {name: 'B', reached: 'form', ending: 'Send your CV'}]}, now);
  const runs = await latestRuns(STATS);
  assert.deepEqual(runs.map(run => [run.name, run.ending]), [['A', 'data_missing'], ['B', null]]);
});

test('each pool row\'s newest ending, Mac or CI on main; resolution raw and weighted by real demand with its rows per platform; held apart; unresolved first', () => {
  const pool = [{shape: 'Lever row', platform: 'Lever'}, {shape: 'Greenhouse row', platform: 'Greenhouse'}, {shape: 'Greenhouse two', platform: 'Greenhouse'}, {shape: 'Account row', platform: 'Workday'}, {shape: 'Custom row', platform: 'Custom'}];
  const runs = [{kind: 'smoke', name: 'Lever row', day: '2026-10-10', at: '2026-10-10T10:00:00Z', ending: 'unresolved', on_main: 1}, {kind: 'smoke', name: 'Account row', day: '2026-10-11', at: '2026-10-11T10:00:00Z', ending: 'held', on_main: 1},
    {kind: 'smoke', name: 'Custom row', day: '2026-10-11', at: '2026-10-11T10:00:00Z', ending: 'ready', on_main: 1}, {kind: 'smoke', name: 'Greenhouse two', day: '2026-10-11', at: '2026-10-11T10:00:00Z', ending: 'ready', on_main: 1}];
  const endings = [record('Lever row', 'ready', {at: '2026-10-12T18:00:00.000Z'}), record('Greenhouse row', 'unresolved'), record('Custom row', 'told', {branch: 'fix-x'})];   // a PR's run never counts
  const scorecard = [{platform: 'Greenhouse', matchShare: 45}, {platform: 'Lever', matchShare: 3}, {platform: 'Workday', matchShare: 2}, {platform: 'Ashby', matchShare: 28}];
  const r = resolution({runs, endings, pool, scorecard, now});
  assert.deepEqual([r.measured, r.held, r.resolved, r.raw], [4, 1, 3, 75]);
  assert.deepEqual(r.endings, {ready: 3, told: 0, handed: 0, blind: 0, data_missing: 0, site_broken: 0, unresolved: 1});
  assert.deepEqual(r.unresolved, [{row: 'Greenhouse row', platform: 'Greenhouse', source: 'ci', day: '2026-10-12'}]);
  assert.equal(r.weighted, 53, 'Greenhouse 45 x 1/2 + Lever 3 x 1, over 48 = 53%');
  assert.deepEqual(r.samples, [{platform: 'Greenhouse', share: 45, rows: 2}, {platform: 'Ashby', share: 28, rows: 0}, {platform: 'Lever', share: 3, rows: 1}, {platform: 'Workday', share: 2, rows: 0}]);
  assert.equal(r.covered, 48);
});

test('the weekly trend: per ISO week, each row\'s newest ending that week; the last six weeks, oldest first', () => {
  const pool = [{shape: 'A', platform: 'Custom'}, {shape: 'B', platform: 'Custom'}];
  const runs = [{kind: 'smoke', name: 'A', day: '2026-10-01', at: '2026-10-01T10:00:00Z', ending: 'unresolved', on_main: 1}, {kind: 'smoke', name: 'A', day: '2026-10-02', at: '2026-10-02T10:00:00Z', ending: 'ready', on_main: 1},
    {kind: 'smoke', name: 'B', day: '2026-10-01', at: '2026-10-01T10:00:00Z', ending: 'unresolved', on_main: 1}, {kind: 'smoke', name: 'A', day: '2026-10-12', at: '2026-10-12T10:00:00Z', ending: 'ready', on_main: 1}];
  const r = resolution({runs, endings: [], pool, scorecard: [], now});
  assert.deepEqual(r.weeks.slice(-2), [{week: '2026-09-28', measured: 2, raw: 50}, {week: '2026-10-12', measured: 1, raw: 100}]);
  assert.ok(r.weeks.length <= 6);
});
