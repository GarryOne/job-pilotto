// The pool's top cause per shape for /admin/applying (src/applying-cause.js): found by the site name's hash, applicant gaps skipped, nothing but fixed words shown.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {hashOf, topCauses} from '../src/applying-cause.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');

test('the top mechanism cause of a shape this week, from its own pool cards only; applicant gaps and user cards never count', async () => {
  const e = d1(), hash = await hashOf('Acme Workday'), other = await hashOf('Other site');
  const add = (id, day, causes, source = 'pool') => e.db.prepare(`INSERT INTO fill_cards (id, day, board, source, causes) VALUES (?, ?, 'workday', ?, ?)`).run(id, day, source, JSON.stringify(causes));
  add(`pool-2026-10-12-${hash}`, '2026-10-12', {menu_not_opened: 3, no_data: 9});
  add(`pool-2026-10-11-${hash}`, '2026-10-11', {menu_not_opened: 1, not_taken: 2});
  add(`pool-2026-10-12-${other}`, '2026-10-12', {unread: 5});
  add(`pool-2026-09-01-${hash}`, '2026-09-01', {unread: 50});   // older than a week
  add(`user-card-${hash}`, '2026-10-12', {unread: 50}, 'user');   // a user's card is never the pool's
  assert.deepEqual(await topCauses(e, ['Acme Workday', 'Other site', 'Never run'], now), {'Acme Workday': {cause: 'menu_not_opened', lost: 4, nights: 2}, 'Other site': {cause: 'unread', lost: 5, nights: 1}});
});
