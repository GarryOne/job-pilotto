// /admin/scouting's data to iterate on and its charts (src/scoutingvisual.js, scoutingcharts.js, scouting.js run log; owner, 19 Oct 2026:
// "store enough data ... where we're strong, where we're weak", "add more graphs", "too much of raw numbers/text/tables").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {cleanStats, load, RUNS, store} from '../src/scouting.js';
import {page, snapshot, storeSnapshot} from '../src/scoutingadmin.js';
import {bars, columns, shade, sparkline} from '../src/scoutingcharts.js';
import {AIMED, FLOOR, KINDS, demandOf, heatmap, history} from '../src/scoutingvisual.js';

function d1(...migrations) {
  const db = new DatabaseSync(':memory:');
  for (const file of migrations) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8').split('\n')
    .filter(line => file === '0099_scouting_history.sql' || !line.startsWith('ALTER')).join('\n'));   // older files alter tables made elsewhere
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const care = (i, country = 'pl') => ({company: `Care ${i}`, ats: 'lever', slug: `care${i}`, kinds: {healthcare: 0.9}, countries: [country], jobs: 4});

test('each day keeps employers and open jobs per kind × country, so the page shows the week\'s change', async () => {
  const db = d1('0029_index_daily.sql', '0099_scouting_history.sql');
  await storeSnapshot(db, '2026-10-12', snapshot([care(1)]));
  await storeSnapshot(db, '2026-10-19', snapshot([care(1), care(2), care(3, 'us')]));
  const daily = db.db.prepare('SELECT * FROM index_daily ORDER BY day DESC').all();
  assert.deepEqual(JSON.parse(daily[0].cells), {'healthcare|pl': [2, 8]}, 'European countries only');
  const past = history(daily, new Date('2026-10-19T12:00:00Z'));
  assert.equal(past.week.day, '2026-10-12');
  assert.match(heatmap({'healthcare|pl': [2, 8]}, past, {'healthcare|pl': 4}, 'healthcare|pl'),
    /data-tip="Healthcare · Poland: 2 employers, 8 open jobs · \+1 this week · 4 installs search here · 23 short of 25 · the AI ideas aim here now"/);
});

test('the run log keeps the last runs, each checked to its shape', async () => {
  const db = d1('0019_scouting.sql', '0029_index_daily.sql', '0099_scouting_history.sql');
  for (let i = 0; i < RUNS + 5; i += 1) {
    const at = new Date(Date.UTC(2026, 9, 1) + i * 6 * 3600000).toISOString().slice(0, 16);
    await store(db, {feeds: 1, run: {at, cell: 'logistics|pl', added: 7, checked: 40, found: i, extra: 'x'}}, at.slice(0, 10));
  }
  const shown = await load(db);
  assert.equal(shown.runs.length, RUNS);
  assert.deepEqual(shown.runs.at(-1), {at: '2026-10-17T00:00', cell: 'logistics|pl', added: 7, checked: 40, found: RUNS + 4});
  assert.equal(shown.runs[0].found, 5, 'the oldest five left');
  const odd = cleanStats({run: {at: 'yesterday', found: 1}, ideas_cell: 'logistics|pl<script>', source_kinds: {'Wikidata healthcare': {healthcare: 3, '<b>': 2}, bad: 'x'}});
  assert.equal(odd.run, null);
  assert.equal(odd.ideas_cell, '');
  assert.deepEqual(odd.source_kinds, {'Wikidata healthcare': {healthcare: 3, b: 2}, bad: {}});
});

test('a cell counts as searched only with 3+ installs; IT families count as software', () => {
  const rows = [{install: 'a', roles: 'healthcare,data', countries: 'de,us'}, {install: 'b', roles: 'healthcare', countries: 'de'},
    {install: 'c', roles: 'healthcare,sre_devops', countries: 'de'}, {install: 'c', roles: 'healthcare', countries: 'de'}];
  assert.deepEqual(demandOf(rows), {'healthcare|de': 3});
  assert.deepEqual(demandOf(rows, 2), {'healthcare|de': 3, 'software|de': 2});
});

test('the kinds are the engine\'s, and the scout aims at every kind but software and other', () => {
  const engine = readFileSync(new URL('../../src/role_kinds.py', import.meta.url), 'utf8').match(/^KINDS = \((.*)\)$/m)[1];
  assert.deepEqual(KINDS, [...engine.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]));
  assert.equal(FLOOR, Number(readFileSync(new URL('../../src/scout_cells.py', import.meta.url), 'utf8').match(/^FLOOR = (\d+)/m)[1]));
  assert.deepEqual(AIMED.includes('software') || AIMED.includes('other'), false);
});

test('the charts draw from the numbers and say when there is nothing yet', () => {
  assert.ok(shade(0) !== shade(FLOOR) && shade(FLOOR - 1) !== shade(FLOOR), 'the floor is where the colour steps');
  assert.match(sparkline([1, 3, 2], {label: 'Employers'}), /<path d="M3\.0,28\.0L/);
  assert.match(sparkline([], {label: 'Employers'}), /no history yet/);
  assert.match(bars([{label: 'Logistics', parts: [[5, '#3987e5', 'x']]}], {max: 10}), /width:50\.00%/);
  assert.match(bars([], {empty: 'Nothing probed yet.'}), /Nothing probed yet\./);
  assert.match(columns([{value: 2, tip: '22:20'}, {value: 0, tip: '04:20'}]), /data-tip="22:20"/);
});

test('the page leads with the charts; the tables are folded under them', () => {
  const html = page({feeds: [care(1)], daily: [], demand: {}, sharing7: 0, sharing30: 0, shared: 0, routes: [], useful: [], dead: [], deadTotal: 0,
    central: {day: '2026-10-19', feeds: 1, jobs: 4, relevant: 0, by_ats: {}, by_region: {}, queue: {}, sources: [], market: [], history: [], runs: [], source_kinds: {}}});
  const charts = ['Where the list is strong or thin', 'Gaps people search in', 'Countries at the floor, per kind', 'Each kind over time', 'Which source fills which kind', 'Yield per source', 'Central scout runs'];
  for (const title of charts) assert.ok(html.indexOf(title) > 0 && html.indexOf(title) < html.indexOf('<details'), title);
  assert.ok(html.indexOf('class="countries"') > html.indexOf('<details'), 'the number table is folded');
  assert.match(html, /No runs recorded yet\./);
});
