// /admin/applying's Fixed tab (src/applying-fixed.js): the fix ledger the Mac uploads (desktop/e2e/lib/fix-ledger.mjs), joined with the smoke runs already uploaded:
// a fix is "landed" until an uploaded run after it clears the row ("confirmed"), and "back" when a later run lists it again. Claims show "In progress" on the Needs a fix tab.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const at = iso => new Date(iso);
const FIX = {site: 'Hornbach SuccessFactors', commit: 'fdbdc23', extensionVersion: '0.9.181', rung: '2', landedAt: '2026-10-11T00:41:50+02:00', guard: ['fixture:hornbach-successfactors', 'recorded:named-control-absent-1']};
const smoke = (db, iso, row) => ingest(db, {kind: 'smoke', day: iso.slice(0, 10), rows: [{name: 'Hornbach SuccessFactors', host: 'jobs.hornbach.com', ...row}]}, at(iso));
const fixedRow = async (db, now) => (await data(db, at(now))).fixed.rows.find(row => row.site === FIX.site);

test('a fix upload keeps fixed values only; a site name with an address or a query string, a bad hash or guard is dropped', async () => {
  const db = d1();
  const result = await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX,
    {...FIX, site: 'https://jobs.hornbach.com/job/1?token=abc'}, {...FIX, site: 'Leaky ?q=1'}, {...FIX, site: 'Bad hash', commit: 'zzz'},
    {...FIX, site: 'Bad guard', commit: 'abcdef1', guard: ['recorded:../../etc', 'note:Igor Mardari']}]}, at('2026-10-11T08:00:00Z'));
  assert.equal(result.ok, true);
  const rows = db.db.prepare('SELECT site, commit_hash, guard FROM applying_fixes ORDER BY site').all().map(row => ({...row}));
  assert.deepEqual(rows, [{site: 'Bad guard', commit_hash: 'abcdef1', guard: '[]'}, {site: 'Hornbach SuccessFactors', commit_hash: 'fdbdc23', guard: JSON.stringify(FIX.guard)}]);
  assert.equal(JSON.stringify(rows).match(/https?:|\?|=|Igor/), null);
});

test('the ledger is a snapshot: a new upload replaces the old fixes (a corrected mapping removes a wrong row)', async () => {
  const db = d1();
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX, {...FIX, site: 'Wrong row', commit: 'aaaaaaa'}]}, at('2026-10-11T08:00:00Z'));
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T09:00:00Z'));
  assert.deepEqual(db.db.prepare('SELECT site FROM applying_fixes').all().map(row => row.site), [FIX.site]);
});

test('landed -> not better yet -> confirmed -> back: computed from the runs uploaded after the landing, with filled before and after', async () => {
  const db = d1();
  await smoke(db, '2026-10-10T22:00:00Z', {reached: 'posting'});   // before the landing: stopped at the posting
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T08:00:00Z'));
  let row = await fixedRow(db, '2026-10-11T09:00:00Z');
  assert.deepEqual([row.status, row.failingRuns, row.platform, row.commit, row.rung], ['landed', 0, 'Custom', 'fdbdc23', '2']);
  await smoke(db, '2026-10-11T10:00:00Z', {reached: 'posting'});   // a run after the landing that still fails
  row = await fixedRow(db, '2026-10-11T11:00:00Z');
  assert.deepEqual([row.status, row.failingRuns], ['landed', 1]);
  await smoke(db, '2026-10-11T22:00:00Z', {reached: 'form', filled: 8, left: 3});   // the row clears
  row = await fixedRow(db, '2026-10-12T08:00:00Z');
  assert.deepEqual([row.status, row.confirmedAt, row.filledBefore, row.filledAfter], ['confirmed', '2026-10-11T22:00:00.000Z', [null], [null, 73]]);
  await smoke(db, '2026-10-12T22:00:00Z', {reached: 'account'});   // listed again
  const d = await data(db, at('2026-10-13T08:00:00Z'));
  row = d.fixed.rows.find(item => item.site === FIX.site);
  assert.equal(row.status, 'back');
  assert.equal(d.pool.find(item => item.name === FIX.site).back, true);   // tab 1 shows a Back marker on the row
});

test('a fix for a site the pool does not list still shows, as landed; the guard keeps its recorded case\'s dots', async () => {
  const db = d1();
  await ingest(db, {kind: 'recorded', day: '2026-10-11', version: '0.9.181', rows: [{name: 'named-control-absent-1', ok: true}, {name: 'cookie-banner-links-1', ok: false}]}, at('2026-10-11T09:00:00Z'));
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T08:00:00Z'));
  const d = await data(db, at('2026-10-11T10:00:00Z'));
  const [row] = d.fixed.rows;
  assert.deepEqual([row.status, row.platform, row.cases.map(item => [item.name, item.history])], ['landed', '—', [['named-control-absent-1', [1]]]]);
  assert.deepEqual(d.fixed.replays.map(item => item.name), ['cookie-banner-links-1']);   // a replay no fix names keeps its row in the same table
});

test('claims: a snapshot of names and since, "as of" the upload; the Needs a fix row carries "In progress"', async () => {
  const db = d1();
  await smoke(db, '2026-10-11T07:00:00Z', {reached: 'posting'});
  await ingest(db, {kind: 'claims', day: '2026-10-11', rows: [{name: 'Hornbach SuccessFactors', since: '2026-10-11T06:00:00.000Z', session: 'job-pilotto-81'}]}, at('2026-10-11T08:00:00Z'));
  let d = await data(db, at('2026-10-11T09:00:00Z'));
  assert.deepEqual(d.fixed.inProgress, [{site: 'Hornbach SuccessFactors', since: '2026-10-11T06:00:00.000Z'}]);   // names and since only: no session
  assert.equal(d.fixed.claimsAt, '2026-10-11T08:00:00.000Z');
  assert.equal(d.pool.find(item => item.name === FIX.site).claimed, '2026-10-11T06:00:00.000Z');
  assert.equal((await ingest(db, {kind: 'claims', day: '2026-10-11', rows: []}, at('2026-10-11T10:00:00Z'))).ok, true);   // an empty list releases them all
  d = await data(db, at('2026-10-11T11:00:00Z'));
  assert.deepEqual([d.fixed.inProgress, d.pool[0].claimed], [[], null]);
});

test('each pool row carries its own runs (last 20: day, at, reached, filled, left, version) and its shape name', async () => {
  const db = d1();
  for (let night = 1; night <= 22; night++) await smoke(db, `2026-10-${String(night).padStart(2, '0')}T22:00:00Z`, {reached: 'form', filled: night, left: 1});
  const [item] = (await data(db, at('2026-10-23T08:00:00Z'))).pool;
  assert.equal(item.shape, 'Hornbach SuccessFactors');
  assert.equal(item.runs.length, 20);
  assert.deepEqual(Object.keys(item.runs[0]).sort(), ['at', 'day', 'filled', 'left', 'needsFix', 'reached', 'version']);
});

test('the page: two tabs by URL hash, the Fixed table from heads() through block(), the replays folded into it, the "unconfirmed" line', () => {
  assert.match(PAGE, /#needs-fix/); assert.match(PAGE, /#fixed/); assert.match(PAGE, /hashchange/);
  assert.match(PAGE, /block\('fixed', /);
  assert.doesNotMatch(PAGE, /Fixed-site replays · every fixed site, replayed/);   // one table, not two
  assert.doesNotMatch(PAGE, /heads\('cases'/);
  assert.match(PAGE, /every landed fix shows "Landed, unconfirmed" until an uploaded run clears it/);
  for (const label of ['Landed, unconfirmed', 'Landed, not better yet', 'Confirmed', 'Back', 'In progress']) assert.ok(PAGE.includes(label), label);
  for (const column of ['Site', 'Platform', 'Fix', 'Status', 'Filled before → after', 'Guard']) assert.ok(PAGE.includes(`'${column}'`), column);
});
