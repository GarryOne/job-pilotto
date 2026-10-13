// What the fill ladder's control repairs did (src/repair-evidence.js, spec docs/superpowers/specs/2026-10-12-fill-ladder.md PR D2): an install's batch stores its `repairs` as 'user' under its hashed
// install, adding up; the CI pool and the replays send theirs marked 'ci' / 'replay' (CI's key only, a re-sent run adds nothing); fixed values only; the owner reads them per source, and a
// fingerprint three installs used is a fixed row.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {controls} from '../src/recipes.js';
import {SOURCES as MOVE_SOURCES, movesView} from '../src/ladder-moves.js';
import {K_MIN, SOURCES, cleanRepair} from '../src/repair-evidence.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const map = new Map(); return {map, get: async key => map.get(key) ?? null, put: async (key, value) => { map.set(key, value); }}; };
const env = () => ({STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', REPLAYS_PUBLISH_KEY: 'ci-key', WAITLIST: kv()});
const now = new Date('2026-10-12T12:00:00Z');
const send = (e, body, headers = {}, at = now) => controls(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify(body), headers: {'Content-Type': 'application/json', ...headers}}), e, at);

const rows = e => e.STATS.db.prepare('SELECT fp, verb, source, who, ok, failed FROM repair_evidence ORDER BY source, who, fp').all().map(row => ({...row}));
const FIX = {fp: 'k3x9a1', verb: 'retype', ok: 2, failed: 0};
const CI = {Authorization: 'Bearer ci-key'};

test('an install\'s repair rows are stored as user rows under its hashed install, adding up', async () => {
  const e = env();
  assert.equal((await (await send(e, {install: 'install-aaaa-1111', repairs: [FIX]})).json()).repairs, 1);
  await send(e, {install: 'install-aaaa-1111', repairs: [{...FIX, ok: 1, failed: 1}]});
  assert.deepEqual(rows(e).map(row => [row.source, row.ok, row.failed]), [['user', 3, 1]]);
  assert.ok(rows(e).every(row => /^[0-9a-f]{16}$/.test(row.who)), 'the install is never stored as it came');
});

test('test repairs are stored with their source only with CI\'s key; a re-sent run adds nothing', async () => {
  const e = env();
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '123', repairs: [FIX]});   // no key
  assert.deepEqual(rows(e), []);
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '123', repairs: [FIX]}, CI);
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '123', repairs: [FIX]}, CI);
  await send(e, {install: 'replay-test-moves', source: 'replay', repairs: [FIX]}, CI);
  assert.deepEqual(rows(e).map(row => [row.source, row.who, row.ok]), [['ci', 'ci:123', 2], ['replay', 'replay', 2]]);
});

test('only fixed values are stored: a fingerprint or verb with text, negative or missing counts, an empty tally is dropped', () => {
  for (const bad of [{...FIX, fp: 'jane@x.example'}, {...FIX, fp: 'a'}, {...FIX, verb: 'Send your CV'}, {...FIX, ok: -1}, {...FIX, ok: '2'}, {...FIX, ok: 0, failed: 0}, null, 'text']) assert.equal(cleanRepair(bad), null, JSON.stringify(bad));
  assert.deepEqual(cleanRepair({...FIX, extra: 'Send your CV to jane@x.example'}), FIX, 'a key outside the list is not kept');
});

test('the owner sees every repair per source; a fingerprint used by three installs is fixed; the source lists are the same as the moves\'', async () => {
  assert.deepEqual(SOURCES, MOVE_SOURCES);
  const e = env();
  for (let i = 0; i < K_MIN; i++) await send(e, {install: `install-aaaa-000${i}`, repairs: [FIX, {fp: 'zz11aa', verb: 'commit', ok: 0, failed: 1}]});
  await send(e, {install: 'install-aaaa-9999', repairs: [{fp: 'zz11aa', verb: 'commit', ok: 1, failed: 0}]});
  const view = await (await movesView(new Request('https://w.dev/api/ladder-moves', {headers: {Authorization: 'Bearer api'}}), e)).json();
  const byFp = Object.fromEntries(view.repairs.map(row => [row.fp, row]));
  assert.deepEqual([byFp.k3x9a1.user.n, byFp.k3x9a1.fixed], [K_MIN, true]);
  assert.deepEqual([byFp.zz11aa.user.n, byFp.zz11aa.user.ok, byFp.zz11aa.user.failed], [K_MIN + 1, 1, K_MIN]);
  assert.equal((await movesView(new Request('https://w.dev/api/ladder-moves'), e)).status, 404);
});
