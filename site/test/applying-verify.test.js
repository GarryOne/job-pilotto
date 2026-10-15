// "Confirmed offline" on /admin/lab-form-filling (src/applying-verify.js): only the publish key writes, a verdict keeps fixed words only, the newest verdict of a row replaces its old one,
// an identical upload writes nothing, and the Fixed tab's data carries each fix's verdict.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {readVerify, storeVerify, verifyFor, verifyIngest} from '../src/applying-verify.js';

function d1() {
  const db = new DatabaseSync(':memory:'), log = {written: 0};
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const done = db.prepare(sql).run(...args); log.written += Number(done.changes); return done; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, log, prepare: sql => statement(sql)};
}
const KEY = 'k'.repeat(64), ROW = 'Lever: single page, no account', NOW = new Date('2026-10-14T20:00:00Z');
const put = (db, body, {key = KEY, envKey = KEY} = {}) => verifyIngest(new Request('https://x.test/applying/verify', {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}), {STATS: db, REPLAYS_PUBLISH_KEY: envKey}, NOW);
const item = (extra = {}) => ({kind: 'fixed', row: ROW, verdict: 'confirmed', why: 'goes further than the live run', commit: 'abc1234', buildBy: 'version', recordedAt: '2026-10-12T10:00:00Z', ...extra});

test('only the publish key writes; a wrong key, no Worker secret or a bad body write nothing', async () => {
  const db = d1();
  assert.equal((await put(db, {sha: 'abc1234', rows: [item()]}, {key: 'wrong'})).status, 404);
  assert.equal((await put(db, {sha: 'abc1234', rows: [item()]}, {envKey: ''})).status, 404);
  assert.equal((await put(db, {sha: 'nope', rows: [item()]})).status, 400);
  assert.equal((await put(db, {sha: 'abc1234', rows: []})).status, 400);
  assert.equal((await put(db, {sha: 'abc1234', rows: [item()]})).status, 200);
});

test('a verdict keeps fixed words only: an unknown verdict, a kind\'s foreign verdict, an address in the row or the reason', async () => {
  const db = d1();
  const sent = await storeVerify(db, {sha: 'abc1234', rows: [item(), item({row: 'Leaky ?q=1'}), item({row: 'B', verdict: 'ours'}), item({row: 'C', verdict: 'maybe'}), item({row: 'D', why: 'see https://x.test/a'}), item({row: 'E', kind: 'nope'})]}, NOW);
  assert.equal(sent.stored, 2);
  const kept = await readVerify(db);
  assert.deepEqual(kept.map(one => one.row).sort(), ['D', ROW]);
  assert.equal(kept.find(one => one.row === 'D').why, '');
});

test('the newest verdict of a row replaces its old one; the same upload again writes nothing; other rows stay', async () => {
  const db = d1();
  await storeVerify(db, {sha: 'abc1234', rows: [item(), item({row: 'Other', verdict: 'live'})]}, NOW);
  const before = db.log.written;
  assert.equal((await storeVerify(db, {sha: 'abc1234', rows: [item()]}, NOW)).stored, 0);
  assert.equal(db.log.written, before, 'an identical verdict is no write');
  assert.equal((await storeVerify(db, {sha: 'def5678', rows: [item({verdict: 'notbetter', why: 'ends where the live run did'})]}, NOW)).stored, 1);
  const kept = await readVerify(db);
  assert.equal(kept.length, 2);
  assert.equal(verifyFor(kept, 'fixed', ROW).verdict, 'notbetter');
  assert.equal(verifyFor(kept, 'regression', ROW), null);
});

test('"holds" is a stored fixed verdict, never a regression one', async () => {
  const db = d1();
  await storeVerify(db, {sha: 'abc1234', rows: [item({verdict: 'holds', why: 'the fix changes what the AI is asked, so the build before it cannot run on this recording; today\'s build still matches live'}), item({kind: 'regression', row: 'Other', verdict: 'holds'})]}, NOW);
  const stored = await readVerify(db);
  assert.deepEqual(stored.map(row => [row.kind, row.row, row.verdict]), [['fixed', ROW, 'holds']]);
});

test('the Fixed tab carries a fix\'s offline verdict, and a pool row its regression verdict', async () => {
  const {fixedData, ingestFixes} = await import('../src/applying-fixed.js'), db = d1();
  await ingestFixes(db, {kind: 'fixes', rows: [{site: ROW, commit: 'abc1234', landedAt: '2026-10-13T10:00:00Z', guard: []}]}, NOW);
  await storeVerify(db, {sha: 'abc1234', rows: [item(), item({kind: 'regression', verdict: 'site', why: 'the older build stops where the newer one does on the same recording'})]}, NOW);
  const pool = [{name: ROW, shape: ROW, platform: 'Lever', runs: []}], fixed = await fixedData(db, pool, [], NOW);
  assert.equal(fixed.rows[0].offline.verdict, 'confirmed');
  assert.equal(fixed.rows[0].proven, undefined, 'no live-proof field any more');
  assert.equal(pool[0].offline.verdict, 'site');
});

test('the page draws the offline verdict on a Fixed row and on a regression row of Needs a fix', async () => {
  const {FIXED_SCRIPT} = await import('../src/applying-fixed.js'), {PAGE} = await import('../src/applying.js');
  assert.match(FIXED_SCRIPT, /const offlineLine = r =>/);
  assert.match(PAGE, /s\.regression \? el\('span', \{className: 'stack muted', textContent: offlineLine\(s\)\}\)/);
});
