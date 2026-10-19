// The Lab's "Real installs" tab (src/search-lab-real.js), on seeded rows of the exact shape /report/telemetry stores for a 'search' report: medians per role
// family, the lab's median beside them, a city only when 3+ installs share it, the empty state, and the tab in the page.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {judge} from '../src/search-lab-judge.js';
import {page} from '../src/search-lab-page.js';
import {realRows, realSection, summarize} from '../src/search-lab-real.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const report = (install, more = {}) => ({kind: 'search', install, version: '0.9.0', platform: 'darwin', at: '2026-10-19T10:00:00Z', family: 'hospitality', country: 'CH', city: 'zurich',
  in_places: 40, scored: 12, fit70: 3, first_s: 9, tenth_s: 41, first_fit70_s: 77, nth: 1, runs_to_fit70: 1, engine: 'api', trigger: 'first', ...more});
const send = (env, events) => worker.fetch(new Request('https://www.jobpilotto.top/report/telemetry', {method: 'POST', body: JSON.stringify({events})}), env, {});
const lab = (candidate, more = {}) => ({candidate, label: candidate, run_at: '2026-10-18T10:00:00Z', build: 'abc1234', state: 'ok', first_s: 40, tenth_s: 184, fit_s: 557, in_places: 77, scored: 44, fit70: 2, ...more});

test('reports sent as the app sends them come back as medians per family, next to the lab\'s', async () => {
  const env = {STATS: d1(), ASSETS: {fetch: () => new Response('asset')}};
  assert.equal((await send(env, [report('install-aaaa'), report('install-bbbb', {first_s: 21, first_fit70_s: null, fit70: 0}), report('install-cccc', {family: 'software', city: 'berlin', country: 'DE'})])).status, 200);
  const rows = await realRows(env.STATS, new Date('2026-10-20T00:00:00Z'));
  assert.equal(rows.length, 3);
  const s = summarize(rows);
  assert.deepEqual(s.families.map(f => [f.family, f.installs, f.searches, f.first_s, f.reached]), [['hospitality', 2, 2, 9, 1], ['software', 1, 1, 9, 1]]);
  const html = realSection(rows, judge([lab('a')]));
  assert.match(html, /Time to first job/);
  assert.match(html, /lab median 40 s/);
  assert.match(html, /Hospitality/);
});

test('a city is shown only when 3+ installs share it', () => {
  const two = ['a', 'b'].map(i => ({...report(`install-${i}`)}));
  assert.deepEqual(summarize(two).cities, []);
  assert.ok(!realSection(two).includes('zurich'));
  const three = ['a', 'b', 'c'].map(i => ({...report(`install-${i}`)}));
  assert.equal(summarize(three).cities[0].installs, 3);
  assert.match(realSection(three), /zurich, CH/);
  assert.equal(summarize([...two, ...two]).cities.length, 0, 'two installs searching twice are still two installs');
});

test('the tab is in the page, empty it says nothing arrived yet, and it holds no free text', () => {
  const html = page([], [], 'real', []);
  assert.match(html, /href="\?tab=real"[^>]*>Real installs/);
  assert.deepEqual([...html.matchAll(/<nav class="tabs">([\s\S]*?)<\/nav>/g)][0][1].match(/>[^<]+<\/a>/g), ['>Real installs</a>', '>Random draws</a>', '>Experiments</a>', '>Replays</a>', '>Needs a fix</a>', '>Fixed</a>', '>History</a>']);
  assert.match(html, /No real search reported yet/);
  const full = page([lab('a')], [], 'real', [report('install-aaaa')]);
  assert.match(full, /Hospitality/);
  assert.ok(!/Acme|https?:\/\/(?!www\.jobpilotto)/.test(full.replace(/<style>[\s\S]*?<\/style>/, '')));
});
