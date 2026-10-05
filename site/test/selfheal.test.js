// The /self-heal page: the owner's view of what the self-healing loops spend on AI, behind the stats key like /stats.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {changesSection} from "../src/trend.js";
import {freshness, ingest, liveSection, page, periodsSection, PRINCIPLES, principlesSection, view, watchSection} from '../src/selfheal.js';

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
  assert.match(await opened.text(), /Self-healing/);
});

test('it is never a static page: static assets are served to anyone before the Worker', () => {
  assert.equal(existsSync(new URL('../public/self-heal.html', import.meta.url)), false);
});

test('no hand-measured snapshot is left on the page: every number comes from a published snapshot', () => {
  const html = page();
  assert.doesNotMatch(html, /Snapshot: self-healing AI spend/);
  assert.doesNotMatch(html, /\$1\.12<\/b>/);
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

test('the page shows the live numbers on top, the detectors, the trend and the real bugs', async () => {
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

test('the page lists the rules the loop works by, each with what it means in practice and where it lives', () => {
  const html = page();
  assert.match(html, /How the loop works and learns/);
  assert.ok(html.indexOf('The loop, live') < html.indexOf('How the loop works and learns'));
  for (const [rule] of PRINCIPLES) assert.ok(html.includes(rule.replace(/'/g, '&#39;')) || html.includes(rule), rule);
  assert.ok(PRINCIPLES.length >= 8 && PRINCIPLES.every(row => row.length === 4 && row.every(Boolean)), 'every principle says what, how, status and where');
  assert.match(principlesSection(), /A miss is closed only when a guard exists/);
});

test('the page shows the paths the suites walked, from the run summaries', () => {
  const live = {at: '2026-10-05T06:15:46Z', totals: {}, byDetector: [], runs: {runs: 3, filed: 2, stale: 1, incompleteRuns: 0, behindMax: 4, dropped: {}, paths: {suites: 14, fixed: 9, seeded: 5, steps: 120, failedSteps: 3, windows: {'1024x640': 2, '1280x820': 12}, zones: {'Asia/Tokyo': 2}, themes: {dark: 4, light: 10}, events: {schedule: 14}}}};
  const html = liveSection(live, [], new Date('2026-10-05T07:00:00Z'));
  assert.match(html, /Paths walked by the suites in those runs: <b>14<\/b> suite runs · 9 on the fixed path, 5 seeded · windows 1024x640 ×2, 1280x820 ×12 · themes dark ×4, light ×10 · places Asia\/Tokyo ×2 · 3 of 120 steps failed/);
  assert.doesNotMatch(liveSection({...live, runs: {...live.runs, paths: null}}, [], new Date('2026-10-05T07:00:00Z')), /Paths walked/);
});

test('the page shows which detectors are under watch, how many mistakes were learned, and the judge exam', () => {
  const live = {at: '2026-10-05T06:15:46Z', totals: {}, byDetector: [], signatures: 2, breaker: {'layout-check': {judged: 8, wrong: 5, rate: 63, tripped: true}, 'ai-review': {judged: 10, wrong: 1, rate: 10, tripped: false}, 'interaction-probe': {judged: 3, wrong: 1, rate: 33, tripped: false}},
    quality: {judge: {rate: 90, note: '9 of 10 planted findings judged right (1 real bug(s) dismissed, 0 false alarm(s) believed, 0 unanswered)'}}};
  const html = watchSection(live);
  assert.match(html, /Detectors under watch/);
  assert.match(html, /layout-check<\/td><td class="n">8<\/td><td class="n">5 \(63%\)<\/td><td>🧯 under watch/);
  assert.match(html, /ai-review<\/td><td class="n">10<\/td><td class="n">1 \(10%\)<\/td><td>✅ trusted/);
  assert.match(html, /interaction-probe<\/td><td class="n">3<\/td><td class="n">1 \(33%\)<\/td><td>too few to judge/);
  assert.match(html, /2 test mistake\(s\) learned/);
  assert.equal(watchSection({}), '', 'nothing to show before the first snapshot has them');
  assert.match(liveSection(live, [], new Date('2026-10-05T07:00:00Z')), /Judge exam \(planted\)<\/span><b>90%<\/b>/);
});

test('a snapshot with periods shows all time first, then the last 7 days, and its tiles come from the period', () => {
  const t = real => ({filed: real + 2, real, falsePositive: 2, judged: real + 2, unjudged: 0, precision: 0.5, fixed: real, queued: 0});
  const live = {...snapshot('2026-10-05T04:00:00Z', 26), periods: {
    all: {totals: t(40), byDetector: [], cost: {usd: 9.5, perRealBug: 0.24}},
    last7: {totals: t(12), byDetector: [], cost: {usd: 2, perRealBug: 0.17}},
    cutoff: {totals: t(26), byDetector: [], cost: {usd: 4, perRealBug: 0.15}}}};
  const html = liveSection(live, []);
  assert.ok(html.indexOf('data-period="all"') < html.indexOf('data-period="last7"'));
  assert.match(html, /data-period="last7" hidden/);
  assert.doesNotMatch(html, /data-period="all" hidden/);
  assert.match(html, /data-period-btn="last7"/);
  assert.equal((html.match(/Real bugs caught/g) || []).length, 3, 'one per period, not a fourth from the cutoff totals');
  assert.match(periodsSection(live), /\$9\.50/);
  assert.equal(periodsSection({}), '');
});

test('the page lays what changed in the Finder each day beside what it filed, with sizes and the commits', () => {
  const history = [{day: '2026-10-04', filed: 13, real: 9, falsePositive: 2, stale: 0, open: 2}, {day: '2026-10-05', filed: 36, real: 10, falsePositive: 18, stale: 6, open: 2}];
  const changes = [{day: '2026-10-05', commits: 2, rules: 400, suite: 20, tests: 90, files: 7, lines: 420, size: 'large', items: [{sha: 'abc1234', subject: 'Finder: hold <b>findings</b>', lines: 400, size: 'large'}], more: 1}];
  const html = changesSection({history, changes});
  assert.match(html, /What we changed in the Finder, day by day/);
  assert.match(html, /<b>large<\/b><\/td><td class="n">420<\/td><td class="n">36<\/td><td class="n">36%<\/td><td class="n">-46 pts<\/td>/);
  assert.match(html, /<td>4 Oct<\/td><td><span class="muted">none<\/span><\/td>/, 'a day without changes says so');
  assert.match(html, /and 1 smaller/);
  assert.match(html, /<code>abc1234<\/code>/);
  assert.doesNotMatch(html, /<b>findings<\/b>/, 'a commit subject is escaped');
  assert.equal(changesSection({history, changes: []}), '', 'an old snapshot without changes shows no section');
  assert.match(liveSection({...snapshot('2026-10-05T04:00:00Z', 26), history, changes}, history), /What we changed in the Finder/);
});
