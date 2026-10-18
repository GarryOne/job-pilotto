// The Random draws tab (owner, 18 Oct 2026): the upload (key, main only, checks), the judge (floor, family median, FAILED), the tab, and the row shape from the harness. Guard for src/search-lab-draws.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {clean, draws, ingest, ingestRoute, judge, rowFromDraw} from '../src/search-lab-draws.js';
import {page} from '../src/search-lab-page.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const draw = (day, more = {}) => ({draw_date: `2026-10-${String(day).padStart(2, '0')}`, seed: `2026-10-${String(day).padStart(2, '0')}`, family: 'nurse', city: 'Lyon', country: 'France',
  build: 'abc1234', state: 'ok', first_s: 40, tenth_s: 180, fit_s: 500, in_places: 60, scored: 40, fit70: 5, ...more});
const verdicts = rows => judge([...rows].sort((a, b) => b.draw_date.localeCompare(a.draw_date))).map(row => [row.draw_date.slice(-2), row.verdict]);

test('a draw is stored once per day, re-running replaces it, free text is cut', async () => {
  const {prepare} = d1();
  assert.equal((await ingest({prepare}, draw(1))).ok, true);
  await ingest({prepare}, draw(1, {in_places: 70, city: 'Ly<on>'}));
  const rows = await draws({prepare});
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].in_places, rows[0].city, rows[0].source], [70, 'Lyon', 'ci']);
});

test('bad rows are refused with the first thing wrong', () => {
  assert.match(clean(draw(1, {draw_date: 'yesterday'})).error, /draw_date/);
  assert.match(clean(draw(1, {family: 'Nurse!'})).error, /family/);
  assert.match(clean(draw(1, {in_places: -3})).error, /in_places/);
  assert.match(clean(draw(1, {state: 'maybe'})).error, /state/);
  assert.match(clean(draw(1, {build: 'main'})).error, /build/);
});

test('the judge: the floor, the family median after 5 draws, FAILED, other families do not count', () => {
  assert.deepEqual(verdicts([draw(1, {in_places: 9})]), [['01', 'weak']]);
  assert.deepEqual(verdicts([draw(1, {first_s: null})]), [['01', 'weak']]);
  const usual = [1, 2, 3, 4, 5].map(day => draw(day, {in_places: 60}));
  assert.deepEqual(verdicts([...usual, draw(6, {in_places: 29})]).at(0), ['06', 'weak']);
  assert.deepEqual(verdicts([...usual, draw(6, {in_places: 30})]).at(0), ['06', 'usual']);
  assert.deepEqual(verdicts([...usual.slice(0, 4), draw(6, {in_places: 29})]).at(0), ['06', 'usual'], 'four earlier draws: no median yet');
  assert.deepEqual(verdicts([...usual.map(row => ({...row, family: 'welder'})), draw(6, {in_places: 29})]).at(0), ['06', 'usual'], 'welder draws are not the nurse median');
  assert.deepEqual(judge([draw(7, {state: 'failed', failed_step: 'Reading job boards'})])[0].why, ['a step crashed: Reading job boards']);
});

test('the upload needs the key and a run on main', async () => {
  const {prepare} = d1(), env = {STATS: {prepare}, REPLAYS_PUBLISH_KEY: 'k'};
  const put = (key, body) => ingestRoute(new Request('https://x/search-lab/draws', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), env);
  assert.equal((await put('wrong', {branch: 'main', draw: draw(1)})).status, 404);
  assert.equal((await put('k', {branch: 'fix', draw: draw(1)})).status, 400);
  assert.equal((await put('k', {branch: 'main', draw: draw(1)})).status, 200);
});

test('the tab shows the draws with CI on each and the Lab tab stays the default', () => {
  const html = page([], [draw(2, {in_places: 3}), draw(1)], 'draws');
  assert.match(html, /Random draws/);
  assert.match(html, />CI</);
  assert.match(html, /Weak/);
  assert.match(html, /only 3 jobs in the places/);
  assert.match(page([], [draw(1)]), /Each candidate's newest search/);
  assert.doesNotMatch(page([], [draw(1)]), /Each daily draw/);
});

test('rowFromDraw reads the harness numbers; a crash is FAILED, never thin numbers', () => {
  const info = {seed: '2026-10-18', family: 'nurse', city: 'Lyon', country: 'France'};
  const press = {in_places: 61, scored_in_places: 40, fit70_in_places: 9, ttfr: {first_in_places_s: 42, tenth_in_places_s: 190, first_fit70_s: 600}, crashes: []};
  assert.deepEqual([rowFromDraw(info, press, {build: 'abc1234'}).state, rowFromDraw(info, press, {build: 'abc1234'}).first_s], ['ok', 42]);
  assert.equal(rowFromDraw(info, {...press, crashes: [{step: 'Reading job boards', error: 'x'}]}, {build: 'abc1234'}).state, 'failed');
});
