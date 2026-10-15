// /admin/lab-form-filling's "Replay vs live (prototype)" (src/applying-fidelity.js): the verdict rule, the one-row store, the 404 without the key, and a page that carries the section.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data} from '../src/applying.js';
import {FIDELITY_SCRIPT, cleanRecord, fidelity, fidelityIngest, readFidelity, verdictOf} from '../src/applying-fidelity.js';

function d1() {
  const db = new DatabaseSync(':memory:'), log = {written: 0};
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values),
    run: async () => { const done = db.prepare(sql).run(...args); log.written += Number(done.changes); return done; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, log, prepare: sql => statement(sql)};
}
const KEY = 'k'.repeat(64);
const put = (db, body, key = KEY) => fidelityIngest(new Request('https://x.test/applying/fidelity', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), {STATS: db, REPLAYS_PUBLISH_KEY: KEY}, new Date('2026-10-13T10:00:00Z'));
const row = (name, network, extra = {}) => ({name, sha: 'abc1234', branch: 'replay-proof', at: '2026-10-13T09:00:00Z', live: {filled: 5, left: 1, ending: 'ready', asks: 4}, live2: {asks: 4, extraVsLive1: 1},
  snapshot: {hit: 3, extra: 2}, network, ...extra});
const good = {hit: 4, extra: 0, filled: 5, left: 1, notRecorded: 2, orderMatched: 3, orderWrong: 0, echoed: 1, afterUpload: 'seen'};

test('verdict: same, close (extras within the live spread) and off; absent replay is null; the snapshot has no filled/left and is judged on asks', () => {
  const live = {filled: 5, left: 1, asks: 4};
  assert.equal(verdictOf(live, good), 'same');
  assert.equal(verdictOf(live, {...good, extra: 1}, {extraVsLive1: 1}), 'close');
  assert.equal(verdictOf(live, {...good, extra: 2}, {extraVsLive1: 1}), 'off');
  assert.equal(verdictOf(live, {...good, hit: 3}, {extraVsLive1: 1}), 'off', 'a live ask not answered is never within the spread');
  assert.equal(verdictOf(live, {...good, extra: 1}), 'close', 'no 2nd live run: one miss at most');
  assert.equal(verdictOf(live, {...good, filled: 4}), 'off', 'filled differs');
  assert.equal(verdictOf(live, {hit: 4, extra: 0}), 'same');
  assert.equal(verdictOf(live, null), null);
});

test('only the publish key writes; a row is stored once, newest per name; identical writes nothing', async () => {
  const db = d1();
  assert.equal((await put(db, {rows: [row('a', good)]}, 'wrong')).status, 404);
  assert.deepEqual(await (await put(db, {rows: [row('a', good), row('b', null)]})).json(), {ok: true, stored: 2});
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM applying_fidelity').get().n, 1);
  db.log.written = 0;
  assert.deepEqual(await (await put(db, {rows: [row('a', good)]})).json(), {ok: true, stored: 0});
  assert.equal(db.log.written, 0);
  await put(db, {rows: [row('a', {...good, extra: 3})]});
  const kept = await readFidelity(db);
  assert.equal(kept.length, 2);
  assert.equal(kept.find(item => item.name === 'a').network.extra, 3);
});

test('a record with a URL in its name, no sha or no live run is dropped; free text never lands', async () => {
  const db = d1();
  const bad = [row('https://x.test/job?a=1', good), {...row('c', good), sha: 'zz'}, {...row('d', good), live: {filled: 1}}, row('e', {...good, afterUpload: '<script>'}, {})];
  assert.equal((await (await put(db, {rows: bad})).json()).stored, 1);
  const [kept] = await readFidelity(db);
  assert.equal(kept.name, 'e');
  assert.equal(kept.network.afterUpload, null);
});

test('the summary counts "same as live" for the network replay and the snapshot, and a row with no network says not recorded', () => {
  const f = fidelity([row('a', good, {snapshot: {hit: 4, extra: 0}}), row('b', null), row('c', {...good, extra: 3})]);
  assert.deepEqual(f.summary, {total: 3, recorded: 3, network: 1, snapshot: 1});
  assert.equal(f.rows.find(item => item.name === 'b').networkVerdict, null);
});

test('the page carries the section and its data', async () => {
  const db = d1();
  await put(db, {rows: [row('a', good)]});
  const d = await data(db);
  assert.equal(d.fidelity.rows.length, 1);
  assert.match(PAGE, /Replay vs live \(prototype\)/);
  assert.match(PAGE, /drawFidelity\(fidelityBox, d\.fidelity\)/);
});

test('a pinned row is counted: "N of M same as live (pinned K)" shows when any row is pinned, and a lost pin is visible', () => {
  const f = fidelity([{...row('a', good), pinned: true}, {...row('b', {...good, extra: 3}), pinned: true}, row('c', good)]);
  assert.deepEqual(f.summary, {total: 3, recorded: 3, network: 2, snapshot: 0, pinned: 2, pinnedSame: 1});
  assert.equal(cleanRecord({...row('a', good), pinned: true}).pinned, true);
  assert.equal('pinned' in cleanRecord(row('a', good)), false);
  assert.match(FIDELITY_SCRIPT, /\(pinned: ' \+ s\.pinnedSame \+ ' of ' \+ s\.pinned \+ ' exact\)/);   // a lost pin stays visible, now called exact
});

test('two levels of "same as live" and a stale mark: the gate counts no-extra-ask rows, /admin also counts every-ask-as-live, a row the latest run did not replay is stale', () => {
  const day = '2026-10-15T12:00:00.000Z', old = '2026-10-15T01:00:00.000Z';
  const gateOnly = {...row('a', {...good, hit: 3}), gateSame: true, at: day}, strict = {...row('b', good), gateSame: true, at: day}, lost = {...row('c', good), gateSame: true, at: old};
  const f = fidelity([gateOnly, strict, lost]);
  assert.equal(f.summary.gate, 2, 'a row replayed 11 h before the newest does not count');
  assert.equal(f.summary.network, 1, 'every ask as live: only the strict row');
  assert.equal(f.summary.stale, 1);
  assert.equal(f.rows.find(item => item.name === 'c').stale, true);
  assert.equal(f.rows.find(item => item.name === 'a').stale, undefined);
  // Owner, 15 Oct 2026: "same as live" named two numbers (32 in the headline, 4 on the chip). Now: "pass the gate" and "exact", each with its own chip counted by the same test.
  assert.match(FIDELITY_SCRIPT, /pass the gate \(no question live did not ask\)/);
  assert.match(FIDELITY_SCRIPT, /exact \(every answer identical to live\)/);
  assert.match(FIDELITY_SCRIPT, /\['gate', 'Passes gate'\], \['same', 'Exact'\]/);
  assert.match(FIDELITY_SCRIPT, /f\.rows\.filter\(r => verdictIs\(r, value\)\)/);   // chip counts and the filter use one test
  assert.doesNotMatch(FIDELITY_SCRIPT, /same as live \(the gate/);
  const gateOf = rows => rows.filter(r => r.gateSame && !r.stale && !r.answersStale).length;   // the chip's own rule, as in the page
  assert.equal(gateOf(f.rows), f.summary.gate, 'the Passes gate chip counts what the headline says');
  assert.match(FIDELITY_SCRIPT, /stale \(not replayed in the latest run\)/);
  assert.equal(cleanRecord({...row('a', good), gateSame: true}).gateSame, true);
  assert.equal('gateSame' in cleanRecord(row('a', good)), false);
});

test('the details row spans every column, and a long name is split into a title and a sub line for the 64px summary row', () => {
  const script = FIDELITY_SCRIPT.replace(/\\\\/g, '\\');
  const labels = script.match(/heads\('fidelity', \[([^\]]+)\]/)[1].split(',').length, cells = (script.match(/const main = el\('tr'[\s\S]*?\n    return on/)[0].match(/\n      el\('td'/g) || []).length;
  assert.equal(cells, labels, 'one cell per header (the first is the chevron)');
  assert.match(script, new RegExp(`colSpan: ${cells}\\b`));
  const fidParts = new Function(`return ${script.match(/const fidParts = (name => \{[\s\S]*?\};)\n/)[1].slice(0, -1)}`)();
  assert.deepEqual(fidParts('Databricks (found 2026-10-10)'), {title: 'Databricks', sub: 'Found 10 Oct 2026'});
  assert.deepEqual(fidParts('jobs.ch -> Deloitte: email-first account, email code'), {title: 'jobs.ch → Deloitte', sub: 'email-first account, email code'});
  assert.deepEqual(fidParts('Greenhouse board form'), {title: 'Greenhouse board form', sub: ''});
});

test('every pool row is listed: a row with no record says "Record", an off replay "Re-record", a deferred row its reason; recording and reason are kept clean', async () => {
  const pool = [{shape: 'a'}, {shape: 'b'}, {shape: 'never recorded'}];
  const f = fidelity([row('a', good), row('b', {...good, hit: 1}, {deferred: 'replay lags'})], pool);
  const by = Object.fromEntries(f.rows.map(item => [item.name, item]));
  assert.deepEqual(f.summary, {total: 3, recorded: 2, network: 1, snapshot: 0});
  assert.equal(by.a.next, null);
  assert.deepEqual(by.b.next, {word: 'deferred', why: 'replay lags'});
  assert.equal(by['never recorded'].next.word, 'record');
  assert.equal(fidelity([row('c', {...good, hit: 1})]).rows[0].next.word, 're-record');
  // A record under a name the pool lacks (an older one named by host, a retired row) is not a pool row: the count matches the Pool tab.
  const leftovers = fidelity([row('a', good), row('a.example.com', good), row('retired row', good)], pool);
  assert.deepEqual(leftovers.rows.map(item => item.name).sort(), ['a', 'b', 'never recorded']);
  assert.equal(leftovers.summary.total, pool.length);
  const db = d1();
  await put(db, {rows: [row('m', good, {recording: {where: 'mac', at: '2026-10-13T22:00:00Z'}, deferred: 'see https://x.test/a?b=1'}), row('n', good, {recording: {where: 'cloud'}})]});
  const kept = Object.fromEntries((await readFidelity(db)).map(item => [item.name, item]));
  assert.deepEqual(kept.m.recording, {where: 'mac', at: '2026-10-13T22:00:00.000Z'});
  assert.equal(kept.m.deferred, null, 'a reason with an address never lands');
  assert.equal(kept.n.recording, null, 'only mac or ci');
});

test('a replay measured on answers older than the prompt never replaces good numbers: the earlier record stays, labelled; with none, the stale one is stored, labelled', async () => {
  const db = d1(), badNumbers = {...good, hit: 0, extra: 3};
  assert.equal(cleanRecord(row('a', good, {answersStale: true})).answersStale, true);
  assert.equal('answersStale' in cleanRecord(row('a', good)), false);
  await put(db, {rows: [row('a', good, {gateSame: true})]});
  const answer = await put(db, {rows: [row('a', badNumbers, {answersStale: true}), row('b', badNumbers, {answersStale: true})]});
  assert.equal((await answer.json()).stored, 2);
  const kept = await readFidelity(db), a = kept.find(item => item.name === 'a'), b = kept.find(item => item.name === 'b');
  assert.equal(a.network.hit, good.hit, 'row a keeps its good numbers');
  assert.equal(a.refillPending, true, 'and says a newer replay waits');
  assert.equal(a.answersStale, undefined);
  assert.equal(b.answersStale, true, 'row b had nothing earlier: the stale numbers are stored, labelled');
  const f = fidelity(kept);
  assert.equal(f.summary.awaitingRefill, 2);
  assert.equal(f.summary.network, 1, 'a counts (its numbers are the good ones), b does not');
  assert.match(FIDELITY_SCRIPT, /waiting for the refill/);
  await put(db, {rows: [row('a', good, {at: '2026-10-15T20:00:00Z'})]});
  assert.equal((await readFidelity(db)).find(item => item.name === 'a').refillPending, undefined, 'a fresh replay replaces it, label gone');
});
