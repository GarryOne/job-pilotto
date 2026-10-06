// The owner's admin area (src/admin.js, src/overview.js, src/trends.js): every private page under /admin with one menu, the old
// addresses redirected for the owner only, a trend per section of /admin/app and /admin/insights, and the overview.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES, byWeek, spark, weekOf} from '../src/admin.js';
import {report} from '../src/overview.js';
import {appTrends, insightTrends} from '../src/trends.js';

// D1 on real SQLite with every migration, in order, as the deploy applies them.
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})},
  ASSETS: {fetch: () => new Response('asset')}, fetcher: async () => new Response('', {status: 503})});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const get = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.workers.dev${path}`, init), e, {});
const now = new Date('2026-10-12T12:00:00Z');

test('the old addresses send the owner to /admin (query kept); anyone else still gets a 404', async () => {
  const e = env();
  for (const page of PAGES.filter(p => p.old)) {
    assert.equal((await get(e, page.old)).status, 404, page.old);
    const moved = await get(e, `${page.old}?days=7`, owner);
    assert.deepEqual([moved.status, moved.headers.get('Location')], [301, `${page.path}?days=7`], page.old);
  }
  // What the workflows call is not a page and does not move.
  assert.notEqual((await get(e, '/self-heal/data', {method: 'PUT', body: '{}'})).status, 301);
});

test('every admin page is the owner\'s only and carries the same menu, its own entry marked', async () => {
  const e = env();
  for (const page of PAGES) {
    assert.equal((await get(e, page.path)).status, 404, page.path);
    const response = await get(e, page.path, owner);
    const html = await response.text();
    assert.equal(response.status, 200, `${page.path}: ${html.slice(0, 200)}`);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
    // Grouped menu (6 Oct 2026): every group is one click away, and so is every page of this page's own group.
    for (const other of PAGES.filter(item => item.group === page.group)) assert.ok(html.includes(`href="${other.path}"`), `${page.path} links ${other.path}`);
    for (const group of new Set(PAGES.map(item => item.group))) assert.ok(PAGES.some(item => item.group === group && html.includes(`href="${item.path}"`)), `${page.path} reaches ${group}`);
    assert.match(html, new RegExp(`href="${page.path}" aria-current="page"`), page.path);
    assert.equal((html.match(/class="admin-nav"/g) || []).length, 1, page.path);
  }
});

test('weeks: today is week 0, oldest first in a series, and the chart marks this week with an arrow against the last', () => {
  assert.deepEqual([weekOf('2026-10-12', now), weekOf('2026-10-06', now), weekOf('2026-10-05', now)], [0, 0, 1]);
  assert.deepEqual(byWeek([{day: '2026-10-12', n: 2}, {day: '2026-10-01', n: 5}], now, list => list.reduce((s, r) => s + r.n, 0), 3), [0, 5, 2]);
  assert.match(spark([5, 2]), /▼/);
  assert.match(spark([2, 5], {higherIsBetter: false}), /class="down">▲/);
});

test('each section of /admin/app and /admin/insights has its weeks, from the tables already kept', async () => {
  const e = env(), db = e.STATS.db;
  db.prepare("INSERT INTO telemetry VALUES ('2026-10-11', 'x', 'health', 'i1', '0.8', 'mac', 'f', '', '{\"runsOk\":3}'), ('2026-10-04', 'x', 'health', 'i2', '0.8', 'mac', 'f', '', '{}'), ('2026-10-11', 'x', 'crash', 'i1', '0.8', 'mac', 'boom', 'Boom', '{}')").run();
  db.prepare("INSERT INTO intel_fix_days VALUES ('2026-10-10', 10, 2), ('2026-10-03', 10, 5)").run();
  const app = await appTrends(e.STATS, now), insights = await insightTrends(e.STATS, now);
  assert.deepEqual([app.machines.values.at(-1), app.machines.values.at(-2), app.helped.values.at(-1), app.problems.values.at(-1)], [1, 1, 3, 1]);
  assert.deepEqual(insights.fixes.values.slice(-2), [0.5, 0.2]);
  for (const series of [...Object.values(app), ...Object.values(insights)]) assert.equal(series.values.length, 8, series.label);
  const html = await (await get(e, '/admin/app?days=30', owner)).text();
  assert.equal((html.match(/class="trend"/g) || []).length, 10);
  const intel = await (await get(e, '/admin/insights', owner)).text();
  assert.equal((intel.match(/class="trend"/g) || []).length, 9);
});

test('the overview: a card per page and what needs attention, pulled from their numbers', async () => {
  const e = env(), db = e.STATS.db;
  db.prepare("INSERT INTO telemetry VALUES ('2026-10-11', 'x', 'crash', 'i1', '0.8', 'mac', 'newbug', 'Boom', '{}')").run();
  db.prepare("INSERT INTO lab_runs (day, site, fingerprint, kind, recipe, ok, why, url) VALUES ('2026-10-11', 'ashby', 'abc123def', 'question', 0, 0, 'question on the page not read', ''), ('2026-10-04', 'ashby', 'abc123def', 'question', 0, 1, '', '')").run();
  db.prepare("INSERT INTO selfheal_snapshots VALUES ('2026-10-11', 'x', '{\"totals\":{\"precision\":0.6},\"recall\":{\"caught\":14,\"planted\":15,\"missed\":[\"x\"]}}')").run();
  db.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact) VALUES ('2026-10-11T10:00:00Z', '2026-10-11', 'i1', '0.8', 'mac', 'hello', '')").run();
  const data = await report(e.STATS, now);
  const texts = data.attention.map(item => `${item.page} ${item.text}`);
  for (const want of ['/admin/app 1 new problem', '/admin/form-filling 1 required question', 'Form reading fell from 100% to 0%', '/admin/self-healing Self-healing missed 1 of 15', '/admin/feedback 1 feedback message'])
    assert.ok(texts.some(text => text.includes(want)), want);
  const html = await (await get(e, '/admin', owner)).text();
  for (const page of PAGES.filter(p => p.path !== '/admin' && !p.superadmin)) assert.ok(html.includes(`class="card dash" href="${page.path}"`), page.path);
  assert.match(html, /recall 14\/15/);
});

test('an empty database: every page and the overview still render', async () => {
  const e = env();
  const html = await (await get(e, '/admin', owner)).text();
  assert.match(html, /Nothing needs you this week/);
});

// Every admin page says, under the menu, the question it answers (owner, 6 Oct 2026): a new page without one fails here.
test('every admin page has its question, shown under the menu', async () => {
  const {PAGES, withNav} = await import('../src/admin.js');
  for (const page of PAGES) assert.ok(page.question && page.question.endsWith('?'), `${page.path} has no question`);
  const html = withNav('<html><head></head><body><main>x</main></body></html>', '/admin/insights');
  assert.match(html, /class="admin-question">Does the app make good decisions for users\?</);
});
