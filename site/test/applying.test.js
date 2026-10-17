// /admin/lab-form-filling (src/applying.js): uploads are checked to fixed values, and the page's data shows each site's last step, its trend, regressions and cases.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {needsFixGroups} from '../src/applying-groups.js';
import {PAGE, data, ingest, shortOf} from '../src/applying.js';
import {STATES, STATE_WORD, rowStatus} from '../src/applying-status.js';
import {storeReplays} from '../src/applying-replays.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');

test('an upload keeps fixed values only: a host (never a path), a known step; a bad kind or day is refused', async () => {
  const db = d1();
  assert.equal((await ingest(db, {kind: 'nope', day: '2026-10-12', rows: [{name: 'x'}]})).ok, false);
  assert.equal((await ingest(db, {kind: 'smoke', day: 'yesterday', rows: [{name: 'x'}]})).ok, false);
  await ingest(db, {kind: 'smoke', day: '2026-10-12', version: '0.9.165', rows: [{name: 'Lever form', host: 'https://jobs.lever.co/x/y', reached: 'teleported', filled: 3, left: 1}]}, now);
  const [row] = db.db.prepare('SELECT host, reached, filled FROM applying_runs').all();
  assert.deepEqual({...row}, {host: null, reached: null, filled: 3});   // a URL is not a host; an unknown step is dropped
});

test('the page data: each site\'s last step and last runs, regressions first; cases with their result; nights by step', async () => {
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-10', rows: [{name: 'jobs.ch account', host: 'www.jobs.ch', reached: 'code/bot'}, {name: 'Lever form', host: 'jobs.lever.co', reached: 'ready', filled: 9, left: 0}]}, now);
  await ingest(db, {kind: 'smoke', day: '2026-10-11', rows: [{name: 'jobs.ch account', host: 'www.jobs.ch', reached: 'posting', regression: true}]}, now);
  await storeReplays(db, {sha: 'abc1234', version: '0.9.165', rows: [{name: 'cookie-banner-links-1', ok: true}, {name: 'cv-choice-step-1', ok: false, note: 'attached: #resumeFile'}]}, now);
  const d = await data(db, now);
  assert.deepEqual(d.sites.map(site => [site.name, site.reached, site.regression, site.history]), [['jobs.ch account', 'posting', true, ['code/bot', 'posting']], ['Lever form', 'ready', false, ['ready']]]);
  assert.deepEqual(d.cases.map(item => [item.name, item.ok, item.note]), [['cv-choice-step-1', false, 'attached: #resumeFile'], ['cookie-banner-links-1', true, null]]);
  assert.deepEqual([d.tiles.cases, d.tiles.casesFailing, d.tiles.sites, d.tiles.regressions, d.tiles.reachedForm], [2, 1, 2, 1, 50]);
  assert.deepEqual(d.nights.map(night => [night.day, night.counts.held, night.counts.works, night.counts.fix]), [['2026-10-10', 1, 1, 0], ['2026-10-11', 0, 0, 1]]);   // a code or bot check is held, not a miss
});

test('the pool: every site is listed, also one never run; platform and flow come from the host and signature; a path or query never gets in', async () => {
  const db = d1();
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [
    {name: 'Acme', start_host: 'job-boards.greenhouse.io', signature: 'other>form@job-boards.greenhouse.io#form'},
    {name: 'Beta', start_host: 'job-boards.greenhouse.io', signature: 'form@job-boards.greenhouse.io#ready'},
    {name: 'Gamma', start_host: 'career5.successfactors.eu'}, {name: 'Delta', start_host: 'a.wd5.myworkdayjobs.com'},
    {name: 'posting>form@x.com (found 2026-10-10)', start_host: 'careers.breitling.com', signature: 'posting>form@x.com#form'},
    {name: 'Leaky', start_host: 'https://x.com/jobs/1?token=abc', signature: 'form@x.com/path?q=1#form'}]}, now);
  const [leaky] = db.db.prepare("SELECT start_host, signature FROM applying_pool WHERE name = 'Leaky'").all();
  assert.deepEqual({...leaky}, {start_host: null, signature: null});
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Beta', host: 'job-boards.greenhouse.io', reached: 'ready'}]}, now);
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [{name: 'Gamma', signature: 'posting>account@career5.successfactors.eu#code/bot'}]}, now);   // a later row without a host keeps the start host
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.equal(by.Acme.platform, 'Greenhouse'); assert.equal(by.Acme.flow, by.Beta.flow); assert.equal(by.Acme.raw, 'other>form@job-boards.greenhouse.io#form');
  assert.equal(by.Beta.reached, 'ready');
  assert.deepEqual([by.Acme.reached, by.Acme.history], ['form', ['form']]);   // known only from its signature: the step it showed
  assert.deepEqual([by.Delta.reached, by.Delta.history, by.Delta.flow], [null, [], null]);   // never run: "—"
  assert.equal(by['posting>form@x.com (found 2026-10-10)'], undefined); assert.equal(by.Breitling.flow, 'posting → form');   // a discovered site is named by its host's domain
  assert.equal(by.Gamma.platform, 'SuccessFactors'); assert.equal(by.Gamma.start, 'career5.successfactors.eu'); assert.equal(by.Gamma.flow, 'posting → account → bot check');
  assert.deepEqual(d.platforms.map(item => [item.name, item.sites, item.flows]), [['Greenhouse', 2, 1], ['Custom', 1, 0], ['Custom (x)', 1, 1], ['SuccessFactors', 1, 1], ['Workday', 1, 0]]);
  assert.equal(d.pool.length, 6);
});

test('the pool: each site shows when it last ran; a site mid-run is flagged "running" and sorted first, and a ping older than 5 minutes is stale', async () => {
  const db = d1();
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [{name: 'Acme', start_host: 'jobs.acme.com'}, {name: 'Beta', start_host: 'jobs.beta.com'}, {name: 'Gamma', start_host: 'jobs.gamma.com'}]}, now);
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Beta', host: 'jobs.beta.com', reached: 'form'}]}, new Date('2026-10-12T10:00:00Z'));
  await ingest(db, {kind: 'running', day: '2026-10-12', rows: [{name: 'Gamma', state: 'start'}, {name: 'Acme', state: 'start'}]}, new Date('2026-10-12T11:58:00Z'));
  await ingest(db, {kind: 'running', day: '2026-10-12', rows: [{name: 'Acme', state: 'end'}]}, new Date('2026-10-12T11:59:00Z'));
  let d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.deepEqual([by.Gamma.running, by.Acme.running, by.Beta.running], [true, false, false]);   // Acme's run ended; Beta is not running
  assert.equal(by.Beta.at, '2026-10-12T10:00:00.000Z'); assert.equal(by.Acme.at, null);   // never run: no time
  assert.equal(d.pool[0].name, 'Gamma');   // running sites come first
  d = await data(db, new Date('2026-10-12T12:30:00Z')); by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.equal(by.Gamma.running, false);   // the run died without an end ping: stale after 5 minutes
  assert.equal((await ingest(db, {kind: 'running', day: '2026-10-12', rows: [{name: 'x', state: 'weird'}]}, now)).stored, 0);   // fixed words only
});

test('an upload keeps a rung (integer 0 to 6) and a signal (a fixed word) and drops anything else; the page data carries them', async () => {
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'A', host: 'a.com', reached: 'posting', rung: 3, signal: 'unsure'}, {name: 'B', host: 'b.com', reached: 'form', rung: 9, signal: 'because I said so'},
    {name: 'C', host: 'c.com', reached: 'form', rung: '2', signal: 'stalled'}, {name: 'D', host: 'd.com', reached: 'form', rung: 0}]}, now);
  await storeReplays(db, {sha: 'abc1234', rows: [{name: 'case-1', ok: true, rung: 2}, {name: 'case-2', ok: true, rung: 7}, {name: 'case-3', ok: true}]}, now);
  const rows = Object.fromEntries(db.db.prepare('SELECT name, rung, signal FROM applying_runs').all().map(row => [row.name, {...row}]));
  assert.deepEqual([rows.A.rung, rows.A.signal, rows.B.rung, rows.B.signal, rows.C.rung, rows.C.signal, rows.D.rung, rows.D.signal], [3, 'unsure', null, null, null, 'stalled', 0, null]);
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [{name: 'A', start_host: 'a.com'}, {name: 'Z', start_host: 'z.com'}]}, now);
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.deepEqual([by.A.rung, by.A.signal, by.Z.rung, by.Z.signal], [3, 'unsure', null, null]);   // never run: unknown
  assert.deepEqual(d.cases.map(item => [item.name, item.rung]).sort(), [['case-1', 2], ['case-2', null], ['case-3', null]]);
});

test('the page shows the ladder card always open, a Rung column in the pool and a Details expander in the Fixed tab', () => {
  const card = PAGE.slice(PAGE.indexOf('The AI ladder'), PAGE.indexOf('const MEANS = '));
  assert.doesNotMatch(card, /'details'/);   // always open: no expander around the ladder
  assert.ok(card.includes('a rung never guesses.') && card.includes('A rung that is unsure or contradicted hands the page to the next'));
  assert.match(PAGE, /heads\('pool', \[[^\]]*'Rung'/); assert.match(PAGE, /heads\('cases', \[[^\]]*'Rung guarded'/); assert.match(PAGE, /heads\('fixed', \[[^\]]*'Details'/);   // the replays' guarded rung lives in the Fixed tab's Fix and Guard columns
  assert.match(PAGE, /blocked at /);
});

test('the by-hand bars name each day as "14 Oct", say each day runs other sites and explain "held or site"', () => {
  assert.ok(PAGE.includes('dayWord(night.day)') && !PAGE.includes('night.day.slice(5)'));
  assert.ok(PAGE.includes('so compare a site') && PAGE.includes(' held or site'));
});

test('every table on the page gets its headers from the one sortable helper (owner, 10 Oct 2026: sort by any column, red first)', () => {
  // A table added with its own plain th cells would not sort: only the helper may create a th, and every table's headers come from it.
  // The colors legend, the one table with plain headers, went on 15 Oct 2026 (owner): the only th left is the one heads(...) builds.
  assert.equal(PAGE.split("el('th'").length - 1, 1, 'a table builds its own th instead of heads(...)');
  for (const key of ['pool', 'cases']) assert.match(PAGE, new RegExp("heads\\('" + key + "'"));
  assert.equal((PAGE.match(/heads\(key, labels/g) || []).length, 1);   // the next-sites and scorecard blocks share it
});

test('no colors legend: each status pill says its status and carries its meaning on hover (owner, 15 Oct 2026)', () => {
  assert.doesNotMatch(PAGE, /colorLegend|el\('h3', \{textContent: 'What the colors mean'\}\)/);
  assert.match(PAGE, /\[filters, table\]/);
  assert.match(PAGE, /title: \(s\.status\.rule && s\.status\.from !== 'ending' \? s\.status\.rule \+ ': ' : ''\) \+ \(MEANS\[s\.status\.state\] \|\| ''\)/);
  for (const state of ['works', 'held', 'site', 'fix', 'unrun']) assert.match(PAGE, new RegExp('const MEANS = \\{.*\\b' + state + ': \''), state + ' has a meaning');
});

test('the by-hand runs chart sits right under the tiles: one row per day, newest first, a labelled segment per status, a key and a works share that leaves holds out', () => {
  const title = 'By-hand runs · where each site got to', nights = PAGE.slice(PAGE.indexOf(title));
  assert.ok(PAGE.indexOf(title) < PAGE.indexOf('The pool · every smoke site'), 'the chart is at the top');
  assert.ok(PAGE.indexOf("className: 'tiles'") < PAGE.indexOf(title));
  assert.ok(!PAGE.includes('Nights · where'), 'the pool has had no nights since 11 Oct 2026');
  assert.doesNotMatch(PAGE, /className: 'bars'/);   // the old thin vertical bars are gone
  assert.match(nights, /\.slice\(-14\)\.reverse\(\)/);   // the last 14 days, newest first
  assert.match(nights, /textContent: count/);   // the count is written in its segment
  assert.match(nights, /left out/);   // the share says what it leaves out
  assert.match(nights, /d\.states\.map\(state => el\('span', \{className: 'pill st-'/);   // a key of the statuses
});

test('the page explains its colors: a legend row for every step the page draws', () => {
  for (const step of ['none', 'posting', 'account', 'code/bot', 'form', 'ready']) assert.ok(PAGE.includes(step === 'code/bot' ? "'code/bot': '" : step + ': '), step + ' has no meaning in the legend');
});

test('a form reached with under half of its fields filled is a shortfall: red on the page, on the needs-a-fix count, with the filled share of each run (owner, 10 Oct 2026: 4 of 13 showed blue)', async () => {
  assert.deepEqual(shortOf('form', 4, 8), {done: 4, total: 12, unexplained: null});
  assert.equal(shortOf('form', 6, 6), null);   // half is not a shortfall
  assert.equal(shortOf('ready', 5, 0), null);
  assert.equal(shortOf('posting', 0, 0), null);   // an earlier stop is its own failure
  assert.equal(shortOf('form', null, null), null);
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-11', rows: [{name: 'Short', host: 's.com', reached: 'form', filled: 3, left: 9}, {name: 'Half', host: 'h.com', reached: 'form', filled: 6, left: 6}, {name: 'Early', host: 'e.com', reached: 'posting'}]}, now);
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Short', host: 's.com', reached: 'form', filled: 4, left: 8}, {name: 'Hold', host: 'b.com', reached: 'code/bot'}, {name: 'Gone', host: 'g.com', reached: 'none', note: 'posting gone (HTTP 404)'}, {name: 'Ready', host: 'r.com', reached: 'ready', filled: 5, left: 0}]}, now);
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.deepEqual(by.Short.short, {done: 4, total: 12, unexplained: null});
  assert.deepEqual(by.Short.shares, [25, 33]);   // each run's filled share, oldest first
  assert.equal(by.Half.short, null);
  assert.equal(by.Early.short, null);
  assert.equal(d.tiles.needFix, 2);   // Short (under half) and Early (stopped at the posting); a bot check, a posting gone, a ready form and half-filled are not
  assert.ok(PAGE.includes('Needs a fix') && PAGE.includes("'form · ' + shortText(s)"), 'the page lists them and draws the red pill');
});

test('no column but the first breaks its text over lines, and the badge and its date share one line (owner, 10 Oct 2026)', () => {
  assert.ok(PAGE.includes('table td:not(:first-child),table th:not(:first-child){white-space:nowrap}'), 'cells after the first never wrap');
  assert.ok(PAGE.includes('details table td:not(:first-child),details table th:not(:first-child),.legend td:last-child{white-space:normal;overflow-wrap:anywhere}'), 'the legend\'s long meaning column and every table in a details box (the AI ladder\'s paths) may wrap');
  assert.ok(!PAGE.includes("s.day ? el('div', {className: 'muted', textContent: s.day})"), 'the date is a span beside the badge, not a block under it');
});

test('the runner\'s verdict decides: a form whose left fields are all expected is fine however little is filled; unexplained fields make it red (owner, 10 Oct 2026)', async () => {
  assert.equal(shortOf('form', 4, 8, 12, 0), null);   // 4 of 12 filled, but every left field is expected (a suggestion shown, or a legal choice)
  assert.deepEqual(shortOf('form', 9, 3, 12, 3), {done: 9, total: 12, unexplained: 3});   // 9 filled, yet 3 left fields are unexplained
  assert.deepEqual(shortOf('form', 4, 8), {done: 4, total: 12, unexplained: null});   // no verdict (an older run): the counts, under half
  assert.equal(shortOf('posting', 0, 0, 5, 5), null);
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Fine', host: 'f.com', reached: 'form', filled: 4, left: 8, asked: 12, unexplained: 0}, {name: 'Red', host: 'r.com', reached: 'form', filled: 9, left: 3, asked: 12, unexplained: 3},
    {name: 'Junk', host: 'j.com', reached: 'form', filled: 1, left: 1, asked: 'many', unexplained: -1}]}, now);
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.equal(by.Fine.short, null);
  assert.deepEqual(by.Red.short, {done: 9, total: 12, unexplained: 3});
  assert.equal(by.Junk.short, null);   // a bad verdict is dropped and the counts decide: 1 of 2 is half, not under
});

test('Needs a fix is ordered worst first: a regression, then the most used platform, then the earliest stop, never alphabetical (owner, 10 Oct 2026)', async () => {
  const script = PAGE.split('<script>')[1].split('</script>')[0];
  const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
    append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
    text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
  const row = (name, platform, reached, extra = {}) => ({name, platform, flow: '', start: 'x.com', end: '', reached, history: [reached], status: rowStatus({reached, ...extra}), states: [{...rowStatus({reached, ...extra}), step: reached}], at: '2026-10-10T10:00:00Z', day: '2026-10-10', raw: '', short: null, shares: [], regression: false, running: false, note: null, rung: null, signal: null, cause: null, ...extra});
  const body = {tiles: {}, cases: [], fixed: {rows: [], inProgress: []}, platforms: [], flows: [], nights: [], steps: ['none', 'posting', 'account', 'code/bot', 'form', 'ready'], states: STATES, stateWords: STATE_WORD, sites: [], dropped: [], now: '2026-10-10T12:00:00Z', next: {sites: [], hidden: {hosts: 0}},
    pool: [row('Aaa small site', 'Custom', 'posting'), row('Bbb big platform', 'Greenhouse', 'posting'), row('Ccc regressed', 'Custom', 'account', {regression: true}), row('Ddd big form', 'Greenhouse', 'form', {short: {done: 9, total: 12, unexplained: 3}}), row('Eee other big', 'Greenhouse', 'account')],
    scorecard: [{platform: 'Greenhouse', verdict: 'Fine', matchShare: 54}, {platform: 'Custom', verdict: 'Fine', matchShare: 1}]};
  const app = make('div');
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, async () => ({json: async () => body}), () => ({}), {escape: x => x}, () => 0, Object);
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = app.text(), section = text.slice(text.indexOf('Needs a fix'), text.indexOf('The pool'));
  const order = ['Ccc regressed', 'Bbb big platform', 'Eee other big', 'Aaa small site', 'Ddd big form'].map(name => section.indexOf(name));
  assert.ok(order.every(at => at > 0), 'every row is listed: ' + order);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'regression first, then every stop before the form (the big platform first), then the forms with fields left, even on the big platform');
  assert.ok(text.includes('54%'), 'the platform use is shown');   // by the scorecard (Coverage tab): a Needs a fix row shows it only when opened
});

test('the owner can delete one smoke run row (a run that should never have been sent): by kind, name and day; a missing name or an unknown kind removes nothing', async () => {
  const {forget} = await import('../src/applying.js');
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'bad-case-1', host: 'a.com', reached: 'form'}, {name: 'good-case-1', host: 'a.com', reached: 'form'}]}, now);
  assert.deepEqual(await forget(db, {kind: 'smoke', day: '2026-10-12'}), {ok: false, error: 'kind, day and name are needed'});
  assert.equal((await forget(db, {kind: 'recorded', day: '2026-10-12', name: 'bad-case-1'})).ok, false);   // the replays are CI's, never a run row
  assert.equal((await forget(db, {kind: 'running', day: '2026-10-12', name: 'bad-case-1'})).ok, false);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM applying_runs').get().n, 2);
  assert.deepEqual(await forget(db, {kind: 'smoke', day: '2026-10-12', name: 'bad-case-1'}), {ok: true, removed: 1});
  assert.deepEqual(db.db.prepare('SELECT name FROM applying_runs').all().map(row => row.name), ['good-case-1']);
});

// The pool table's search (owner, 11 Oct 2026): words in any order over the site's name, platform, host, flow, last result and its blocked/regression text; with the two filters; Clear empties it.
test('the pool search matches words in any order over name, platform, host, flow and result, and combines with the filters', () => {
  const snippet = PAGE.slice(PAGE.indexOf('/*search*/'), PAGE.indexOf('/*end search*/'));
  assert.ok(snippet.length > 100, 'the search code is on the page');
  const matches = new Function('flowText', 'STAGE', 'shortText', 'blocked', 'd', `${snippet}; return poolMatches;`)(s => s.flow || '—', {posting: 'Posting reached', form: 'Form reached'}, s => `${s.short.unexplained} unexplained of ${s.short.total}`, s => s.reached === 'posting' && s.rung != null, {stateWords: STATE_WORD});
  const aldi = {name: 'Aldi Suisse jobs', platform: 'Custom', start: 'www.jobs.aldi.ch', flow: 'Posting', reached: 'posting', rung: 2, status: rowStatus({reached: 'posting'})};
  const bulgari = {name: 'Bulgari', platform: 'Custom', start: 'recruitmentplatform.com', flow: 'Posting → form', reached: 'form', short: {unexplained: 1, total: 14}, rung: 2, status: {state: 'fix', rule: ''}};
  const ashby = {name: 'Ashby form in an embedded app', platform: 'Ashby', start: 'jobs.ashbyhq.com', flow: 'Posting → form', reached: 'form', regression: true, status: {state: 'fix', rule: ''}};
  assert.equal(matches(aldi, ''), true); assert.equal(matches(aldi, '   '), true);                       // nothing typed: every site
  assert.equal(matches(aldi, 'ALDI'), true); assert.equal(matches(aldi, 'suisse aldi'), true);         // case and word order do not matter
  assert.equal(matches(aldi, 'aldi.ch'), true); assert.equal(matches(aldi, 'jobs.aldi'), true);       // the host
  assert.equal(matches(aldi, 'blocked'), true); assert.equal(matches(aldi, 'blocked at 2'), true);    // the red cell's text
  assert.equal(matches(bulgari, 'blocked'), false); assert.equal(matches(bulgari, '1 unexplained'), true); assert.equal(matches(bulgari, 'form reached'), true);
  assert.equal(matches(ashby, 'ashby regression'), true); assert.equal(matches(ashby, 'ashby aldi'), false);   // every word must match
  assert.equal(matches(ashby, 'lever'), false);
});

test('the pool search is an input of the filter bar, resets the page, is combined with the two filters and is emptied by Clear', () => {
  assert.match(PAGE, /el\('input', \{type: 'search', placeholder: 'Site, platform, host or result'/);
  assert.match(PAGE, /oninput: event => \{ chosen\.query = event\.target\.value; chosen\.page = 0; draw\(\); \}/);
  assert.match(PAGE, /\(!c\.flow \|\| s\.flow === c\.flow\) && poolMatches\(s, c\.query\)/);
  assert.match(PAGE, /chosen\.query = ''; chosen\.page = 0;[\s\S]{0,160}search\.value = ''/);                    // Clear
  assert.match(PAGE, /clear\.hidden = !chosen\.platform && !chosen\.flow && !endingPick && !chosen\.stage && !chosen\.query/);
  assert.match(PAGE, /\.pick input\[type=search\]/);
});

// A documented hold (owner, 11 Oct 2026): an account-first site (the smoke never creates the account) and an eligibility stop are deliberate stops, not a fix
// and not a posting gone. The runner notes them (desktop/e2e/lib/record-sites.mjs parseLive); only "posting gone" and "no posting" notes are gone.
test('a hold is in no Needs-a-fix group, is not counted as a posting gone, and stays a live site', async () => {
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Hornbach', host: 'h.com', reached: 'account', note: 'account-first: held'},
    {name: 'Eligible', host: 'e.com', reached: 'form', note: 'eligibility stop: the role is in Sydney'}, {name: 'Gone', host: 'g.com', reached: 'none', note: 'posting gone (HTTP 404)'},
    {name: 'Stuck', host: 's.com', reached: 'account'}]}, now);
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.shape, item]));
  assert.deepEqual([by.Hornbach.hold, by.Eligible.hold, by.Gone.hold, by.Stuck.hold], [true, true, false, false]);
  assert.deepEqual([d.tiles.gone, d.tiles.held, d.tiles.needFix], [1, 2, 1]);
  assert.equal(d.tiles.reachedForm, 33, 'holds are live sites: 1 of 3 reached the form (the posting gone is not counted)');
  assert.deepEqual(needsFixGroups(d.pool, d.scorecard, d.steps, d.fixed.rows).flatMap(group => group.rows.map(row => row.shape)), ['Stuck']);
  assert.deepEqual([by.Hornbach.status.state, by.Eligible.status.state, by.Gone.status.state, by.Stuck.status.state], ['held', 'held', 'site', 'fix']);
  assert.ok(PAGE.includes("'pill st-' + s.status.state") && PAGE.includes('d.stateWords[state]'), 'the pool row and the legend name a hold as its own status');
  assert.ok(PAGE.includes("s.status.state === 'held' ? 'stack hold'"), 'the pool row draws a hold as a hold, not as a gone posting');
});

// The digest's own stops (desktop/e2e/lib/record-sites.mjs SITE_REFUSED, LOGIN_WALL) are documented holds like the account-first one, but only account-first is a clean run.
test('a refusing site and a login wall are holds, not fixes, and not clean runs', async () => {
  const {isHold} = await import('../src/applying.js'), {isCleanHold, rowStatus} = await import('../src/applying-status.js');
  for (const note of ['site refused: retry later', 'login wall: held', 'applies by email: told', 'page tells how to apply: told', 'account-first: held']) assert.equal(isHold(note), true, note);
  // Fixed tab (owner, 14 Oct 2026): every hold but the eligibility stop is a clean run; a site problem is neither.
  assert.deepEqual(['account-first: held', 'login wall: held', 'applies by email: told', 'page tells how to apply: told', 'eligibility stop: the role is in Sydney', 'site refused: retry later'].map(note => isCleanHold(rowStatus({reached: 'form', note}))), [true, true, true, true, false, false]);
  assert.equal(isCleanHold(rowStatus({reached: 'code/bot'})), true);
});

// 14 Oct 2026 (record-once spec): a renamed pool row stayed on the page for ever (applying_pool was upsert-only): three rows named "Hm". A FULL pool upload is the pool's membership.
test('a full pool upload drops the names it lacks (hidden, runs kept); a partial one drops nothing; a dropped name returns when uploaded or run again', async () => {
  const db = d1(), later = new Date('2026-10-13T12:00:00Z'), names = async () => (await data(db, later)).pool.map(item => item.shape).sort();
  const pool = list => list.map(name => ({name, start_host: 'career.hm.com'}));
  const base = Array.from({length: 6}, (_, index) => `Row ${index}`);
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: pool([...base, 'old@career.hm.com (found 2026-10-10)'])}, now);
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'old@career.hm.com (found 2026-10-10)', reached: 'posting'}]}, now);
  assert.ok((await names()).includes('old@career.hm.com (found 2026-10-10)'));
  await ingest(db, {kind: 'pool', day: '2026-10-13', rows: pool(base.slice(0, 2))}, later);   // partial: drops nothing
  assert.equal((await names()).length, 7, 'a partial upload never drops');
  await ingest(db, {kind: 'pool', day: '2026-10-13', full: true, rows: pool(base.slice(0, 1))}, later);   // "full" but under half the stored pool: ignored
  assert.equal((await names()).length, 7, 'a full upload holding under half the pool is ignored');
  await ingest(db, {kind: 'pool', day: '2026-10-13', full: true, rows: pool([...base, 'Renamed row'])}, later);   // the real full list: the old name is gone
  assert.ok(!(await names()).includes('old@career.hm.com (found 2026-10-10)'), 'the renamed row disappears');
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM applying_runs WHERE name LIKE 'old@%'").get().n, 1, 'its run history stays');
  await ingest(db, {kind: 'smoke', day: '2026-10-14', rows: [{name: 'old@career.hm.com (found 2026-10-10)', reached: 'posting'}]}, new Date('2026-10-14T12:00:00Z'));
  assert.ok((await data(db, new Date('2026-10-14T12:00:00Z'))).pool.some(item => item.shape.startsWith('old@')), 'a dropped name runs again: it is back');
  await ingest(db, {kind: 'pool', day: '2026-10-14', full: true, rows: pool([...base, 'Renamed row'])}, new Date('2026-10-14T13:00:00Z'));   // a later full upload: it stays visible only because it ran after being dropped
  await ingest(db, {kind: 'pool', day: '2026-10-15', rows: pool(['old@career.hm.com (found 2026-10-10)'])}, new Date('2026-10-15T12:00:00Z'));   // listed again
  assert.ok((await data(db, new Date('2026-10-15T12:00:00Z'))).pool.some(item => item.shape.startsWith('old@')), 'a dropped name uploaded again comes back');
});
