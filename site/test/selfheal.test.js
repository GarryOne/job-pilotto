// The /self-heal page: the owner's view of what the self-healing loops spend on AI, behind the stats key like /stats.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {freshness, ingest, liveSection, page, view} from '../src/selfheal.js';

const env = {STATS_KEY: 'secret'};

test('/self-heal is owner-only: a stranger gets 404, the key sets the cookie, the cookie opens the page', async () => {
  assert.equal((await view(new Request('https://x.dev/self-heal'), env)).status, 404);
  assert.equal((await view(new Request('https://x.dev/self-heal?key=wrong'), env)).status, 404);
  const first = await view(new Request('https://x.dev/self-heal?key=secret'), env);
  assert.equal(first.status, 302);
  assert.match(first.headers.get('Set-Cookie'), /HttpOnly/);
  const cookie = first.headers.get('Set-Cookie').split(';')[0];
  const opened = await view(new Request('https://x.dev/self-heal', {headers: {Cookie: cookie}}), env);
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get('X-Robots-Tag'), 'noindex');
  assert.match(await opened.text(), /self-healing AI spend/);
});

test('it is never a static page: static assets are served to anyone before the Worker', () => {
  assert.equal(existsSync(new URL('../public/self-heal.html', import.meta.url)), false);
});

test('totals are computed from the rows: Fixer $1.117, 4 PRs, 2 merged, 476 Finder reviews', () => {
  const html = page();
  assert.match(html, /\$1\.12<\/b>/);
  assert.match(html, /4 PRs, 2 merged/);
  assert.match(html, /<td class="n">476<\/td>/);
  assert.match(html, /2 of 4/);
});

// The live part (4 Oct 2026): CI publishes the loop's numbers every 3 hours; one row per day; the page shows today, the trend and the real bugs.
const snapshot = (at, real = 26) => ({schema: 1, at, totals: {filed: 95, fixed: 19, queued: real - 19, falsePositive: 22, duplicate: 10, harness: 6, unclear: 25, open: 6, real, precision: 54},
  byDetector: [{detector: 'AI screenshot review', filed: 38, fixed: 4, queued: 7, falsePositive: 10, duplicate: 10, harness: 0, unclear: 6, open: 1}],
  fixer: {opened: 8, merged: 2, landed: 5, closed: 4, open: 0}, verdicts: {real: 9, falsePositive: 8}, cost: {usd: 1.06, runs: 12, byJob: {}, perRealBug: 0.04},
  recall: {planted: 13, caught: 11, missed: ['page-overflow', 'a11y-contrast']}, daily: [{day: '2026-10-03', filed: 33, real: 20, falsePositive: 9}],
  notable: [{number: 109, title: 'src: Alert email failure loses earlier emails\' jobs', url: 'https://github.com/o/r/issues/109', detector: 'AI code review', status: 'fixed', severity: 'medium'}]});
const fakeD1 = () => {
  const rows = new Map();
  return {rows, prepare: sql => ({bind: (...args) => ({run: async () => { rows.set(args[0], {day: args[0], at: args[1], body: args[2]}); }}),
    all: async () => ({results: [...rows.values()].sort((a, b) => b.day.localeCompare(a.day))})})};
};

test('publishing needs the key and the expected shape; one row per day, the latest wins', async () => {
  const STATS = fakeD1(), envPub = {...env, STATS, SELFHEAL_PUBLISH_KEY: 'pub'};
  const put = (body, key = 'pub') => ingest(new Request('https://x.dev/self-heal/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: typeof body === 'string' ? body : JSON.stringify(body)}), envPub);
  assert.equal((await put(snapshot('2026-10-04T01:00:00Z'), 'wrong')).status, 404, 'no key, no write');
  assert.equal((await put('not json')).status, 400);
  assert.equal((await put({schema: 2})).status, 400, 'an unexpected shape is refused');
  assert.equal((await put('x'.repeat(300001))).status, 413);
  assert.equal((await put(snapshot('2026-10-04T01:00:00Z', 20))).status, 200);
  assert.equal((await put(snapshot('2026-10-04T04:00:00Z', 26))).status, 200);
  assert.equal(STATS.rows.size, 1, 'one row for the day');
  assert.equal(JSON.parse(STATS.rows.get('2026-10-04').body).totals.real, 26, 'the latest publish of the day wins');
});

test('the page shows the live numbers on top, the detectors, the trend and the real bugs; the spend snapshot stays below', async () => {
  const STATS = fakeD1();
  STATS.rows.set('2026-10-03', {day: '2026-10-03', body: JSON.stringify(snapshot('2026-10-03T22:00:00Z', 20))});
  STATS.rows.set('2026-10-04', {day: '2026-10-04', body: JSON.stringify(snapshot('2026-10-04T04:00:00Z', 26))});
  const first = await view(new Request('https://x.dev/self-heal?key=secret'), env);
  const cookie = first.headers.get('Set-Cookie').split(';')[0];
  const html = await (await view(new Request('https://x.dev/self-heal', {headers: {Cookie: cookie}}), {...env, STATS})).text();
  assert.match(html, /Real bugs caught<\/span><b>26<\/b>/);
  assert.match(html, /<b>54%<\/b>/);
  assert.match(html, /<b>11\/13<\/b><small class="muted">missed: page-overflow, a11y-contrast/);
  assert.match(html, /<td>2026-10-03<\/td><td class="n">95<\/td><td class="n">20<\/td>/, 'yesterday in the trend');
  assert.match(html, /href="https:\/\/github.com\/o\/r\/issues\/109">#109<\/a>/);
  assert.ok(html.indexOf('The loop, live') < html.indexOf('Snapshot: self-healing AI spend'), 'live first, the old snapshot below');
  assert.match(liveSection(null), /No numbers published yet/);
});

test('the loop-quality numbers are shown with what they count, and "not measured yet" with the reason', () => {
  const live = {at: '2026-10-05T12:00:00Z', totals: {}, byDetector: [], quality: {
    mutation: {rate: 80, note: '4 of 5 planted code bugs caught'}, escape: {rate: null, note: 'the Bug Tracker is not shared'}}};
  const html = liveSection(live);
  assert.match(html, /How well it does/);
  assert.match(html, /🧬 Mutation catch rate<\/span><b>80%<\/b><small class="muted">4 of 5 planted code bugs caught · higher is better/);
  assert.match(html, /🕳️ Escape rate<\/span><b>–<\/b><small class="muted">not measured yet: the Bug Tracker is not shared/);
  assert.doesNotMatch(liveSection({...live, quality: undefined}), /How well it does/);
});

test('the page says how old the numbers are: fresh is quiet, a late publish warns, more than one missed run is stale', () => {
  const live = {at: '2026-10-05T06:15:46Z', since: '2026-10-04T13:44:50Z', excluded: 39, totals: {real: 4, falsePositive: 1, harness: 2, judged: 7, unjudged: 4}, byDetector: []};
  const at = hours => new Date(Date.parse(live.at) + hours * 3600000);
  assert.equal(freshness(live.at, at(2)).level, 'fresh');
  assert.equal(freshness(live.at, at(5.5)).level, 'late');
  assert.equal(freshness(live.at, at(8)).level, 'stale');
  assert.equal(freshness('nonsense').level, 'stale');
  assert.doesNotMatch(liveSection(live, [], at(2)), /class="card (late|stale)"/);
  assert.match(liveSection(live, [], at(5.5)), /A publish is late[^]*5\.5 h old/);
  assert.match(liveSection(live, [], at(8)), /These numbers are stale[^]*Self-heal stats/);
});

test('the page names its cutoff and what it leaves out, and its precision tile says what was judged', () => {
  const live = {at: '2026-10-05T06:15:46Z', since: '2026-10-04T13:44:50Z', excluded: 39, totals: {real: 4, falsePositive: 1, harness: 2, judged: 7, unjudged: 4, precision: 57}, byDetector: [], cost: {usd: 1, runs: 3, perRealBug: 0.25}};
  const html = liveSection(live, [], new Date('2026-10-05T07:00:00Z'));
  assert.match(html, /since 2026-10-04 13:44 UTC/);
  assert.match(html, /39 earlier issues[^<]*not counted/);
  assert.match(html, /4 real vs 3 wrong \(false positive or test mistake\) · 7 judged, 4 open not counted/);
  assert.match(html, /\$0\.25 per real bug · 3 runs recorded since the cutoff/);
});
