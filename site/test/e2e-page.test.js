// /admin/operations/e2e: the snapshot drawn in each state, owner only, in the menu under Operations, and the old /admin/e2e address going there.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {bars, page, rangeOf, suiteRows, windowOf} from '../src/e2e-page.js';

const now = new Date('2026-10-18T12:00:00Z');
const snapshot = {schema: 1, at: '2026-10-18T11:41:00Z',
  days: [{day: '2026-10-17', runs: 4, reds: 3, greens: 1, redMin: 80}, {day: '2026-10-12', runs: 2, reds: 1, greens: 1, redMin: 30}, {day: '2026-09-30', runs: 1, reds: 1, greens: 0, redMin: 20}],
  fails: [{day: '2026-10-17', suite: 'apply', platform: 'mac', cause: 'test', n: 2, min: 24}, {day: '2026-10-17', suite: 'apply', platform: 'windows', cause: 'test', n: 2, min: 28}, {day: '2026-10-17', suite: 'strategy', platform: 'mac', cause: 'credit', n: 1, min: 6},
    {day: '2026-10-12', suite: 'quality', platform: 'mac', cause: 'flake', n: 1, min: 9}, {day: '2026-09-30', suite: 'old', platform: 'mac', cause: 'product', n: 1, min: 5}],
  latest: [{runId: 39074977525, day: '2026-10-17', kind: 'beta', conclusion: 'failure', minutes: 26}, {runId: 39072072784, day: '2026-10-17', kind: 'beta', conclusion: 'success', minutes: 16}]};
const env = () => ({STATS_KEY: 'k3y', STATS_SALT: 's', STATS: {prepare: () => ({first: async () => ({body: JSON.stringify(snapshot)}), bind() { return this; }, all: async () => ({results: []})})}, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const get = (path, headers = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, redirect: 'manual'}), env(), {});

test('an unknown range is 7 days; the range counts only its own days', () => {
  assert.equal(rangeOf('nope'), '7d');
  const week = windowOf(snapshot, '7d', now), month = windowOf(snapshot, '30d', now);
  assert.deepEqual([week.runs, week.redRuns, week.greenRuns, week.redMin, week.reds], [6, 4, 2, 110, 6]);
  assert.deepEqual(week.byCause, {credit: 1, infra: 0, flake: 1, test: 4, product: 0, open: 0, unknown: 0});
  assert.deepEqual([month.runs, month.redRuns, month.redMin, month.reds], [7, 5, 130, 7]);
});

test('suites are listed by the time their reds cost, with their causes', () => {
  const rows = suiteRows(windowOf(snapshot, '7d', now));
  assert.deepEqual(rows.map(row => `${row.suite}/${row.platform}`), ['apply/windows', 'apply/mac', 'quality/mac', 'strategy/mac']);
  assert.deepEqual(rows[0].causes, {test: 2});
});

test('the page: numbers, suites with chips, a bar per day, the run list; "no data yet" and "no reds" are said in words', () => {
  const html = page(snapshot, {range: '7d', now});
  assert.match(html, /67%/, 'red runs: 4 of 6');
  assert.match(html, /1\.8 h/, '110 minutes of red runs');
  assert.match(html, /17%/, 'flakes: 1 of 6 red suites');
  assert.match(html, /Top cause<\/span><b>Test bug/);
  assert.match(html, /<code>apply<\/code><\/td><td>Windows<\/td>/);
  assert.match(html, /actions\/runs\/39074977525/);
  assert.equal((html.match(/class="night"/g) || []).length, 2, 'one bar row per day that had a run (17 and 12 Oct); days with no run are left out');
  assert.match(page(null, {now}), /No data yet/);
  assert.match(page({...snapshot, days: [], fails: [], latest: []}, {now}), /No red suites in this range/);
  assert.equal(bars(windowOf(snapshot, '7d', now)).includes('3 red suites') || bars(windowOf(snapshot, '7d', now)).includes('5 red suites'), true);
});

test('owner only; the menu lists E2E under Operations; the old runs address goes to the tab', async () => {
  assert.equal((await get('/admin/operations/e2e')).status, 404);
  const response = await get('/admin/operations/e2e', {Cookie: 'jp_stats=k3y'});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Where e2e time goes/);
  assert.equal(PAGES.find(item => item.path === '/admin/operations/e2e').group, 'Operations');
  const old = await get('/admin/e2e', {Cookie: 'jp_stats=k3y'});
  assert.equal(old.headers.get('Location'), '/admin/operations/e2e');
});
