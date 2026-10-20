// GET /api/coverage: the website's public numbers (owner, 20 Oct 2026: "share some interesting stats ... how many jobs, what industries,
// what locations"), from the central list's daily snapshot. Counts only: never an employer, never anything from an install.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';
import {snapshot, storeSnapshot} from '../src/scoutingadmin.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0029_index_daily.sql', '0099_scouting_history.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {prepare: sql => statement(sql)};
}
const feed = (i, kind, countries, jobs = 10) => ({company: `Secret Employer ${i}`, ats: 'lever', slug: `secret${i}`, kinds: {[kind]: 0.9}, countries, jobs});
const get = env => worker.fetch(new Request('https://www.jobadabra.top/api/coverage'), env, {});

test('the coverage numbers: employers, open jobs in Europe, countries and kinds from the latest snapshot, the week\'s growth, no names', async () => {
  const STATS = d1();
  await storeSnapshot(STATS, '2026-10-13', snapshot([feed(1, 'software', ['de'])]));
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'software', ['de']), feed(2, 'healthcare', ['fr', 'de'], 4), feed(3, 'other', ['pl']),
    feed(4, 'logistics', ['us'])]));
  const res = await get({STATS});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control'), /public, max-age=3600/);
  const body = await res.json();
  assert.deepEqual(body, {day: '2026-10-20', employers: 4, jobs_europe: 28, country_count: 3, week_added: 3,
    countries: [['Germany', 2], ['France', 1], ['Poland', 1]],
    kinds: [['Healthcare', 2], ['Software & IT', 1]], other_kinds: 1});
  assert.doesNotMatch(JSON.stringify(body), /Secret|lever|secret/, 'never an employer');
});

test('before any snapshot, or without the database: 404, and the pages keep their written numbers', async () => {
  assert.equal((await get({STATS: d1()})).status, 404);
  assert.equal((await get({})).status, 404);
});

test('a week of history is needed for the growth; without it the field is left out', async () => {
  const STATS = d1();
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'software', ['de'])]));
  assert.equal((await (await get({STATS})).json()).week_added, undefined);
});
