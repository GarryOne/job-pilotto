// /admin/benchmark-form-filling: the scores (raw, product, ceiling), the segments that are never added together, the ingest, the page in each state, and that a page load reads one snapshot row.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {summarize, totals} from '../src/benchmark-data.js';
import {page} from '../src/benchmark-page.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const reads = {rows: 0, queries: 0};
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => { reads.queries++; const results = db.prepare(sql).all(...args); reads.rows += results.length; return {results}; },
    first: async () => { reads.queries++; const row = db.prepare(sql).get(...args); reads.rows += row ? 1 : 0; return row; }, _sql: sql, _args: args});
  return {db, reads, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, '/benchmark/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});

// Anonymised fixture data: names are made up, as the real ones only ever arrive as data.
const run = (tool, form, right, wrong, required, extra = {}) => ({id: `${form}/${tool}/${extra.build || ''}${extra.at || ''}${extra.applicant || ''}${extra.mode || ''}`, at: '2026-10-15T10:00:00Z', applicant: 'thin', mode: 'user', tool, ours: false, build: '', form,
  required, right, wrong, empty: required - right - wrong, unans: 2, holds: 1, dups: 0, ...extra});
const FIXTURE = [
  run('Our extension', 'Form A', 5, 1, 10, {ours: true, build: 'bbb2222'}), run('Our extension', 'Form B', 10, 0, 16, {ours: true, build: 'bbb2222'}),
  run('Our extension', 'Form A', 5, 0, 10, {ours: true, build: 'aaa1111', at: '2026-10-14T10:00:00Z'}), run('Our extension', 'Form B', 4, 1, 16, {ours: true, build: 'aaa1111', at: '2026-10-14T10:00:00Z'}),
  run('Tool X', 'Form A', 4, 0, 10), run('Tool X', 'Form B', 11, 0, 16), run('Tool Y', 'Form A', 6, 2, 10),
  run('Our extension', 'Form A', 9, 0, 10, {ours: true, build: 'ccc3333', applicant: 'grown'}),
  run('Our extension', 'Form A', 8, 0, 10, {ours: true, build: 'ddd4444', mode: 'harness'}),
];

test('raw = right / required, product leaves out unanswerable + holds + duplicates, ceiling = (required - unanswerable) / required', () => {
  const t = totals([{required: 10, right: 5, wrong: 1, empty: 4, unans: 2, holds: 1, dups: 0, at: 'x'}, {required: 16, right: 10, wrong: 0, empty: 6, unans: 2, holds: 1, dups: 3, at: 'x'}]);
  assert.deepEqual([t.raw, t.product, t.ceiling, t.countable], [58, 88, 85, 17]);
  assert.equal(totals([{required: 0, right: 0, wrong: 0, empty: 0, unans: 0, holds: 0, dups: 0, at: 'x'}]).raw, null);
});

test('thin and grown, user and harness, are separate views; ours is the newest build; the trend has one point per build; a re-run replaces the older run of a form', () => {
  const s = summarize(FIXTURE.map(row => ({...row, ours: row.ours ? 1 : 0}))).segments;
  assert.deepEqual(Object.keys(s).sort(), ['grown:user', 'thin:harness', 'thin:user']);
  const thin = s['thin:user'];
  assert.deepEqual(thin.tools.map(tool => tool.tool), ['Our extension', 'Tool Y', 'Tool X']);   // the others, best raw score first: Y 60%, X 58%
  assert.equal(thin.tools[0].build, 'bbb2222');
  assert.deepEqual(thin.trend.map(point => point.build), ['aaa1111', 'bbb2222']);
  assert.equal(thin.tools[0].forms, 2);
  assert.equal(s['grown:user'].tools[0].right, 9);   // never added to the thin ones
  assert.deepEqual(s['thin:harness'].tools.map(tool => tool.tool), ['Our extension', 'Tool Y', 'Tool X']);
  assert.equal(s['grown:user'].tools.length, 1);
  assert.deepEqual(thin.forms, ['Form A', 'Form B']);
  const again = summarize([...FIXTURE, run('Tool X', 'Form A', 9, 0, 10, {at: '2026-10-16T10:00:00Z'})].map(row => ({...row, ours: row.ours ? 1 : 0}))).segments['thin:user'];
  assert.equal(again.grid['Tool X']['Form A'].right, 9);   // the newer run of that form
  assert.equal(again.tools.find(tool => tool.tool === 'Tool X').forms, 2);
});

test('the ingest needs the publish key, drops bad rows, stores a run once, and rebuilds one snapshot row', async () => {
  const e = env();
  assert.equal((await put(e, {runs: FIXTURE}, 'wrong')).status, 404);
  assert.equal((await put(e, {nope: 1})).status, 400);
  const reply = await (await put(e, {runs: [...FIXTURE, {id: 'bad', at: 'nope', tool: 'T', form: 'F'}, {...FIXTURE[0], id: 'odd-mode', ours: true, mode: 'both'}]})).json();
  assert.deepEqual([reply.stored, reply.ignored], [FIXTURE.length, 2]);
  await put(e, {runs: FIXTURE});   // the same runs again: no new rows
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM benchmark_runs').get().n, FIXTURE.length);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM benchmark_snapshot').get().n, 1);
});

test('the page reads ONE snapshot row, never the runs table; closed to anyone but the owner', async () => {
  const e = env();
  await put(e, {runs: FIXTURE});
  e.STATS.reads.queries = e.STATS.reads.rows = 0;
  assert.equal((await call(e, '/admin/benchmark-form-filling')).status, 404);
  const html = await (await call(e, '/admin/benchmark-form-filling', owner)).text();
  assert.deepEqual([e.STATS.reads.queries, e.STATS.reads.rows], [1, 1]);
  assert.match(html, /Benchmark Form Filling/);
});

test('the page shows both scores, the ceiling, the grid, the trend and the folded method; the headline is user mode', () => {
  const snapshot = {at: '2026-10-15T12:00:00.000Z', ...summarize(FIXTURE.map(row => ({...row, ours: row.ours ? 1 : 0})))};
  const html = page(snapshot);
  assert.match(html, /thin applicant · user mode/);
  for (const word of ['Raw score', 'Product score', 'Ceiling', 'Tool X', 'Tool Y', 'Form A', 'bbb2222', 'aaa1111', 'How this is measured', '±1 field']) assert.ok(html.includes(word), word);
  assert.match(html, /<details><summary>How this is measured/);
  assert.ok(!html.includes('ddd4444'), 'harness runs are not in the user view');
  assert.ok(!/class="banner"/.test(html));
  const ours = totals([{required: 10, right: 5, wrong: 1, empty: 4, unans: 2, holds: 1, dups: 0, at: 'x'}, {required: 16, right: 10, wrong: 0, empty: 6, unans: 2, holds: 1, dups: 0, at: 'x'}]);
  assert.ok(html.includes('58%') && ours.raw === 58, 'raw 15/26');
  assert.ok(html.includes('?view=thin%3Aharness'), 'the other views are one click away');
});

test('harness mode and the grown applicant are labelled and shown alone; no snapshot is an empty state', () => {
  const snapshot = {at: '2026-10-15T12:00:00.000Z', ...summarize(FIXTURE.map(row => ({...row, ours: row.ours ? 1 : 0})))};
  const harness = page(snapshot, {segment: 'thin:harness'});
  assert.match(harness, /class="banner"[^>]*>thin applicant · harness mode: not what real users run/);
  assert.ok(harness.includes('ddd4444') && !harness.includes('bbb2222') && harness.includes('Tool X'), 'ours in harness mode only; the other tools sit in every thin view');
  assert.ok(page(snapshot, {segment: 'grown:user'}).includes('grown applicant · user mode'));
  assert.ok(page(snapshot, {segment: 'nonsense'}).includes('thin applicant · user mode'));
  const empty = page(null);
  assert.match(empty, /No data yet/);
  assert.ok(!empty.includes('Raw score'));
});

test('tiles use the shared colour rule: green at 70% or more, amber 50-69, red under 50; wrong answers green at 0', () => {
  const snap = rows => ({at: '2026-10-15T12:00:00.000Z', ...summarize(rows.map(row => ({...row, ours: 1}))), });
  const tile = (rows, what) => page(snap(rows)).match(new RegExp(`<section class="tile ?(\\w*)"><b>[^<]*</b><span class="what">${what}`))[1];
  const ours = (right, wrong) => [{...run('Our extension', 'Form A', right, wrong, 10), ours: true, build: 'abc'}];
  assert.equal(tile(ours(8, 0), 'Raw score'), 'good');
  assert.equal(tile(ours(5, 0), 'Raw score'), 'warn');
  assert.equal(tile(ours(4, 0), 'Raw score'), 'bad');
  assert.equal(tile(ours(8, 0), 'Wrong answers'), 'good');
  assert.equal(tile(ours(8, 2), 'Wrong answers'), 'warn');
});

test('the page is in the Operations menu beside Real and Lab, with a question, and the public code names no tool, form host or site', () => {
  const paths = PAGES.filter(p => p.group === 'Operations').map(p => p.path);
  const at = paths.indexOf('/admin/benchmark-form-filling');
  assert.ok(at > 0 && at === paths.indexOf('/admin/lab-form-filling') + 1);
  assert.match(PAGES.find(p => p.path === '/admin/benchmark-form-filling').question, /\?$/);
  for (const file of ['benchmark.js', 'benchmark-data.js', 'benchmark-page.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/https?:\/\/|\.(com|io|ai|org)\b/.test(source.replace(/\/\/.*$/gm, '')), `${file} has a host`);
  }
});
