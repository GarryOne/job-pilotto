// The PR checks page (src/pr-checks.js): the CI ingest (key, shape, one row a month) and the owner's page with its month-to-month trend.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {cleanCard, ingest, page} from '../src/pr-checks.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const check = (name, extra = {}) => ({name, runs: 40, reds: 3, realCatches: 2, falseReds: 1, medianMin: 4, p90Min: 9.5, addedMin: 1.2, verdict: 'proven', ...extra});
const card = checks => ({days: 30, generatedAt: '2026-11-01T06:17:00Z', checks});
const put = (e, body, key = 'pub') => call(e, '/pr-checks/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};

test('the ingest needs the key and a well-formed card', async () => {
  const e = env();
  assert.equal((await put(e, card([check('Unit')]), 'wrong')).status, 404);
  assert.equal((await put(e, {days: 30, checks: []})).status, 400);
  assert.equal((await put(e, card([check('')]))).status, 400);
  assert.equal((await put(e, card([check('Unit')]))).status, 200);
  assert.equal(cleanCard(card([check('Unit', {realCatches: 'x', verdict: '<b>'})])).checks[0].verdict, 'review');
});

test('a repeat run in the same month replaces the row', async () => {
  const e = env();
  await ingest(new Request('https://x/pr-checks/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(card([check('Unit')]))}), e, new Date('2026-11-01T06:00:00Z'));
  await ingest(new Request('https://x/pr-checks/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(card([check('Unit', {realCatches: 7})]))}), e, new Date('2026-11-09T06:00:00Z'));
  const rows = e.STATS.db.prepare('SELECT month, card FROM pr_check_months').all();
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].card).checks[0].realCatches, 7);
});

test('the page is the owner\'s: 404 without the key, an empty state, one row per check with its verdict and earlier months', async () => {
  const e = env();
  assert.equal((await call(e, '/admin/operations/pr-checks')).status, 404);
  assert.match(await (await call(e, '/admin/operations/pr-checks', owner)).text(), /No scorecard yet/);
  const db = e.STATS.db;
  db.prepare('INSERT INTO pr_check_months (month, card, updated_at) VALUES (?, ?, ?)').run('2026-10', JSON.stringify(card([check('Unit', {realCatches: 5}), check('Journeys', {realCatches: 1})])), 'x');
  db.prepare('INSERT INTO pr_check_months (month, card, updated_at) VALUES (?, ?, ?)').run('2026-11', JSON.stringify(card([check('Unit'), check('Journeys', {realCatches: 0, verdict: 'review'})])), 'x');
  const html = await (await call(e, '/admin/operations/pr-checks', owner)).text();
  assert.match(html, /Nov 2026/);
  assert.match(html, /<td>Journeys<\/td><td>40<\/td><td>0<\/td><td>1<\/td><td>9.5<\/td><td>1.2 min<\/td><td><span[^>]*>🟡 review<\/span><\/td><td class="muted">Oct 1<\/td>/);
  assert.match(html, /🟢 proven/);
  assert.ok(!page([{month: '2026-11', card: JSON.stringify(card([check('<script>x</script>')]))}]).includes('<script>x'));
});

test('the menu lists PR checks under Operations', () => {
  assert.equal(PAGES.find(item => item.path === '/admin/operations/pr-checks').group, 'Operations');
});
