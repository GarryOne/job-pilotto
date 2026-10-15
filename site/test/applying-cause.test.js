// The pool's top cause per shape for /admin/lab-form-filling (src/applying-cause.js): found by the site name's hash, applicant gaps skipped, nothing but fixed words shown.
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

test('the top mechanism cause of a shape, from its newest run\'s own pool card only; applicant gaps and user cards never count', async () => {
  const e = d1(), hash = await hashOf('Acme Workday'), other = await hashOf('Other site');
  const add = (id, day, causes, source = 'pool') => e.db.prepare(`INSERT INTO fill_cards (id, day, board, source, causes) VALUES (?, ?, 'workday', ?, ?)`).run(id, day, source, JSON.stringify(causes));
  add(`pool-2026-10-12-${hash}`, '2026-10-12', {menu_not_opened: 3, no_data: 9});
  add(`pool-2026-10-11-${hash}`, '2026-10-11', {menu_not_opened: 1, not_taken: 2});
  add(`pool-2026-10-12-${other}`, '2026-10-12', {unread: 5});
  add(`pool-2026-09-01-${hash}`, '2026-09-01', {unread: 50});   // older than a week
  add(`user-card-${hash}`, '2026-10-12', {unread: 50}, 'user');   // a user's card is never the pool's
  assert.deepEqual(await topCauses(e, ['Acme Workday', 'Other site', 'Never run'], now), {'Acme Workday': {cause: 'menu_not_opened', lost: 3, nights: 1}, 'Other site': {cause: 'unread', lost: 5, nights: 1}});
});

// The newest run decides (owner, 15 Oct 2026): a cause counted over older nights kept fixed rows on their old cause. Each case: the site's cards by day, the day of its newest run
// (null: not given), the cause the page shows.
const NEWEST = [
  ['Breitling: no_option nights ago, the newest night names another', {'2026-10-10': {no_option: 4}, '2026-10-11': {no_option: 3}, '2026-10-14': {not_kept_after_tries: 1}}, '2026-10-14', 'not_kept_after_tries'],
  ['HelloFresh: no_option on two nights, the newest says not_kept_after_tries', {'2026-10-11': {no_option: 2}, '2026-10-12': {no_option: 2}, '2026-10-14': {not_kept_after_tries: 1}}, null, 'not_kept_after_tries'],
  ['Lever: unread on an old night, the newest night has no cause', {'2026-10-11': {unread: 6}, '2026-10-14': {}}, '2026-10-14', null],
  ['a site whose newest run has no card keeps no old cause', {'2026-10-11': {unread: 6}}, '2026-10-14', null],
  ['the newest night alone: one cause there is kept', {'2026-10-14': {menu_not_opened: 2}}, '2026-10-14', 'menu_not_opened'],
];
test('the cause is the newest run\'s, never counted over older nights', async () => {
  for (const [label, cards, day, cause] of NEWEST) {
    const e = d1(), name = 'Row ' + label, hash = await hashOf(name);
    for (const [cardDay, causes] of Object.entries(cards)) e.db.prepare(`INSERT INTO fill_cards (id, day, board, source, causes) VALUES (?, ?, 'x', 'pool', ?)`).run(`pool-${cardDay}-${hash}`, cardDay, JSON.stringify(causes));
    const got = (await topCauses(e, [name], new Date('2026-10-15T12:00:00Z'), day ? {[name]: day} : {}))[name];
    assert.equal(got ? got.cause : null, cause, label);
  }
});
