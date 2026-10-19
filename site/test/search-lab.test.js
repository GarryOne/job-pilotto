// /admin/lab-job-search (PR 1 of the Job Search lab): the upload (key, main only, checks), the judge (failed / worse / new / working, the 25 % band, the control), the page in each state, the menu.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {GROUPS, PAGES} from '../src/admin.js';
import {judge, reasons} from '../src/search-lab-judge.js';
import {page} from '../src/search-lab-page.js';
import {KEEP_RUNS, ingest, ingestRoute, rowFromPress, runs} from '../src/search-lab-store.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const row = (candidate, minute, more = {}) => ({candidate, label: candidate, run_at: `2026-10-18T10:${String(minute).padStart(2, '0')}:00Z`, build: 'abc1234', state: 'ok',
  first_s: 40, tenth_s: 184, fit_s: 557, in_places: 77, scored: 44, fit70: 2, ...more});
const stateOf = (rows, name = 'a') => judge(rows).find(entry => entry.candidate === name).state;

test('the judge: new, working, a time inside 25 %, a time past it, a count lower, a time no longer reached, FAILED', () => {
  assert.equal(stateOf([row('a', 1)]), 'new');
  assert.equal(stateOf([row('a', 1), row('a', 2)]), 'working');
  assert.equal(stateOf([row('a', 1), row('a', 2, {first_s: 50, in_places: 90})]), 'working', '40 → 50 s is exactly 25 %; more jobs is no problem');
  assert.equal(stateOf([row('a', 1), row('a', 2, {first_s: 51})]), 'worse');
  assert.equal(stateOf([row('a', 1), row('a', 2, {fit70: 1})]), 'worse');
  assert.deepEqual(judge([row('a', 1), row('a', 2, {fit_s: null})])[0].why, ['Time to first 70+ job: 557 s → not reached']);
  const crashed = judge([row('a', 1), row('a', 2, {state: 'failed', failed_step: 'Reading job boards', in_places: 3})])[0];
  assert.deepEqual([crashed.state, crashed.why], ['failed', ['a step crashed: Reading job boards']]);
});

test('a stale tape row is shown, never judged, and never becomes the last green run', () => {
  const stale = (minute, more = {}) => row('a', minute, {state: 'stale', failed_step: 'Tape stale (6 AI and 98 web requests not recorded)', in_places: 7, fit70: 0, ...more});
  const [entry] = judge([row('a', 1), stale(2)]);
  assert.deepEqual([entry.state, entry.why], ['stale', ['Tape stale (6 AI and 98 web requests not recorded): record this candidate again']]);
  assert.equal(stateOf([row('a', 1), stale(2), row('a', 3, {in_places: 70})]), 'worse', 'compared with run 1, not with the stale run 2 (7 in places)');
  assert.equal(stateOf([stale(1), row('a', 2)]), 'new', 'a stale run is no baseline');
});

test('"last green" skips a failed or worse run, so a bad run does not become the baseline', () => {
  const rows = [row('a', 1), row('a', 2, {fit70: 0}), row('a', 3, {fit70: 1})];
  assert.equal(stateOf(rows), 'worse', 'run 3 still has fewer 70+ than run 1, the last green one');
  assert.equal(stateOf([row('a', 1), row('a', 2, {state: 'failed'}), row('a', 3)]), 'working');
});

test('the control gets no tolerance on times', () => {
  assert.deepEqual(reasons(row('s', 2, {first_s: 41}), row('s', 1), true), ['Time to first job: 40 s → 41 s']);
  assert.deepEqual(reasons(row('s', 2, {first_s: 41}), row('s', 1), false), []);
  assert.equal(judge([row('s', 1, {control: 1}), row('s', 2, {control: 1, first_s: 41})])[0].state, 'worse');
});

test('every kept candidate is judged on its own runs', () => {
  const list = judge([row('a', 1), row('b', 1), row('b', 2, {in_places: 1})]);
  assert.deepEqual(list.map(entry => [entry.candidate, entry.state]), [['a', 'new'], ['b', 'worse']]);
});

test('the upload: the narrow key, main only, checked rows, the last 30 runs per candidate', async () => {
  const STATS = d1(), env = {STATS, REPLAYS_PUBLISH_KEY: 'k'};
  const put = (body, key = 'k') => ingestRoute(new Request('https://w.dev/search-lab/rows', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), env);
  assert.equal((await put({branch: 'main', rows: [row('a', 1)]}, 'wrong')).status, 404);
  const refused = await put({branch: 'fix-x', rows: [row('a', 1)]});
  assert.deepEqual([refused.status, (await refused.json()).error], [400, 'only a run on main reaches the page']);
  assert.equal((await runs(STATS)).length, 0);
  for (const [bad, why] of [[{...row('A B', 1)}, /candidate/], [row('a', 1, {run_at: 'yesterday'}), /run_at/], [row('a', 1, {build: 'x; DROP'}), /build/], [row('a', 1, {state: 'great'}), /state/], [row('a', 1, {fit70: -1}), /fit70/], [row('a', 1, {first_s: '40'}), /first_s/]]) {
    const result = await put({branch: 'main', rows: [bad]});
    assert.equal(result.status, 400, JSON.stringify(bad));
    assert.match((await result.json()).error, why);
  }
  assert.equal((await put({branch: 'main', rows: [row('a', 1)]})).status, 200);
  assert.deepEqual((await runs(STATS)).map(item => [item.candidate, item.in_places, item.control]), [['a', 77, 0]]);
  for (let minute = 2; minute < 40; minute++) await ingest(STATS, [row('a', minute)]);
  const kept = await runs(STATS);
  assert.equal(kept.length, KEEP_RUNS);
  assert.equal(kept.at(-1).run_at, '2026-10-18T10:39:00Z', 'the newest are kept');
});

test('a harness press becomes a row; a crashed press is FAILED with its step, never thin numbers', () => {
  const press = {press: 1, in_places: 77, scored_in_places: 44, fit70_in_places: 2, crashes: [], ttfr: {first_in_places_s: 40, tenth_in_places_s: 184, first_fit70_s: null}};
  const meta = {label: 'Finance', build: 'abc1234', runAt: '2026-10-18T10:00:00Z'};
  assert.deepEqual(rowFromPress('finance', press, meta), {candidate: 'finance', run_at: meta.runAt, build: 'abc1234', label: 'Finance', control: false, state: 'ok', failed_step: undefined,
    first_s: 40, tenth_s: 184, fit_s: null, in_places: 77, scored: 44, fit70: 2});
  const stale = rowFromPress('finance', {...press, stale: 'Tape stale (3 AI and 0 web requests not recorded)'}, meta);
  assert.deepEqual([stale.state, stale.failed_step], ['stale', 'Tape stale (3 AI and 0 web requests not recorded)']);
  const crashed = rowFromPress('finance', {...press, crashes: [{step: 'Reading job boards', error: 'KeyError'}]}, meta);
  assert.deepEqual([crashed.state, crashed.failed_step], ['failed', 'Reading job boards']);
});

test('the page: each state in words, the move since the last green run, an empty state that says how to fill it', () => {
  const html = page([row('a', 1, {label: 'Finance · Amsterdam'}), row('a', 2, {label: 'Finance · Amsterdam', tenth_s: 90, in_places: 60}),
    row('b', 1, {label: 'Music'}), row('b', 2, {label: 'Music', state: 'failed', failed_step: 'Reading job boards'}), row('c', 1, {label: 'Cluj'}),
    row('s', 1, {label: 'SRE', control: 1}), row('s', 2, {label: 'SRE', control: 1})]);
  for (const word of ['Worse', 'FAILED', 'New', 'Working']) assert.ok(html.includes(`>${word}</span>`), word);
  assert.match(html, /1:30 <span class="up"[^>]*>▲/, '10th relevant job 3:04 → 1:30 is better');
  assert.match(html, /60 <span class="down"[^>]*>▼/, 'jobs in places 77 → 60 is worse');
  assert.match(html, /a step crashed: Reading job boards/);
  assert.match(html, /<span class="chip">control<\/span>/);
  assert.match(page([row('t', 1), row('t', 2, {state: 'stale', failed_step: 'Tape stale (1 AI and 0 web requests not recorded)'})]), />No valid replay<\/span>/);
  const stale = page([row('t', 1), row('t', 2, {state: 'stale', in_places: 4321, failed_step: 'Tape stale (1 AI and 0 web requests not recorded)'})]);
  assert.match(stale, /No valid replay \(replay parked\)/);
  assert.doesNotMatch(stale, /4,321|4321/, 'a stale replay shows no counts');
  assert.match(page([]), /No search replayed yet/);
});

test('the Lab screen draws a card, time bars, funnel meters and a sparkline per candidate, and History lists every run', () => {
  const all = [row('a', 1, {label: 'Finance'}), row('a', 2, {label: 'Finance', in_places: 60, fit70: 3}), row('s', 1, {label: 'SRE', control: 1}), row('f', 1, {label: 'Music', state: 'failed', failed_step: 'Reading job boards'})];
  const html = page(all);
  assert.equal((html.match(/class="card lv-card"/g) || []).length, 3, 'one card per candidate');
  assert.match(html, /class="lv-health"/);
  assert.match(html, /<svg class="lv-spark"/);
  assert.match(html, /First job<\/span><div class="lv-track/);
  assert.match(html, /Scored<\/span><div class="lv-track/);
  assert.doesNotMatch(html, /class="lv-tiles lv-leads"/, 'the Lab screen leads with no replay seconds (owner, 19 Oct 2026: judge live)');
  for (const name of ['Time to first job', 'Time to 10th job', 'Time to first 70+ job']) assert.ok(html.includes(name), `${name} is the one name on the Lab screen`);
  assert.doesNotMatch(html, /1st relevant|1st 70\+/, 'no second name for the same time');
  assert.match(html, /Runs kept<\/span><b>4<\/b>/);
  const history = page(all, [], 'history');
  assert.equal((history.match(/<tr><td>2026/g) || []).length, 4, 'every kept run is a row');
  assert.match(history, /Finance[^<]*<span class="muted">· 2 runs/);
  assert.doesNotMatch(history, /class="card lv-card"/, 'the History screen is not the Lab screen');
});

test('the route: owner only, the page is in the "Job search" group, the group is in the menu', async () => {
  const env = {STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  await ingest(env.STATS, [row('a', 1, {label: 'Finance · Amsterdam'})]);
  const get = (headers = {}) => worker.fetch(new Request('https://www.jobpilotto.top/admin/lab-job-search', {headers}), env, {});
  assert.equal((await get()).status, 404);
  const shown = await get({Cookie: 'jp_stats=k3y'});
  assert.equal(shown.status, 200);
  const html = await shown.text();
  assert.match(html, /Real installs/, 'the page opens on the live numbers');
  assert.match(await (await get({Cookie: 'jp_stats=k3y'}).then(() => worker.fetch(new Request('https://www.jobpilotto.top/admin/lab-job-search?tab=lab', {headers: {Cookie: 'jp_stats=k3y'}}), env, {}))).text(), /Finance · Amsterdam/);
  assert.match(html, /🔎 Job search/, 'the menu has the group');
  assert.ok(GROUPS.some(([name]) => name === 'Job search'));
  assert.equal(PAGES.find(item => item.path === '/admin/lab-job-search').group, 'Job search');
});
