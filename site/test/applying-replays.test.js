// /admin/lab-form-filling's Fixed-site replays come from CI on main only (src/applying-replays.js): one PUT per merge (Bearer REPLAYS_PUBLISH_KEY) with the build's sha,
// stored as ONE row (the D1 free plan: 11 Oct 2026), the last 10 runs. A local upload of kind 'recorded' is refused: it showed work-in-progress branches as "failed".
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {rowStatus} from '../src/applying-status.js';
import {replaysIngest} from '../src/applying-replays.js';

function d1() {
  const db = new DatabaseSync(':memory:'), log = {read: 0, written: 0};
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values),
    run: async () => { const done = db.prepare(sql).run(...args); log.written += Number(done.changes); return done; },
    all: async () => { const results = db.prepare(sql).all(...args); log.read += results.length; return {results}; },
    first: async () => { const row = db.prepare(sql).get(...args); log.read += row ? 1 : 0; return row; }});
  return {db, log, prepare: sql => statement(sql)};
}
const KEY = 'k'.repeat(64);
const put = (db, body, {key = KEY, envKey = KEY, at = '2026-10-12T10:00:00Z'} = {}) => replaysIngest(new Request('https://x.test/applying/replays', {method: 'PUT',
  headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}), {STATS: db, REPLAYS_PUBLISH_KEY: envKey}, new Date(at));
const names = Array.from({length: 54}, (_, at) => `case-${String(at).padStart(2, '0')}`);
const run = (sha, failing = [], extra = {}) => ({sha, version: '0.9.200', rows: names.map(name => ({name, ok: !failing.includes(name), rung: 2, note: failing.includes(name) ? `${name} stopped` : ''})), ...extra});

test('only the publish key writes; without the Worker secret every PUT is a 404', async () => {
  const db = d1();
  assert.equal((await put(db, run('abc1234'), {key: 'wrong'})).status, 404);
  assert.equal((await put(db, run('abc1234'), {envKey: ''})).status, 404);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM applying_replays').get().n, 0);
  assert.equal((await put(db, run('abc1234'))).status, 200);
});

test('one merge of 54 cases is ONE row written; the same sha again with the same results writes nothing', async () => {
  const db = d1();
  db.log.written = 0;
  assert.deepEqual(await (await put(db, run('abc1234'))).json(), {ok: true, stored: 54});
  assert.equal(db.log.written, 1, 'one batched row per merge');
  db.log.written = 0;
  await put(db, run('abc1234'));
  assert.equal(db.log.written, 0, 'unchanged: nothing written');
});

test('a bad sha, a name with an address, and no rows are refused or dropped', async () => {
  const db = d1();
  assert.equal((await put(db, run('not-a-sha'))).status, 400);
  assert.equal((await put(db, {sha: 'abc1234', rows: []})).status, 400);
  const answer = await (await put(db, {sha: 'abc1234', rows: [{name: 'https://jobs.example.com/1?x=y', ok: true}, {name: 'fine-case', ok: true}]})).json();
  assert.equal(answer.stored, 1);
});

test('the page shows CI on main only: sha and time per case, the last 10 runs, since when, and a case no longer on main is gone', async () => {
  const db = d1();
  for (let at = 0; at < 12; at++) await put(db, run(`aaaa${String(at).padStart(3, '0')}`, at >= 9 ? ['case-03'] : []), {at: `2026-10-12T${String(at + 8).padStart(2, '0')}:00:00Z`});
  await put(db, {...run('bbbb999', ['case-03']), rows: run('bbbb999', ['case-03']).rows.filter(row => row.name !== 'case-53')}, {at: '2026-10-12T21:00:00Z'});
  const {cases, tiles} = await data(db, new Date('2026-10-12T22:00:00Z'));
  assert.equal(cases.length, 53, 'case-53 left main');
  const bad = cases.find(item => item.name === 'case-03'), good = cases.find(item => item.name === 'case-00');
  assert.deepEqual({ok: bad.ok, sha: bad.sha, at: bad.at, note: bad.note}, {ok: false, sha: 'bbbb999', at: '2026-10-12T21:00:00.000Z', note: 'case-03 stopped'});
  assert.deepEqual(bad.history, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0], 'the last 10 runs, oldest first');
  assert.deepEqual(bad.since, {sha: 'aaaa009', at: '2026-10-12T17:00:00.000Z'});
  assert.equal(good.history.length, 10);
  assert.deepEqual({cases: tiles.cases, casesFailing: tiles.casesFailing}, {cases: 53, casesFailing: 1});
  assert.match(PAGE, /c\.sha/, 'the table shows each row\'s sha');
});

test('a local upload of recorded results is refused: the table is CI on main only', async () => {
  const db = d1();
  const answer = await ingest(db, {kind: 'recorded', day: '2026-10-12', rows: [{name: 'case-00', ok: false}]}, new Date('2026-10-12T10:00:00Z'));
  assert.equal(answer.ok, false);
  assert.match(answer.error, /CI on main/);
  assert.equal((await data(db, new Date('2026-10-12T10:00:00Z'))).cases.length, 0);
});

test('a page load reads one replays row', async () => {
  const db = d1();
  await put(db, run('abc1234'));
  db.log.read = 0;
  const {readReplays} = await import('../src/applying-replays.js');
  await readReplays(db);
  assert.equal(db.log.read, 1);
});

// The page never scrolls sideways (owner, 12 Oct 2026: a long Result note pushed Last 10 runs / Last run / Since off-screen). Measured in Chromium at 1280 and 390 px
// when built; these lock the CSS that does it, for every table of the page.
test('layout: the replays table has fixed columns that add up to the page, a note keeps to 2 lines with the rest on hover, and at phone width every table wraps', () => {
  const css = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
  assert.match(css, /\.pooltable,\.fit\{table-layout:fixed\}/, 'one shared fixed-layout rule');
  const widths = [...css.slice(0, css.indexOf('@media (max-width:640px){table')).matchAll(/\.fit th\.c-(\w+)\{width:(\d+)%\}/g)].map(match => [match[1], Number(match[2])]);
  assert.deepEqual(widths.map(([name]) => name), ['case', 'rung', 'origin', 'result', 'runs', 'last', 'since']);
  assert.ok(widths.reduce((sum, [, width]) => sum + width, 0) <= 100);
  assert.match(css, /\.clamp\{[^}]*-webkit-line-clamp:2/);
  assert.match(css, /@media \(max-width:640px\)\{table td,table th\{white-space:normal!important;overflow-wrap:anywhere\}/, 'at phone width no table keeps cells on one line');
  const cases = PAGE.slice(PAGE.indexOf('const drawCases'), PAGE.indexOf("panels.replays.append(el('section', {}, el('h2', {textContent: 'Page cases'"));
  assert.match(cases, /className: 'fit'/);
  assert.match(cases, /className: 'muted clamp', title: c\.note/);
  for (const name of ['c-case', 'c-rung', 'c-origin', 'c-result', 'c-runs', 'c-last', 'c-since']) assert.ok(cases.includes(name), name);
  assert.match(css, /@media \(max-width:640px\)\{[^@]*\.fit \.c-rung,\.fit \.c-origin\{display:none\}/, 'at phone width the rung and origin columns step aside');
});

// The replays table works like the pool table (owner, 12 Oct 2026): search, filters, sorting and pages, from the same parts (the pool's word search, pick, pager, Clear).
test('the replays search matches words in any order over the case name, its result, its note and its rung', () => {
  const snippet = PAGE.slice(PAGE.indexOf('/*search*/'), PAGE.indexOf('/*end search*/'));
  const matches = new Function('flowText', 'STAGE', 'shortText', 'blocked', `${snippet}; return caseMatches;`)(() => '', {}, () => '', () => false);
  const failing = {name: 'cookie-banner-links-1', ok: false, note: 'asked: #resumeFile', rung: 3}, passing = {name: 'ashby-yes-no-buttons-1', ok: true, note: null, rung: null};
  assert.equal(matches(failing, ''), true);
  assert.equal(matches(failing, 'BANNER failed'), true);
  assert.equal(matches(failing, 'resumefile'), true);
  assert.equal(matches(failing, 'rung 3'), true);
  assert.equal(matches(failing, 'passed'), false);
  assert.equal(matches(passing, 'ashby passed'), true);
  assert.equal(matches(passing, 'ashby banner'), false);
});

test('the replays table has the pool\'s filter bar: search, Result, Rung and Origin filters, a count, Clear and 15 rows a page', () => {
  const cases = PAGE.slice(PAGE.indexOf('const caseBox'), PAGE.indexOf("panels.replays.append(el('section', {}, el('h2', {textContent: 'Page cases'"));
  assert.match(cases, /className: 'filters'/);
  assert.match(cases, /type: 'search'[^}]*'aria-label': 'Search the replays'/);
  assert.match(cases, /pick\('result', [^;]*'Result'/);
  assert.match(cases, /pick\('rung', [^;]*'Rung guarded'/);
  assert.match(cases, /pick\('origin', [^;]*'Origin', originCount\('captured'\) \+ ' captured · ' \+ originCount\('hand-cut'\) \+ ' hand-cut'/);   // the counts on the filter (owner, 12 Oct 2026)
  assert.match(cases, /CASE_PER = 15/);
  assert.match(cases, /caseMatches\(c, caseChosen\.query\)/);
  assert.match(cases, /← Previous[\s\S]*Next →/);
  assert.match(cases, /caseChosen\.result = caseChosen\.rung = caseChosen\.origin = null; caseChosen\.query = ''; caseChosen\.page = 0;/);   // Clear
  assert.match(cases, /heads\('cases', \[[^\]]*\], \(\) => \{ caseChosen\.page = 0; drawCases\(\); \}/);              // sorting starts again at page 1
});

// Sorting by the run dots (owner, 12 Oct 2026: "as many recent failed runs as higher in the list"): one score for every dots column, the pool's Recent runs and the replays' Last 10 runs.
// Each failed run -1, each good run +1, the newer ones weigh a hair more (a tie breaker only). Ascending (the first click) puts the most failures first, descending the most successes.
test('the run-dots sort: more recent failures first on the first click, more successes first on the second, in the pool and the replays', () => {
  const snippet = PAGE.slice(PAGE.indexOf('/*runs score*/'), PAGE.indexOf('/*end runs score*/'));
  const {runsScore, poolRunGood} = new Function(`${snippet}; return {runsScore, poolRunGood};`)();
  const states = steps => steps.map(step => ({...rowStatus({reached: step}), step})), pool = list => runsScore(states(list), poolRunGood), asc = (rows, get) => [...rows].sort((a, b) => get(a) - get(b)).map(row => row.name);
  const rows = [{name: 'ten red', history: Array(10).fill('posting')}, {name: 'one red', history: ['posting']}, {name: 'ten blue', history: Array(10).fill('form')}, {name: 'one blue', history: ['form']},
    {name: 'mixed', history: ['form', 'form', 'posting', 'form', 'form', 'form']}, {name: 'red then green', history: ['posting', 'ready']}, {name: 'green then red', history: ['ready', 'posting']}];
  assert.deepEqual(asc(rows, row => pool(row.history)), ['ten red', 'one red', 'green then red', 'red then green', 'one blue', 'mixed', 'ten blue']);
  assert.equal(pool(['code/bot', 'code/bot']), 0, 'a documented hold is neither');
  assert.equal(runsScore([{state: 'held'}, {state: 'site'}, {state: 'unrun'}], poolRunGood), 0, 'a hold, a site problem and a run not made are neither');
  assert.equal(pool(['none']) < 0 && pool(['account']) < 0, true, 'nothing reached and an account wall are failures');
  assert.equal(runsScore([], poolRunGood), null, 'never run: last in either order');
  const cases = [{name: 'all red', history: [0, 0, 0]}, {name: 'one red', history: [1, 1, 0]}, {name: 'all green', history: [1, 1, 1]}];
  assert.deepEqual(asc(cases, row => runsScore(row.history, run => run === 1)), ['all red', 'one red', 'all green']);
  assert.match(PAGE, /s => runsScore\(s\.states, poolRunGood\)\]/, 'the pool\'s Recent runs column sorts by it');
  assert.match(PAGE, /c => runsScore\(c\.history, run => run === 1\)/, 'the replays\' Last 10 runs column sorts by it');
});

test('each case\'s origin (captured from a real page or hand-cut) is kept from CI\'s upload and shown; any other word is no origin (owner, 12 Oct 2026)', async () => {
  const {replayCases, storeReplays, readReplays} = await import('../src/applying-replays.js');
  const statements = new Map(), db = {prepare: sql => ({bind: (...args) => ({first: async () => statements.get('row') || null, run: async () => { statements.set('row', {body: args[2]}); return {}; }})})};
  await storeReplays(db, {sha: 'abc1234', rows: [{name: 'lever-sibling-title-1', ok: true, origin: 'captured'}, {name: 'two-apply-routes-1', ok: true, origin: 'hand-cut'}, {name: 'x-1', ok: false, origin: 'from https://x.example'}]}, new Date('2026-10-12T12:00:00Z'));
  const cases = replayCases(await readReplays(db));
  assert.deepEqual(Object.fromEntries(cases.map(c => [c.name, c.origin])), {'x-1': null, 'lever-sibling-title-1': 'captured', 'two-apply-routes-1': 'hand-cut'});
});

test('the Fixed tab: a shape test guards the mechanism, only the live layer proves a fix (owner, 12 Oct 2026)', () => {
  assert.match(PAGE, /'Mechanism guarded · shape tests'/);
  assert.match(PAGE, /found\.ok \? 'mechanism guarded' : 'mechanism broken'/);
  assert.match(PAGE, /\['Shape tests', 'Guard the mechanism on a small page; they never prove the site works\.'\]/);
  assert.doesNotMatch(PAGE, /Proven live/);
  assert.doesNotMatch(PAGE, /Guard · replay results/);
});
