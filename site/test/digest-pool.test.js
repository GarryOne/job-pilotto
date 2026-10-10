// Pool cards (docs/superpowers/specs/2026-10-10-pool-feeds-learning.md): stored only for the owner, through the real endpoint; kept apart from every user number in the digest.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {digest, markdown} from '../src/digest.js';
import {controls} from '../src/recipes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
const env = () => ({STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api', WAITLIST: {get: async () => null, put: async () => {}}});
const send = (e, body, headers = {}) => worker.fetch(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify({install: 'pool-qa-smoke', ...body}), headers: {'Content-Type': 'application/json', ...headers}}), e, {});
const pool = (id, extra = {}) => ({id, board: 'workday', source: 'pool', v: '0.9.140', required: 10, filled: 4, left: 6, causes: {menu_not_opened: 3, no_data: 3}, kinds: {select: 3}, ai: 'none', ...extra});
const owner = {Authorization: 'Bearer api'};
// The same handler the router calls, with a chosen night (the router stamps the real day).
const night = (e, day, body) => controls(new Request('https://w.dev/api/controls', {method: 'POST', body: JSON.stringify({install: 'pool-qa-smoke', ...body}), headers: {'Content-Type': 'application/json', ...owner}}), e, new Date(`${day}T20:00:00Z`));
const rows = e => e.STATS.db.prepare('SELECT id, source, board FROM fill_cards ORDER BY id').all().map(r => ({...r}));

test('a pool card is stored with source pool for the owner key only; from anyone else it is dropped and counted, never stored as a user card', async () => {
  const e = env();
  await send(e, {cards: [pool('pool-2026-10-12-aaaa1111')]});
  await send(e, {cards: [pool('pool-2026-10-12-aaaa1111')]}, {Authorization: 'Bearer not-the-key'});
  assert.deepEqual(rows(e), []);
  assert.equal(e.STATS.db.prepare("SELECT n FROM anomalies WHERE kind = 'pool-source'").get().n, 2);
  await send(e, {cards: [pool('pool-2026-10-12-aaaa1111'), pool('not-a-pool-id-1234')]}, owner);
  await send(e, {cards: [pool('pool-2026-10-12-aaaa1111')]}, owner);   // a resend adds nothing
  assert.deepEqual(rows(e), [{id: 'pool-2026-10-12-aaaa1111', source: 'pool', board: 'workday'}]);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM host_uses').get().n, 0);   // a pool card never feeds the usage weighting
  await send(e, {cards: [{...pool('user-card-12345678'), source: undefined, host: 'x.myworkdayjobs.com'}]});
  assert.equal(e.STATS.db.prepare("SELECT source FROM fill_cards WHERE id = 'user-card-12345678'").get().source, 'user');
});

test('the digest: user numbers, boards, dropped flags and versions are identical with and without pool cards; the pool section ranks mechanism causes seen on 2+ nights', async () => {
  const e = env(), db = e.STATS;
  const user = (id, day) => db.db.prepare(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n, causes, kinds, submitted, seconds) VALUES (?, ?, 'workday', '0.9.140', 10, 8, 2, '{"menu_not_opened":2}', '{"select":2}', 1, 40)`).run(id, day);
  for (let i = 0; i < 6; i++) user(`user-card-${i}-aaaa`, i < 3 ? '2026-10-12' : '2026-10-08');
  const before = await digest(db, now);
  const {pool: empty, ...userBefore} = before;
  assert.equal(empty.forms, 0);
  await night(e, '2026-10-12', {cards: [pool('pool-2026-10-12-aaaa1111'), pool('pool-2026-10-12-bbbb2222', {board: 'h:0123456789', causes: {not_taken: 2}})]});
  await night(e, '2026-10-11', {cards: [pool('pool-2026-10-11-aaaa1111')]});   // second night: workday menu_not_opened ranks; the other board was seen once
  const after = await digest(db, now);
  const {pool: section, ...userAfter} = after;
  assert.equal(JSON.stringify(userAfter), JSON.stringify(userBefore));   // byte-identical: nothing users see moved
  assert.deepEqual(section.weaknesses.map(w => [w.id, w.nights, w.poolOnly, w.seenByUsers.forms]), [['pool:menu_not_opened:workday', 2, false, 6]]);
  assert.deepEqual(section.seenOnce.map(w => w.id), ['pool:not_taken:h:0123456789']);
  assert.equal(section.applicantGaps, 6);   // no_data counted, never ranked
  assert.ok(!section.weaknesses.some(w => w.cause === 'no_data'));
  assert.match(markdown(after), /## Pool/);
});

test('a pool-only weakness says no user has hit it yet', async () => {
  const e = env();
  await night(e, '2026-10-12', {cards: [pool('pool-2026-10-12-aaaa1111', {board: 'ashby'})]});
  await night(e, '2026-10-11', {cards: [pool('pool-2026-10-11-aaaa1111', {board: 'ashby'})]});
  const d = await digest(e.STATS, now);
  assert.equal(d.pool.weaknesses[0].poolOnly, true);
  assert.match(markdown(d), /pool only: no user has hit it yet/);
});
