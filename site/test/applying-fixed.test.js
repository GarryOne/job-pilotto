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

test('a fix for a site the pool does not list still shows, as landed; the guard keeps its recorded case\'s dots; a replay no fix names is not listed', async () => {
  const db = d1();
  await ingest(db, {kind: 'recorded', day: '2026-10-11', version: '0.9.181', rows: [{name: 'named-control-absent-1', ok: true}, {name: 'cookie-banner-links-1', ok: false}]}, at('2026-10-11T09:00:00Z'));
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T08:00:00Z'));
  const d = await data(db, at('2026-10-11T10:00:00Z'));
  const [row] = d.fixed.rows;
  assert.deepEqual([row.status, row.platform, row.cases.map(item => [item.name, item.history])], ['landed', '—', [['named-control-absent-1', [1]]]]);
  assert.equal(d.fixed.replays, undefined);   // a replay no fix names is not a fix: it stays in the Fixed-site replays table (d.cases), not here
  assert.deepEqual(d.cases.map(item => item.name).sort(), ['cookie-banner-links-1', 'named-control-absent-1']);
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

test('each fixed row carries what the expander shows: its host, every commit, and its runs with the ones after the landing marked', async () => {
  const db = d1();
  await smoke(db, '2026-10-10T22:00:00Z', {reached: 'posting'});
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX, {...FIX, commit: 'f5975be', extensionVersion: '0.9.182', landedAt: '2026-10-11T00:52:34+02:00', rung: '3'}]}, at('2026-10-11T08:00:00Z'));
  await smoke(db, '2026-10-11T10:00:00Z', {reached: 'form', filled: 8, left: 3});
  const row = await fixedRow(db, '2026-10-11T11:00:00Z');
  assert.equal(row.host, 'jobs.hornbach.com');
  assert.deepEqual(row.fixes.map(item => [item.commit, item.extensionVersion, item.rung]), [['fdbdc23', '0.9.181', '2'], ['f5975be', '0.9.182', '3']]);
  assert.deepEqual(row.runs.map(item => [item.reached, item.after, item.share]), [['posting', false, null], ['form', true, 73]]);
  assert.equal(row.status, 'confirmed');   // the logic is the same as before: a run after the LATEST landing cleared it
});

test('the page: two tabs by URL hash, one charcoal panel (title, one sentence, "How verification works", toolbar, table, footer), five columns from heads(), a row expander', () => {
  assert.match(PAGE, /#needs-fix/); assert.match(PAGE, /#fixed/); assert.match(PAGE, /hashchange/);
  assert.match(PAGE, /heads\('fixed', \['Site \/ platform', 'Verification', 'Filled before → after', 'Fix', 'Details'\]/);
  assert.match(PAGE, /heads\('cases', \['Case', 'Rung guarded', 'Result', 'Last 10 runs', 'Last run', 'Since'\]/);   // the Fixed-site replays table is back, as it was (owner, 11 Oct 2026)
  assert.match(PAGE, /Fixed-site replays · every fixed site, replayed/);
  assert.doesNotMatch(PAGE, /'Guard'/);   // the Guard column is the expander now
  assert.match(PAGE, /Every landed fix is "Awaiting verification" until an uploaded run clears it\./);
  assert.match(PAGE, /How verification works/);
  for (const word of ['Awaiting verification', 'Still failing', 'Confirmed', 'Regressed', 'No confirming run yet']) assert.ok(PAGE.includes(word), word);
  for (const old of ['Landed, unconfirmed', 'Landed, not better yet']) assert.ok(!PAGE.includes(old), old + ' is gone');
  assert.match(PAGE, /does not say how much more was filled/);   // Confirmed never implies the fill went up
  assert.match(PAGE, /Sites with a landed fix/);   // the tab's tooltip says what it counts
  assert.doesNotMatch(PAGE, /Replay only|replay-only/);   // the replays are their own table again, never rows here
  assert.match(PAGE, /padding:12px 16px/);
});

test('the two tabs are real tabs joined to the content: a tablist whose active tab shares the panel background, no gap between the strip and the panel', () => {
  assert.match(PAGE, /role: 'tablist'/); assert.match(PAGE, /role: 'tab'/); assert.match(PAGE, /'aria-selected'/);
  assert.match(PAGE, /\.tabs a\{[^}]*margin-bottom:-1px/);   // the tab overlaps the strip's line
  assert.match(PAGE, /\.tabs a\.on\{[^}]*background:var\(--card\)/);   // the active tab is the panel's own colour
  assert.match(PAGE, /\.tabs ~ section\.fixed\{[^}]*margin-top:0/);   // no gap under the strip
  assert.doesNotMatch(PAGE, /className: 'chip' \+ \(fixed/);   // the old chip buttons are gone
});

test('both tabs sit in the same panel: Needs a fix is a .fixpanel with the same card background, header, flat toolbar and 12px/16px cells as Fixed', () => {
  assert.match(PAGE, /fixBox\.append\(el\('div', \{className: 'fixpanel'\}, el\('div', \{className: 'fixhead'\}/);
  assert.match(PAGE, /\.tabs ~ section \.fixpanel\{[^}]*border-radius:0 0 12px 12px/);   // one rule for both panels
  assert.match(PAGE, /\.fixpanel \.filters\{[^}]*border:0/);   // the toolbar is flat inside the panel, not a second box
  assert.match(PAGE, /\.fixpanel td,\.fixpanel th\{padding:12px 16px/);
});

test('every paged table of the tabs and sections that share the block() helper shows 10 rows a page, the Fixed table too (owner, 11 Oct 2026); the pool keeps its own 15', () => {
  assert.match(PAGE, /NEXT_PER = 10\b/);
  assert.match(PAGE, /FIX_PER = NEXT_PER\b/);   // Fixed follows the same size, never its own number
  assert.match(PAGE, /const PER = 15\b/);
  assert.doesNotMatch(PAGE, /NEXT_PER = 5\b|FIX_PER = 5\b/);
});
