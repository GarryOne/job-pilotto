// D1 budget guard (11 Oct 2026, the free plan's daily limit was hit): one /admin/lab-form-filling load, cold and warm, touches no big table and reads few rows; an upload drops the snapshot.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {cachedData, FAST_MINUTES, slowCache} from '../src/applying-store.js';
import {data, forget, ingest} from '../src/applying.js';

const BIG = ['applying_runs', 'contributions', 'fill_cards', 'question_labels', 'telemetry'];   // tables a page load must never scan
// A D1 stand-in that records every statement: the rows it returned and the rows it wrote.
function d1() {
  const db = new DatabaseSync(':memory:'), log = {reads: [], writes: 0};
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values),
    run: async () => { const done = db.prepare(sql).run(...args); log.writes += Number(done.changes); return done; },
    all: async () => { const results = db.prepare(sql).all(...args); log.reads.push({sql, rows: results.length}); return {results}; },
    first: async () => { const row = db.prepare(sql).get(...args); log.reads.push({sql, rows: row ? 1 : 0}); return row; }});
  return {db, log, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
const names = Array.from({length: 77}, (_, at) => `site-${at}`);
async function seed(db) {
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: names.map(name => ({name, start_host: 'jobs.example.com'}))}, now);
  for (const day of ['2026-10-09', '2026-10-10', '2026-10-11']) await ingest(db, {kind: 'smoke', day, rows: names.map(name => ({name, host: 'jobs.example.com', reached: 'form', filled: 3, left: 1}))}, now);
}
const touching = (log, tables) => log.reads.filter(read => tables.some(table => new RegExp(`\\b${table}\\b`).test(read.sql)));
const rowsRead = log => log.reads.reduce((sum, read) => sum + read.rows, 0);

test('one page load reads each site\'s last runs, never applying_runs: cold at most 600 rows, warm one row', async () => {
  const db = d1(); await seed(db);
  db.log.reads.length = 0;
  const run = () => cachedData(db, () => data(db, now, slowCache(db, now)), now);
  const cold = await run();
  assert.equal(cold.pool.length, 77);
  assert.equal(touching(db.log, ['applying_runs']).length, 0, 'the page scanned applying_runs');
  assert.ok(rowsRead(db.log) <= 600, `a cold load read ${rowsRead(db.log)} rows`);
  db.log.reads.length = 0;
  const warm = await run();
  assert.equal(warm.pool.length, 77);
  assert.deepEqual(db.log.reads.map(read => read.rows), [1], 'a warm load is one snapshot row');
  db.log.reads.length = 0;
  await cachedData(db, () => data(db, now, slowCache(db, now)), new Date(now.getTime() + (FAST_MINUTES + 1) * 60000));
  assert.equal(touching(db.log, BIG).length, 0, 'an expired snapshot rescanned a big table');   // the big readers sit behind the hour cache
});

test('an upload (and a forget) drops the snapshot, so the next load shows it', async () => {
  const db = d1(); await seed(db);
  const run = () => cachedData(db, () => data(db, now, slowCache(db, now)), now);
  assert.equal((await run()).sites.length, 77);
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'brand-new', host: 'x.example.com', reached: 'ready'}]}, now);
  assert.equal((await run()).sites.length, 78);
  await forget(db, {kind: 'smoke', day: '2026-10-12', name: 'brand-new'});
  assert.equal((await run()).sites.length, 77);
});

test('the last runs of a site are kept in order, capped, and rebuilt from applying_runs when the table is empty', async () => {
  const db = d1();
  for (let at = 0; at < 35; at += 1) await ingest(db, {kind: 'smoke', day: `2026-09-${String((at % 28) + 1).padStart(2, '0')}`, rows: [{name: 'one', host: 'a.example.com', reached: at === 34 ? 'ready' : 'form'}]}, now);
  db.db.exec('DELETE FROM applying_latest');
  const d = await data(db, new Date('2026-09-30T00:00:00Z'));
  assert.equal(d.sites.length, 1);
  assert.ok(d.sites[0].runs.length <= 20);
});

test('the session tools read a saved copy of the page, fetched again only when older than 15 minutes or forced', async () => {
  const {pageJson} = await import('../../tools/applying-page-copy.mjs');
  const {mkdtempSync, utimesSync} = await import('node:fs'), {tmpdir} = await import('node:os'), {join} = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'page-copy-')), 'copy.json');
  let fetches = 0;
  const fetchLive = () => ({n: ++fetches});
  assert.equal(pageJson({file, fetchLive}).n, 1);
  assert.equal(pageJson({file, fetchLive}).n, 1);                  // a second call reads the copy
  assert.equal(pageJson({file, fetchLive, refresh: true}).n, 2);   // --refresh forces
  const old = new Date(Date.now() - 16 * 60000); utimesSync(file, old, old);
  assert.equal(pageJson({file, fetchLive}).n, 3);                  // an old copy is fetched again
});

test('a failed migration 0056 never takes the page or an upload down: it computes without the tables', async () => {
  const db = d1(); await seed(db);
  db.db.exec('DROP TABLE applying_latest; DROP TABLE applying_view;');
  const warn = console.warn, warnings = []; console.warn = message => warnings.push(message);
  try {
    assert.equal((await cachedData(db, () => data(db, now, slowCache(db, now)), now)).pool.length, 77);
    assert.equal((await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'late', host: 'x.example.com', reached: 'form'}]}, now)).ok, true);
    assert.equal((await forget(db, {kind: 'smoke', day: '2026-10-12', name: 'late'})).ok, true);
  } finally { console.warn = warn; }
  assert.ok(warnings.some(message => /migration 0056 missing/.test(message)));
});

test('writes: a full pool pass writes at most 400 rows, an unchanged pool upload writes none, a changed row writes one', async () => {
  const db = d1();
  const pool = rows => ingest(db, {kind: 'pool', day: '2026-10-12', version: '0.9.1', rows}, now);
  const rows = names.map(name => ({name, start_host: 'jobs.example.com', signature: 'posting>form@jobs.example.com#form'}));
  db.log.writes = 0; await pool(rows);
  assert.ok(db.log.writes <= 400, `a first pool pass wrote ${db.log.writes} rows`);
  db.log.writes = 0; await pool(rows);
  assert.ok(db.log.writes <= 1, `an unchanged pool upload wrote ${db.log.writes} rows`);   // at most the snapshot drop
  db.log.writes = 0; await pool([{...rows[0], signature: 'posting>form>done@jobs.example.com#ready'}]);
  assert.ok(db.log.writes >= 1 && db.log.writes <= 2, `one changed row wrote ${db.log.writes}`);
});

test('writes: the fixes snapshot is a diff, an unchanged ledger writes nothing but its stamp', async () => {
  const db = d1();
  const fixes = Array.from({length: 40}, (_, at) => ({site: `site-${at}`, commit: `abcdef${at}`.padEnd(7, '0'), landedAt: '2026-10-11T10:00:00Z', extensionVersion: '0.9.1', rung: '2', guard: ['recorded:case-1']}));
  await ingest(db, {kind: 'fixes', rows: fixes}, now);
  db.log.writes = 0; await ingest(db, {kind: 'fixes', rows: fixes}, now);
  assert.ok(db.log.writes <= 2, `an unchanged ledger wrote ${db.log.writes} rows`);
  db.log.writes = 0; await ingest(db, {kind: 'fixes', rows: fixes.slice(1)}, now);
  assert.ok(db.log.writes <= 3, `dropping one fix wrote ${db.log.writes} rows`);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM applying_fixes').get().n, 39);
});
