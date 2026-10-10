// /admin/applying (src/applying.js): uploads are checked to fixed values, and the page's data shows each site's last step, its trend, regressions and cases.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest, shortOf} from '../src/applying.js';

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
  await ingest(db, {kind: 'recorded', day: '2026-10-11', version: '0.9.165', rows: [{name: 'cookie-banner-links-1', ok: true}, {name: 'cv-choice-step-1', ok: false, note: 'attached: #resumeFile'}]}, now);
  const d = await data(db, now);
  assert.deepEqual(d.sites.map(site => [site.name, site.reached, site.regression, site.history]), [['jobs.ch account', 'posting', true, ['code/bot', 'posting']], ['Lever form', 'ready', false, ['ready']]]);
  assert.deepEqual(d.cases.map(item => [item.name, item.ok, item.note]), [['cv-choice-step-1', false, 'attached: #resumeFile'], ['cookie-banner-links-1', true, null]]);
  assert.deepEqual([d.tiles.cases, d.tiles.casesFailing, d.tiles.sites, d.tiles.regressions, d.tiles.reachedForm], [2, 1, 2, 1, 50]);
  assert.deepEqual(d.nights.map(night => [night.day, night.counts['code/bot'], night.counts.ready, night.counts.posting]), [['2026-10-10', 1, 1, 0], ['2026-10-11', 0, 0, 1]]);
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
  await ingest(db, {kind: 'recorded', day: '2026-10-12', rows: [{name: 'case-1', ok: true, rung: 2}, {name: 'case-2', ok: true, rung: 7}, {name: 'case-3', ok: true}]}, now);
  const rows = Object.fromEntries(db.db.prepare('SELECT name, rung, signal FROM applying_runs').all().map(row => [row.name, {...row}]));
  assert.deepEqual([rows.A.rung, rows.A.signal, rows.B.rung, rows.B.signal, rows.C.rung, rows.C.signal, rows.D.rung, rows.D.signal], [3, 'unsure', null, null, null, 'stalled', 0, null]);
  assert.deepEqual([rows['case-1'].rung, rows['case-2'].rung, rows['case-3'].rung], [2, null, null]);
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [{name: 'A', start_host: 'a.com'}, {name: 'Z', start_host: 'z.com'}]}, now);
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.deepEqual([by.A.rung, by.A.signal, by.Z.rung, by.Z.signal], [3, 'unsure', null, null]);   // never run: unknown
  assert.deepEqual(d.cases.map(item => [item.name, item.rung]).sort(), [['case-1', 2], ['case-2', null], ['case-3', null]]);
});

test('the page shows the ladder as a legend collapsed by default, a Rung column in the pool and a Rung guarded column in the replays', () => {
  const legend = PAGE.slice(PAGE.indexOf('The AI ladder'), PAGE.indexOf('What the colors mean'));
  assert.match(PAGE, /<details|'details'/); assert.doesNotMatch(legend, /open: true/);   // collapsed
  for (const where of ['extension/tab-pages.js', 'page-kinds.json', 'desktop/lib/page-kind.js', 'desktop/lib/ladder/rung3-digest.js', 'extension/ladder/rung3-candidates.js', 'desktop/lib/ladder/rung4-picture.js', 'desktop/lib/ladder/rung5-takeover.js', 'the session card']) assert.ok(legend.includes(where), where);
  assert.ok(legend.includes('A rung that is unsure or contradicted hands the page to the next; a rung never guesses.'));
  assert.match(PAGE, /heads\('pool', \[[^\]]*'Rung'/); assert.match(PAGE, /heads\('cases', \[[^\]]*'Rung guarded'/);
  assert.match(PAGE, /blocked at /);
});

test('every file the ladder legend names exists on disk, so the legend cannot drift (a rung not built yet says so instead of naming a file)', () => {
  const rungs = PAGE.slice(PAGE.indexOf('const RUNGS'), PAGE.indexOf('app.append(el(\'details\''));
  const files = [...rungs.matchAll(/[\w./-]+\.(?:js|json)\b/g)].map(match => match[0]).filter(file => file !== 'page-kinds.json');   // page-kinds.json is a per-install file, named with the code that keeps it
  assert.ok(files.length >= 7);
  for (const file of files) assert.ok(existsSync(new URL('../../' + file, import.meta.url)), file + ' is not in the repo');
});

test('every table on the page gets its headers from the one sortable helper (owner, 10 Oct 2026: sort by any column, red first)', () => {
  // A table added with its own plain th cells would not sort: only the helper may create a th, and every table's headers come from it.
  // The exceptions are the two fixed legends, the AI ladder and the colors (7 and 6 rows, nothing to sort): their headers are plain, and they are the only tables allowed to build them.
  const legend = PAGE.slice(PAGE.indexOf('The AI ladder'), PAGE.indexOf('const dots = (list'));   // the two fixed legends: the ladder at the top, the colors (the pool table's foot)
  assert.equal(legend.split("el('th'").length - 1, 2, 'a legend lost its plain headers');
  assert.equal(PAGE.replace(legend, '').split("el('th'").length - 1, 1, 'a table builds its own th instead of heads(...)');
  for (const key of ['pool', 'cases']) assert.match(PAGE, new RegExp("heads\\('" + key + "'"));
  assert.equal((PAGE.match(/heads\(key, labels/g) || []).length, 1);   // the next-sites and scorecard blocks share it
});

test('the colors legend is the foot of the pool table, not a section of its own', () => {
  assert.match(PAGE, /filters, table, colorLegend\)/);
  assert.doesNotMatch(PAGE, /app\.append\(colorLegend/);
  assert.ok(PAGE.indexOf('The AI ladder') < PAGE.indexOf('What the colors mean'));
});

test('the Nights chart sits right under the tiles: one row per night, newest first, a labelled segment per step, a key and a reached-the-form share', () => {
  const nights = PAGE.slice(PAGE.indexOf('Nights · where each site got to'));
  assert.ok(PAGE.indexOf('Nights · where each site got to') < PAGE.indexOf('The pool · every smoke site'), 'the chart is at the top');
  assert.ok(PAGE.indexOf("className: 'tiles'") < PAGE.indexOf('Nights · where each site got to'));
  assert.doesNotMatch(PAGE, /className: 'bars'/);   // the old thin vertical bars are gone
  assert.match(nights, /\.slice\(-14\)\.reverse\(\)/);   // the last 14 nights, newest first
  assert.match(nights, /textContent: count/);   // the count is written in its segment
  assert.match(nights, /reached the form/);
  assert.match(nights, /pill\(step\)/);   // a key of the steps
});

test('the page explains its colors: a legend row for every step the page draws', () => {
  assert.match(PAGE, /What the colors mean/);
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
  assert.ok(PAGE.includes('.legend td:last-child{white-space:normal}'), 'the legend\'s long meaning column may wrap');
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
  const row = (name, platform, reached, extra = {}) => ({name, platform, flow: '', start: 'x.com', end: '', reached, history: [reached], at: '2026-10-10T10:00:00Z', day: '2026-10-10', raw: '', short: null, shares: [], regression: false, running: false, note: null, rung: null, signal: null, cause: null, ...extra});
  const body = {tiles: {}, cases: [], platforms: [], flows: [], nights: [], steps: ['none', 'posting', 'account', 'code/bot', 'form', 'ready'], sites: [], dropped: [], now: '2026-10-10T12:00:00Z', next: {sites: [], hidden: {hosts: 0}},
    pool: [row('Aaa small site', 'Custom', 'posting'), row('Bbb big platform', 'Greenhouse', 'posting'), row('Ccc regressed', 'Custom', 'account', {regression: true}), row('Ddd big form', 'Greenhouse', 'form', {short: {done: 9, total: 12, unexplained: 3}}), row('Eee other big', 'Greenhouse', 'account')],
    scorecard: [{platform: 'Greenhouse', verdict: 'Fine', matchShare: 54}, {platform: 'Custom', verdict: 'Fine', matchShare: 1}]};
  const app = make('div');
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, async () => ({json: async () => body}), () => ({}), {escape: x => x}, () => 0, Object);
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = app.text(), section = text.slice(text.indexOf('Needs a fix'), text.indexOf('The pool'));
  const order = ['Ccc regressed', 'Bbb big platform', 'Eee other big', 'Ddd big form', 'Aaa small site'].map(name => section.indexOf(name));
  assert.ok(order.every(at => at > 0), 'every row is listed: ' + order);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'regression first, then the big platform by its earliest stop (posting, account, then the form), then the small site');
  assert.ok(section.includes('54%'), 'the platform use is shown');
});

test('the owner can delete one run row (a case that should never have been sent): by kind, name and day; a missing name or an unknown kind removes nothing', async () => {
  const {forget} = await import('../src/applying.js');
  const db = d1();
  await ingest(db, {kind: 'recorded', day: '2026-10-12', rows: [{name: 'bad-case-1', ok: true}, {name: 'good-case-1', ok: true}]}, now);
  assert.deepEqual(await forget(db, {kind: 'recorded', day: '2026-10-12'}), {ok: false, error: 'kind, day and name are needed'});
  assert.equal((await forget(db, {kind: 'running', day: '2026-10-12', name: 'bad-case-1'})).ok, false);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM applying_runs').get().n, 2);
  assert.deepEqual(await forget(db, {kind: 'recorded', day: '2026-10-12', name: 'bad-case-1'}), {ok: true, removed: 1});
  assert.deepEqual(db.db.prepare('SELECT name FROM applying_runs').all().map(row => row.name), ['good-case-1']);
});
