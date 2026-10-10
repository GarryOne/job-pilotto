// The platform scorecard on /admin/applying (src/scorecard.js): one row per platform joining real use (matched jobs, the fill cards the form-filling digest reads) with the
// pool's tests, and one fixed verdict that says what to do next. Guard: this file.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {platformScorecard, VERDICTS} from '../src/scorecard.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-10T12:00:00Z');
const feed = (env, ats, hits, slug) => env.db.exec(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, hits) VALUES ('i1', '2026-10-09', '${ats}', '${slug}', 'c', 1, 0, '', '', ${hits})`);
const cards = (env, board, n, required, filled) => { for (let i = 0; i < n; i += 1) env.db.exec(`INSERT INTO fill_cards (id, day, board, version, required, filled, left_n) VALUES ('${board}-${i}', '2026-10-09', '${board}', 'v', ${required}, ${filled}, ${required - filled})`); };
const site = (platform, reached) => ({name: `${platform}-${reached}`, platform, reached, start: '', end: ''});

test('each platform gets one verdict from real use and the pool\'s tests; the ones to act on come first', async () => {
  const env = d1();
  feed(env, 'workday', 120, 'a'); feed(env, 'greenhouse', 60, 'b'); feed(env, 'ashby', 20, 'c'); feed(env, 'lever', 10, 'd'); feed(env, 'workable', 10, 'e');
  cards(env, 'greenhouse', 6, 10, 3);   // real users: 30% of required questions filled
  cards(env, 'lever', 6, 10, 9);        // 90%
  cards(env, 'workable', 6, 10, 2);     // 20%
  const pool = [site('Greenhouse', 'form'), site('Greenhouse', 'ready'), site('Greenhouse', 'form'), site('Ashby', 'posting'), site('Lever', 'form'), site('Workable', 'posting')];
  const rows = await platformScorecard(env, pool, now);
  assert.deepEqual(rows.map(row => [row.platform, row.verdict]), [['Workday', 'Not in the pool'], ['Workable', 'Weak in both'], ['Greenhouse', 'Blind spot'], ['Ashby', 'Test failing'], ['Lever', 'Fine']]);
  const workday = rows[0], greenhouse = rows[2];
  assert.deepEqual([workday.poolSites, workday.poolReached, workday.forms, workday.filledShare], [0, null, 0, null]);
  assert.deepEqual([greenhouse.poolSites, greenhouse.poolReached, greenhouse.forms, greenhouse.filledShare], [3, 100, 6, 30]);
  assert.ok(rows.every(row => VERDICTS.includes(row.verdict)), 'only fixed verdicts');
});

test('too few real forms is no evidence: the platform is judged by the pool alone', async () => {
  const env = d1();
  feed(env, 'lever', 50, 'a');
  cards(env, 'lever', 2, 10, 1);   // 2 forms, 10%: not enough to call a blind spot
  const rows = await platformScorecard(env, [site('Lever', 'form')], now);
  assert.deepEqual([rows[0].verdict, rows[0].filledShare], ['Fine', null]);
});

test('nothing real and nothing tested gives an empty scorecard', async () => {
  assert.deepEqual(await platformScorecard(d1(), [], now), []);
});
