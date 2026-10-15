// The Resolution tile of /admin/lab-form-filling (src/applying-resolution.js; the outcome contract, spec docs/superpowers/specs/2026-10-12-one-next-move.md phase 1a): each pool row's newest
// ending (the owner's Mac uploads and CI's runs on main), the share resolved raw and weighted by real demand with its sample per platform, the rows held by the test apart, the
// unresolved rows first, and a weekly trend. CI's endings arrive with the narrow key, in one write.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {CAUSES, ENDING_MEANS, STUCK_REASONS, WORST_FIRST} from '../../extension/ladder/endings.js';
import {RESOLUTION_SCRIPT, endingsIngest, readEndings, resolution, storeEndings} from '../src/applying-resolution.js';
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
  assert.deepEqual([r.measured, r.resolved, r.unresolved], [1, 1, 0], 'only the main build\'s run is measured');
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
  assert.equal(r.unresolved, 1);
  assert.deepEqual(r.rows.map(item => [item.row, item.ending]), [['Greenhouse row', 'unresolved'], ['Custom row', 'ready'], ['Greenhouse two', 'ready'], ['Lever row', 'ready'], ['Account row', 'held']], 'every row, worst first, held last');
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

test('each row says where it stopped and why, in fixed words only; a word outside the lists is dropped; since compares with the previous run', async () => {
  const STATS = d1();
  await storeEndings(STATS, {records: [record('A', 'unresolved', {run: '1', at: '2026-10-11T10:00:00.000Z', step: 'form', cause: 'field-missed'}),
    record('A', 'ready', {run: '2', step: 'ready', cause: 'ready'}), record('B', 'unresolved', {step: 'https://x.example/p', cause: 'Send your CV to jane@x.example'}), record('C', 'held', {step: 'account', cause: 'account-first'})]}, now);
  const kept = await readEndings(STATS);
  assert.deepEqual(kept.filter(item => item.row === 'B').map(item => [item.step, item.cause]), [[null, null]], 'page text never lands');
  const pool = ['A', 'B', 'C'].map(shape => ({shape, platform: 'Custom'}));
  const r = resolution({endings: kept, pool, now});
  const by = Object.fromEntries(r.rows.map(item => [item.row, item]));
  assert.deepEqual([by.A.step, by.A.cause, by.A.run, by.A.since, by.A.source], ['ready', 'ready', '2', '↑', 'ci']);
  assert.deepEqual([by.B.step, by.B.cause, by.B.since], [null, null, null]);
  assert.deepEqual([by.C.ending, by.C.cause], ['held', 'account-first']);
  const mac = resolution({runs: [{kind: 'smoke', name: 'A', at: '2026-10-12T10:00:00Z', ending: 'unresolved', on_main: 1, reached: 'posting', cause: 'no-form'}], pool, now}).rows[0];
  assert.deepEqual([mac.step, mac.cause, mac.source], ['posting', 'no-form', 'mac']);
});

test('the Mac\'s upload keeps a run\'s cause word; one outside the list is dropped', async () => {
  const STATS = d1();
  await ingest(STATS, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'A', reached: 'form', ending: 'unresolved', cause: 'field-missed'}, {name: 'B', reached: 'form', ending: 'unresolved', cause: 'a page said so'}]}, now);
  assert.deepEqual((await latestRuns(STATS)).map(run => [run.name, run.cause]), [['A', 'field-missed'], ['B', null]]);
});

test('the legend is the table: every ending has a plain meaning and a pill colour, and the page script draws each pool row with them', () => {
  assert.deepEqual([...WORST_FIRST].sort(), [...Object.keys(ENDING_MEANS)].sort(), 'a meaning for every ending, held too');
  for (const word of WORST_FIRST) assert.ok(RESOLUTION_SCRIPT.includes(`${word}: '`) , `${word} has a colour`);
  for (const reason of STUCK_REASONS) assert.ok(Object.hasOwn(CAUSES, reason), `the stuck reason ${reason} is a why word: one list with the extension`);
  assert.match(RESOLUTION_SCRIPT, /endingWordOf\(s\) === endingPick/, 'an ending filters the pool rows');
  assert.match(RESOLUTION_SCRIPT, /onclick: \(\) => \{ endingPick = word; syncEnding\(\); poolRedraw\(\);/, 'a pill shows its rows in the pool table');
});

// Owner, 15 Oct 2026: "Every pool row" (Resolution) went INTO the pool table. Nothing it showed is lost: each of its columns (Row, Platform, Ending, Where it stopped, Why, Last run, Since) is in the pool row.
test('"Every pool row" is gone: its columns live in the pool table\'s Last result cell, and the endings are a chip filter of the pool', async () => {
  const {PAGE} = await import('../src/applying.js');
  assert.doesNotMatch(RESOLUTION_SCRIPT, /Every pool row|heads\('resolution'|resolutionPage/, 'no second table of the rows, no pager');
  assert.match(RESOLUTION_SCRIPT, /const endingLine = s =>/);
  for (const part of ["item.ending.replace('_', ' ')", 'CAUSES[item.cause]', "item.day + ' · CI'", "item.day + ' · Mac'", "actions/runs/' + item.run", 'item.since', 'SINCE[item.since]', 'ENDING_MEANS[item.ending]']) assert.ok(RESOLUTION_SCRIPT.includes(part), part + ' is in the row\'s ending line');   // ending, why, exact date + Mac/CI + run link, since + its meaning
  assert.match(PAGE, /resultOf\(s\), endingLine\(s\), s\.running/, 'the pool row draws the ending line under its status');
  assert.match(PAGE, /chipFilter\('Ending', \[\['', 'All'\], \.\.\.WORST_FIRST\.map/, 'the endings, with their counts, are a chip row of the pool filter bar');
  assert.match(PAGE, /pick\('flow', d\.flows, 'Flow', 'All flows'\), endingChips/, 'the Ending chips are the pool\'s one status-like filter (the Status chips went: each row\'s pill says its status)');
  assert.match(PAGE, /endingPick = null; chosen\.query = ''/, 'Clear resets it');
});
