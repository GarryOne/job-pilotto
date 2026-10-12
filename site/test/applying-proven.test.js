// /admin/applying's "proven live" (src/applying-proven.js): CI sends ONE record per pool run that REALLY ran a row (it reached a page; not skipped, not NOT RUN, not a bot wall),
// PUT /applying/proven with the narrow REPLAYS_PUBLISH_KEY; the Fixed tab joins them to each fix. A fix is "proven <date> <run>" when a record for its row either ran on main
// at or after its landing, or ran on the PR's own build (matched by commit SUBJECT and ROW: rebase-merge changes shas, two PRs with one subject cannot prove each other);
// else "not proven live". Guard: this file.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {data, ingest} from '../src/applying.js';
import {provenFor, provenIngest, readProven, storeProven} from '../src/applying-proven.js';

function d1() {
  const db = new DatabaseSync(':memory:'), log = {written: 0};
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const done = db.prepare(sql).run(...args); log.written += Number(done.changes); return done; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, log, prepare: sql => statement(sql)};
}
const KEY = 'k'.repeat(64), ROW = 'Lever: single page, no account';
const put = (db, body, {key = KEY, envKey = KEY} = {}) => provenIngest(new Request('https://x.test/applying/proven', {method: 'PUT',
  headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}), {STATS: db, REPLAYS_PUBLISH_KEY: envKey}, new Date('2026-10-12T14:00:00Z'));
const rec = (extra = {}) => ({row: ROW, sha: 'abc1234', branch: 'main', pr: null, subjects: [], reached: 'form', applicant: 'thin', run: '38250000001', at: '2026-10-12T13:00:00Z', ...extra});

test('only the publish key writes; a wrong key, no Worker secret or a bad body write nothing', async () => {
  const db = d1();
  assert.equal((await put(db, {records: [rec()]}, {key: 'wrong'})).status, 404);
  assert.equal((await put(db, {records: [rec()]}, {envKey: ''})).status, 404);
  assert.equal((await put(db, {records: []})).status, 400);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM applying_proven').get().n, 0);
  assert.equal((await put(db, {records: [rec()]})).status, 200);
});

test('a record keeps fixed values only; a row with an address, a run that reached nothing or was blocked is no proof; one write per upload; the same run again writes nothing', async () => {
  const db = d1();
  const body = {records: [rec(), rec({row: 'Leaky ?q=1', run: '2'}), rec({reached: 'none', run: '3'}), rec({reached: 'code/bot', run: '4'}), rec({run: '5', subjects: ['Fix the upload slot', 'x'.repeat(300)], pr: 12, branch: 'pool-fix', sha: 'zz'})]};
  db.log.written = 0;
  assert.deepEqual(await (await put(db, body)).json(), {ok: true, stored: 1});
  assert.equal(db.log.written, 1);
  const stored = await readProven(db);
  assert.equal(stored.length, 1);
  assert.equal(JSON.stringify(stored).match(/https?:|\?q=|Leaky/), null);
  db.log.written = 0;
  await put(db, {records: [rec()]});
  assert.equal(db.log.written, 0, 'the same run and row: nothing written');
});

test('only the last 100 records are kept; the oldest go first', async () => {
  const db = d1();
  for (let n = 0; n < 12; n++) await put(db, {records: Array.from({length: 10}, (_, i) => rec({run: String(1000 + n * 10 + i), at: `2026-10-12T${String(10 + (n % 12)).padStart(2, '0')}:0${i}:00Z`}))});
  const kept = await readProven(db);
  assert.equal(kept.length, 100);
  assert.ok(!kept.some(item => item.run === '1000'));
});

const FIX = {site: ROW, landedAt: '2026-10-12T12:00:00Z', subject: 'Fix the Lever upload slot'};
test('the join: main at or after the landing proves it; before it does not; a PR build proves it by subject AND row; another row or subject does not', () => {
  assert.deepEqual(provenFor(FIX, [rec({at: '2026-10-12T13:00:00Z'})]), {at: '2026-10-12T13:00:00Z', run: '38250000001', by: 'main'});
  assert.equal(provenFor(FIX, [rec({at: '2026-10-12T11:59:00Z'})]), null, 'a main run before the landing proves nothing');
  const pr = (extra = {}) => rec({branch: 'fix-lever', pr: 458, at: '2026-10-12T11:30:00Z', subjects: ['Fix the Lever upload slot', 'Add the case'], ...extra});
  assert.deepEqual(provenFor(FIX, [pr()]), {at: '2026-10-12T11:30:00Z', run: '38250000001', by: 'pr', pr: 458});
  assert.equal(provenFor(FIX, [pr({row: 'Recruitee form'})]), null, 'another row: no proof');
  assert.equal(provenFor(FIX, [pr({subjects: ['Fix the Recruitee upload slot']})]), null, 'another subject: no proof');
  assert.equal(provenFor({...FIX, subject: null}, [pr()]), null, 'a fix with no subject is matched on main only');
  assert.equal(provenFor(FIX, [rec({branch: 'some-branch', pr: null, at: '2026-10-12T13:00:00Z'})]), null, 'a dispatch from another branch is not main');
  assert.equal(provenFor(FIX, [pr({at: '2026-10-12T11:30:00Z', run: '5'}), rec({at: '2026-10-13T08:00:00Z', run: '9'})]).by, 'main', 'the newest proof is shown');
});

const FIXROW = {site: ROW, commit: 'fdbdc23', extensionVersion: '0.9.231', rung: '2', landedAt: '2026-10-12T12:00:00Z', subject: 'Fix the Lever upload slot', guard: []};
test('the Fixed tab shows three states: not proven live, proven by a main run, proven by the PR build', async () => {
  const db = d1();
  await ingest(db, {kind: 'fixes', day: '2026-10-12', rows: [FIXROW]}, new Date('2026-10-12T12:30:00Z'));
  const view = async () => (await data(db, new Date('2026-10-12T15:00:00Z'))).fixed.rows.find(row => row.site === ROW);
  assert.equal((await view()).proven, null, 'no record: not proven live');
  await storeProven(db, {records: [rec({branch: 'fix-lever', pr: 458, at: '2026-10-12T11:30:00Z', subjects: [FIXROW.subject], run: '7'})]}, new Date('2026-10-12T12:00:00Z'));
  assert.deepEqual((await view()).proven, {at: '2026-10-12T11:30:00.000Z', run: '7', by: 'pr', pr: 458});
  await storeProven(db, {records: [rec({at: '2026-10-12T14:00:00Z', run: '8'})]}, new Date('2026-10-12T14:00:00Z'));
  assert.deepEqual((await view()).proven, {at: '2026-10-12T14:00:00.000Z', run: '8', by: 'main'});
});

test('the fix upload keeps the commit subject (text, no address), for the join', async () => {
  const db = d1();
  await ingest(db, {kind: 'fixes', day: '2026-10-12', rows: [FIXROW, {...FIXROW, site: 'Other', commit: 'aaaaaaa', subject: 'see https://x.test/a?b=1'}]}, new Date('2026-10-12T12:30:00Z'));
  assert.deepEqual(db.db.prepare('SELECT site, subject FROM applying_fixes ORDER BY site').all().map(row => ({...row})), [{site: ROW, subject: FIXROW.subject}, {site: 'Other', subject: null}]);
});

test('the page shows "Not proven live" or "Proven live ... run N" under each fix\'s status', async () => {
  const db = d1();
  await ingest(db, {kind: 'fixes', day: '2026-10-12', rows: [FIXROW]}, new Date('2026-10-12T12:30:00Z'));
  const {PAGE} = await import('../src/applying.js');
  assert.match(PAGE, /Not proven live/);
  assert.match(PAGE, /'Proven live ' \+ ago\(r\.proven\.at\)/);
  assert.match(PAGE, /textContent: provenLine\(r\)/);
  assert.ok(!/Proven live[^']*`/.test(PAGE), 'plain quotes only: the script sits in a template literal');
});
