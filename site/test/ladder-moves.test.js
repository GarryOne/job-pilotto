// The ladder's learned moves (src/ladder-moves.js, spec docs/superpowers/specs/2026-10-12-one-next-move.md phase 1): an install's learning batch stores its `ladder` rows as 'user';
// the CI pool and the replays send theirs marked 'ci' / 'replay', stored only with CI's narrow key or the owner's, never as a user's; fixed values only; the owner reads them per source.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {controls} from '../src/recipes.js';
import {cleanMove, movesView, readMoves} from '../src/ladder-moves.js';

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
const rows = e => e.STATS.db.prepare('SELECT shape, rung, kind, outcome, source, who, hits, misses FROM ladder_moves ORDER BY source, who, shape').all().map(row => ({...row}));
const FORM = {shape: 'jobs.lever.example/acme/*|f8+', rung: 2, kind: 'form', outcome: 'form', hits: 2, misses: 0};
const POSTING = {shape: 'careers.example.ch/jobs/*|0', rung: 3, kind: 'posting', outcome: 'form', hits: 1, misses: 1};
const CI = {Authorization: 'Bearer ci-key'};

test('an install\'s ladder rows are stored as user moves under its hashed install, adding up', async () => {
  const e = env();
  assert.equal((await (await send(e, {install: 'install-aaaa-1111', ladder: [FORM]})).json()).ladder, 1);
  await send(e, {install: 'install-aaaa-1111', ladder: [{...FORM, hits: 1, misses: 1}]});
  await send(e, {install: 'install-bbbb-2222', ladder: [FORM, POSTING]});
  const stored = rows(e);
  assert.equal(stored.length, 3, 'one row per install, shape and decision');
  const of = shape => stored.filter(row => row.shape === shape).map(row => [row.hits, row.misses]).sort();
  assert.deepEqual([of(FORM.shape), of(POSTING.shape)], [[[2, 0], [3, 1]], [[1, 1]]]);
  assert.ok(stored.every(row => row.source === 'user' && /^[0-9a-f]{16}$/.test(row.who)), 'the install is never stored as it came');
});

test('test moves are stored with their source only with CI\'s key or the owner\'s; claimed by anyone else they are dropped and flagged, never stored as a user\'s', async () => {
  const e = env();
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '123', ladder: [FORM]});   // no key
  await send(e, {install: 'ci-test-moves', source: 'replay', ladder: [FORM]}, {Authorization: 'Bearer wrong'});
  assert.deepEqual(rows(e), []);
  assert.equal(e.STATS.db.prepare("SELECT SUM(n) AS n FROM anomalies WHERE kind = 'ladder-source'").get().n, 2);
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '123', ladder: [FORM]}, CI);
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '123', ladder: [FORM]}, CI);   // a re-sent run adds nothing
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '124', ladder: [FORM]}, CI);
  await send(e, {install: 'replay-test-moves', source: 'replay', ladder: [POSTING]}, CI);
  await send(e, {install: 'replay-test-moves', source: 'replay', ladder: [POSTING]}, {Authorization: 'Bearer api'});   // the owner may send them too; the same replay move is kept once
  assert.deepEqual(rows(e).map(row => [row.source, row.who, row.hits]), [['ci', 'ci:123', 2], ['ci', 'ci:124', 2], ['replay', 'replay', 1]]);
  assert.equal(e.WAITLIST.map.size, 0, 'a keyed test batch writes no daily counter (KV)');
});

test('only fixed values are stored: a shape with a query or text, a kind or outcome outside the lists, a rung out of range is dropped', async () => {
  const e = env();
  const bad = [{...FORM, shape: 'https://x.example/a?token=1'}, {...FORM, shape: 'jane@x.example|0'}, {...FORM, kind: 'Send your CV'}, {...FORM, outcome: 'jane@x.example'},
    {...FORM, rung: 7}, {...FORM, rung: -1}, {...FORM, rung: '2'}, {...FORM, hits: -3}, null, 'text'];
  const reply = await (await send(e, {install: 'install-aaaa-1111', ladder: [...bad, {...FORM, extra: 'Send your CV to jane@x.example'}]})).json();
  assert.equal(reply.ladder, 1);
  assert.ok(!JSON.stringify(rows(e)).match(/jane|token|CV/));
  assert.deepEqual(cleanMove({...FORM, kind: ''}), {...FORM, kind: ''}, 'an older app sends no kind');
  assert.equal(cleanMove({...FORM, hits: 0, misses: 0}), null, 'nothing confirmed, nothing missed: nothing to store');
});

test('the owner reads the moves per shape and decision, each source apart; nobody else does', async () => {
  const e = env();
  await send(e, {install: 'install-aaaa-1111', ladder: [FORM]});
  await send(e, {install: 'install-bbbb-2222', ladder: [FORM]});
  await send(e, {install: 'ci-test-moves', source: 'ci', run: '7', ladder: [FORM, POSTING]}, CI);
  const read = await readMoves(e.STATS);
  assert.deepEqual(read.find(row => row.shape === FORM.shape), {shape: FORM.shape, rung: 2, kind: 'form', outcome: 'form', last_day: '2026-10-12',
    user: {n: 2, hits: 4, misses: 0}, ci: {n: 1, hits: 2, misses: 0}, replay: {n: 0, hits: 0, misses: 0}});
  assert.equal((await movesView(new Request('https://w.dev/api/ladder-moves'), e)).status, 404);
  const view = await (await movesView(new Request('https://w.dev/api/ladder-moves', {headers: {Authorization: 'Bearer api'}}), e)).json();
  assert.deepEqual([view.ok, view.moves.length, view.totals], [true, 2, {shapes: 2, user: 1, ci: 2, replay: 0}]);
});
