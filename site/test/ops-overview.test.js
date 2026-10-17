// /admin/operations/overview: the category map covers every tracked file, a PR's main category, the once-only ingest and its one-row snapshot, and the page in each state.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {CATEGORIES, CATEGORY_IDS, RULES_VERSION, TOP_LEVEL, categoryOfFile, classify, prRow} from '../src/ops-categories.js';
import {RANGES, bars, bucketsOf, buildSnapshot, page, rangeOf, windowOf} from '../src/ops-overview.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const reads = {rows: 0, queries: 0, sqls: []};
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => { reads.queries++; reads.sqls.push(sql); const results = db.prepare(sql).all(...args); reads.rows += results.length; return {results}; },
    first: async () => { reads.queries++; reads.sqls.push(sql); return db.prepare(sql).get(...args); }, _sql: sql, _args: args});
  return {db, reads, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, '/ops/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const now = new Date('2026-10-15T12:00:00Z');
const pr = (number, category, at = '2026-10-15T08:00:00Z', extra = {}) => ({number, title: `PR ${number}`, mergedAt: at, category, mixed: false, lines: 100, hours: 2, ciMinutes: 10, ...extra});

test('every tracked file has a category, and every top-level path of the repo is named (add a new one to TOP_LEVEL)', () => {
  const files = execFileSync('git', ['ls-files'], {cwd: new URL('../..', import.meta.url), encoding: 'utf8', maxBuffer: 1 << 26}).split('\n').filter(Boolean);
  assert.ok(files.length > 100);
  const none = files.filter(file => !categoryOfFile(file));
  assert.deepEqual(none.slice(0, 10), [], 'files without a category: add a rule or a TOP_LEVEL entry in src/ops-categories.js');
  const tops = [...new Set(files.filter(file => file.includes('/')).map(file => file.split('/')[0]))];
  assert.deepEqual(tops.filter(top => !TOP_LEVEL[top]), [], 'top-level paths without a category');
  assert.ok(CATEGORY_IDS.every(id => CATEGORIES.find(category => category.id === id).label));
});

test('a PR gets the category of most changed non-test lines; tests alone are "tests"; no majority is "mixed"; a Pool-row trailer is a form fix only with fill code', () => {
  const f = (path, lines) => ({path, additions: lines, deletions: 0});
  assert.equal(classify([f('extension/ladder/x.js', 40), f('site/src/a.js', 10), f('desktop/test/a.test.js', 500)]).category, 'forms');
  assert.equal(classify([f('tools/a.mjs', 5), f('tests/test_a.py', 50)]).category, 'ci');
  assert.equal(classify([f('tests/test_a.py', 5), f('site/test/b.test.js', 5)]).category, 'tests');
  const mixed = classify([f('tools/a.mjs', 10), f('site/src/a.js', 10), f('docs/a.md', 10), f('desktop/main.js', 10)]);
  assert.deepEqual([mixed.category, mixed.mixed], ['mixed', true]);
  assert.equal(classify([f('docs/a.md', 5)], ['Fix']).category, 'docs');
  // A Pool-row trailer is a form fix only together with fill code (coordinator, 15 Oct 2026); then the recorded pages count with the fix; pool postings are "Pool data".
  const fix = ['Fix\n\nPool-row: Chanel Workday'];
  assert.equal(classify([f('extension/ladder/x.js', 20), f('desktop/e2e/recorded/a/page.json', 90), f('tools/a.mjs', 10)], fix).category, 'forms');   // like #838
  assert.equal(classify([f('desktop/e2e/record-sites.mjs', 90), f('tools/a.mjs', 50)], fix).category, 'replay');   // a harness PR with a trailer is not a fix
  assert.equal(classify([f('tools/a.mjs', 5)], ['Pool-row:']).category, 'ci');
  assert.equal(classify([f('desktop/e2e/recorded/a/page.json', 90)], fix).category, 'replay');   // proof alone is not a fix
  assert.equal(classify([f('desktop/e2e/recorded/a/page.json', 90), f('desktop/lib/ladder/a.js', 5)], ['Fix']).category, 'forms');
  assert.equal(classify([f('worker/src/answer-facts.js', 5), f('tools/a.mjs', 50)], fix).category, 'forms');
  assert.equal(categoryOfFile('desktop/e2e/ladder-fixtures/a.json'), 'forms');
  assert.equal(categoryOfFile('desktop/e2e/smoke-sites.json'), 'pool');
  assert.equal(classify([f('desktop/e2e/smoke-sites.json', 6)]).category, 'pool');
  assert.equal(categoryOfFile('desktop/e2e/record-sites.mjs'), 'replay');
  assert.equal(categoryOfFile('desktop/e2e/lib/extension.mjs'), 'ci');
  assert.equal(categoryOfFile('desktop/lib/ladder/moves.js'), 'forms');
  assert.equal(categoryOfFile('.claude/skills/x/SKILL.md'), 'docs');
  const row = prRow({number: 7, title: 'T', createdAt: '2026-10-15T06:00:00Z', mergedAt: '2026-10-15T09:30:00Z', files: [f('site/src/a.js', 3)], commits: []}, 12.34);
  assert.deepEqual([row.category, row.hours, row.ciMinutes, row.lines], ['site', 3.5, 12.3, 3]);
});

test('the ingest needs the key, stores each PR once, rebuilds one snapshot row, and the page reads only that row', async () => {
  const e = env();
  assert.equal((await put(e, {prs: []}, 'wrong')).status, 404);
  assert.equal((await call(e, '/ops/data')).status, 404);
  assert.equal((await put(e, {nope: 1})).status, 400);
  const prs = [pr(1, 'forms'), pr(2, 'ci'), pr(3, 'ci', '2026-10-14T10:00:00Z'), {...pr(4, 'made-up')}, {number: 'x'}];
  const first = await (await put(e, {prs})).json();
  assert.deepEqual([first.stored, first.ignored], [3, 2]);
  await put(e, {prs: [pr(1, 'ci', '2026-10-15T08:00:00Z', {lines: 9999})]});   // a repeat changes nothing
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ops_prs').get().n, 3);
  assert.equal(e.STATS.db.prepare('SELECT category FROM ops_prs WHERE number = 1').get().category, 'forms');
  const have = await (await call(e, '/ops/data', {headers: {Authorization: 'Bearer pub'}})).json();
  assert.deepEqual(have.have.sort(), [1, 2, 3]);
  e.STATS.reads.rows = 0; e.STATS.reads.queries = 0; e.STATS.reads.sqls = [];
  const response = await call(e, '/admin/operations/overview', owner);
  assert.equal(response.status, 200);
  const sql = e.STATS.reads.sqls.join('\n');
  assert.match(sql, /FROM ops_snapshot/);
  assert.doesNotMatch(sql, /FROM ops_prs/);   // the time page reads its one snapshot row, no table scan (the section tiles read the other pages' rows)
  const html = await response.text();
  assert.match(html, /Where our time goes/);
  assert.match(html, /How is engineering doing/);   // the question under the menu
  assert.match(html, /#1<\/a> PR 1/);
});

test('the page: first entry of Operations, owner only, and every state renders', async () => {
  const operations = PAGES.filter(p => p.group === 'Operations');
  assert.equal(operations[0].path, '/admin/operations/overview');
  const e = env();
  assert.equal((await call(e, '/admin/operations/overview')).status, 404);
  assert.match(await (await call(e, '/admin/operations/overview', owner)).text(), /No data yet/);   // empty
  const snapshot = {at: now.toISOString(), daily: [
    {day: '2026-10-15', category: 'forms', prs: 1, lines: 50, hours: 1, ci: 5}, {day: '2026-10-15', category: 'ci', prs: 3, lines: 300, hours: 6, ci: 30},
    {day: '2026-10-10', category: 'replay', prs: 4, lines: 400, hours: 8, ci: 40}, {day: '2026-09-10', category: 'site', prs: 9, lines: 1, hours: 1, ci: 1}], latest: [{number: 5, title: '<b>x</b>', category: 'ci', lines: 3, hours: 1.5}]};
  for (const range of Object.keys(RANGES)) assert.ok(page(snapshot, {range, now}).includes('Latest 20 merged PRs'));
  const week = windowOf(snapshot, '7d', now), month = windowOf(snapshot, '30d', now);
  assert.deepEqual([week.forms.prs, week.ci.prs, week.replay.prs], [1, 3, 4]);
  assert.deepEqual([month.site.prs], [0]);   // 2026-09-10 is outside 30 days
  assert.match(page(snapshot, {range: '7d', now}), /13%[\s\S]*1 of 8 merged PRs/);   // form-fix share: 1 of 8
  assert.ok(!page(snapshot, {now}).includes('<b>x</b>'));   // titles are escaped
  assert.match(page({at: now.toISOString(), daily: [], latest: []}, {now}), /No merged PRs in this period[\s\S]*No merged PRs yet/);
});

test('each range returns its own window: 24 hours by hour, 7 and 30 days by day; the choice comes from ?range= and defaults to 7 days', async () => {
  assert.deepEqual([rangeOf('24h'), rangeOf('30d'), rangeOf('x'), rangeOf(null)], ['24h', '30d', '7d', '7d']);
  assert.deepEqual(Object.keys(RANGES).map(range => bucketsOf(range, now).length), [24, 7, 30]);
  assert.deepEqual([bucketsOf('7d', now)[0].key, bucketsOf('7d', now)[6].key], ['2026-10-15', '2026-10-09']);
  assert.deepEqual([bucketsOf('24h', now)[0].key, bucketsOf('24h', now)[23].key], ['2026-10-15T12', '2026-10-14T13']);
  const e = env();
  await put(e, {prs: [pr(1, 'forms', '2026-10-15T11:30:00Z'), pr(2, 'ci', '2026-10-15T11:50:00Z'), pr(3, 'ci', '2026-10-14T12:30:00Z'), pr(4, 'pool', '2026-10-14T14:00:00Z'),
    pr(5, 'docs', '2026-10-10T09:00:00Z'), pr(6, 'site', '2026-09-20T09:00:00Z')]});
  const snapshot = await buildSnapshot(e.STATS, now);
  const total = range => Object.values(windowOf(snapshot, range, now)).reduce((sum, cell) => sum + cell.prs, 0);
  assert.deepEqual(['24h', '7d', '30d'].map(total), [3, 5, 6]);   // 24h = #1, #2, #4 (#3 is 24h30 old); 7d adds #3, #5; 30d adds #6 (25 days old)
  assert.equal(windowOf(snapshot, '24h', now).ci.prs, 1);
  const rows = html => html.match(/class="night"/g)?.length || 0;
  assert.equal(rows(bars(snapshot, '24h', now)), 2);   // hours with PRs only: 11:00 and 14:00
  assert.equal(rows(bars(snapshot, '7d', now)), 7);
  assert.equal(rows(bars(snapshot, '30d', now)), 30);
  const day = bars(snapshot, '7d', now);
  assert.ok(day.indexOf('15 Oct') < day.indexOf('14 Oct'));   // newest first
  assert.match(day, /<i[^>]*>1<\/i><i[^>]*>1<\/i>[\s\S]*2 PRs · top: /);   // counts inside the segments, total and top category on the right
  assert.match(day, /<div class="key"><span class="pill"/);   // legend as pills
  assert.match(barsThin(), /class="thin"/);
  const html = async range => (await (await call(e, `/admin/operations/overview${range}`, owner)).text());
  assert.match(await html(''), /aria-current="true">Last 7 days/);   // default
  assert.match(await html('?range=24h'), /aria-current="true">Last 24 hours/);
  assert.match(await html('?range=30d'), /Merged PRs per day · last 30 days/);
  assert.match(await html('?range=24h'), /Merged PRs per hour/);
  assert.match(await html('?range=bogus'), /aria-current="true">Last 7 days/);
});
function barsThin() {   // a 1-in-20 segment hides its count (shown on hover through the title)
  return bars({daily: [{day: '2026-10-15', category: 'forms', prs: 1}, {day: '2026-10-15', category: 'ci', prs: 19}]}, '7d', now);
}

test('a new rules version re-reads stored PRs and replaces their category; the same version changes nothing', async () => {
  const e = env(), auth = {headers: {Authorization: 'Bearer pub'}};
  await put(e, {rules: 1, prs: [pr(1, 'ci', '2026-10-15T08:00:00Z', {hours: 1}), pr(2, 'ci')]});
  assert.deepEqual((await (await call(e, '/ops/data?v=1', auth)).json()).have.sort(), [1, 2]);
  assert.deepEqual((await (await call(e, '/ops/data?v=2', auth)).json()).have, []);   // CI reads both again
  await put(e, {rules: 1, prs: [pr(1, 'forms')]});   // same version: ignored
  assert.equal(e.STATS.db.prepare('SELECT category FROM ops_prs WHERE number = 1').get().category, 'ci');
  await put(e, {rules: 2, prs: [pr(1, 'forms', '2026-10-15T08:00:00Z', {hours: 3})]});
  assert.deepEqual({...e.STATS.db.prepare('SELECT category, hours, rules FROM ops_prs WHERE number = 1').get()}, {category: 'forms', hours: 3, rules: 2});
  assert.deepEqual((await (await call(e, '/ops/data?v=2', auth)).json()).have, [1]);
  assert.ok(RULES_VERSION >= 3);
});
