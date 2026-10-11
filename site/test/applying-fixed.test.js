// /admin/applying's Fixed tab (src/applying-fixed.js): the fix ledger the Mac uploads (desktop/e2e/lib/fix-ledger.mjs), joined with the smoke runs already uploaded:
// a fix is "landed" until an uploaded run after it clears the row ("confirmed"), and "back" when a later run lists it again. Claims show "In progress" on the Needs a fix tab.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const at = iso => new Date(iso);
const FIX = {site: 'Hornbach SuccessFactors', commit: 'fdbdc23', extensionVersion: '0.9.181', rung: '2', landedAt: '2026-10-11T00:41:50+02:00', guard: ['fixture:hornbach-successfactors', 'recorded:named-control-absent-1']};
const smoke = (db, iso, row) => ingest(db, {kind: 'smoke', day: iso.slice(0, 10), rows: [{name: 'Hornbach SuccessFactors', host: 'jobs.hornbach.com', ...row}]}, at(iso));
const fixedRow = async (db, now) => (await data(db, at(now))).fixed.rows.find(row => row.site === FIX.site);

test('a fix upload keeps fixed values only; a site name with an address or a query string, a bad hash or guard is dropped', async () => {
  const db = d1();
  const result = await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX,
    {...FIX, site: 'https://jobs.hornbach.com/job/1?token=abc'}, {...FIX, site: 'Leaky ?q=1'}, {...FIX, site: 'Bad hash', commit: 'zzz'},
    {...FIX, site: 'Bad guard', commit: 'abcdef1', guard: ['recorded:../../etc', 'note:Igor Mardari']}]}, at('2026-10-11T08:00:00Z'));
  assert.equal(result.ok, true);
  const rows = db.db.prepare('SELECT site, commit_hash, guard FROM applying_fixes ORDER BY site').all().map(row => ({...row}));
  assert.deepEqual(rows, [{site: 'Bad guard', commit_hash: 'abcdef1', guard: '[]'}, {site: 'Hornbach SuccessFactors', commit_hash: 'fdbdc23', guard: JSON.stringify(FIX.guard)}]);
  assert.equal(JSON.stringify(rows).match(/https?:|\?|=|Igor/), null);
});

test('the ledger is a snapshot: a new upload replaces the old fixes (a corrected mapping removes a wrong row)', async () => {
  const db = d1();
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX, {...FIX, site: 'Wrong row', commit: 'aaaaaaa'}]}, at('2026-10-11T08:00:00Z'));
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T09:00:00Z'));
  assert.deepEqual(db.db.prepare('SELECT site FROM applying_fixes').all().map(row => row.site), [FIX.site]);
});

test('landed -> not better yet -> confirmed -> back: computed from the runs uploaded after the landing, with filled before and after', async () => {
  const db = d1();
  await smoke(db, '2026-10-10T22:00:00Z', {reached: 'posting'});   // before the landing: stopped at the posting
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T08:00:00Z'));
  let row = await fixedRow(db, '2026-10-11T09:00:00Z');
  assert.deepEqual([row.status, row.failingRuns, row.platform, row.commit, row.rung], ['landed', 0, 'Custom', 'fdbdc23', '2']);
  await smoke(db, '2026-10-11T10:00:00Z', {reached: 'posting'});   // a run after the landing that still fails
  row = await fixedRow(db, '2026-10-11T11:00:00Z');
  assert.deepEqual([row.status, row.failingRuns], ['landed', 1]);
  await smoke(db, '2026-10-11T22:00:00Z', {reached: 'form', filled: 8, left: 3});   // the row clears once: NOT confirmed (owner, 11 Oct 2026: one clean run can be luck)
  row = await fixedRow(db, '2026-10-12T08:00:00Z');
  assert.deepEqual([row.status, row.failingRuns, row.cleanRuns], ['landed', 1, 1]);
  await smoke(db, '2026-10-12T09:00:00Z', {reached: 'form', filled: 8, left: 3});   // a second clean run confirms
  row = await fixedRow(db, '2026-10-12T10:00:00Z');
  assert.deepEqual([row.status, row.confirmedAt, row.filledBefore, row.filledAfter], ['confirmed', '2026-10-12T09:00:00.000Z', [null], [null, 73, 73]]);
  await smoke(db, '2026-10-12T22:00:00Z', {reached: 'account'});   // listed again
  const d = await data(db, at('2026-10-13T08:00:00Z'));
  row = d.fixed.rows.find(item => item.site === FIX.site);
  assert.equal(row.status, 'back');
  assert.equal(d.pool.find(item => item.name === FIX.site).back, true);   // tab 1 shows a Back marker on the row
});

test('a fix for a site the pool does not list still shows, as landed; the guard keeps its recorded case\'s dots; a replay no fix names is not listed', async () => {
  const db = d1();
  await ingest(db, {kind: 'recorded', day: '2026-10-11', version: '0.9.181', rows: [{name: 'named-control-absent-1', ok: true}, {name: 'cookie-banner-links-1', ok: false}]}, at('2026-10-11T09:00:00Z'));
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX]}, at('2026-10-11T08:00:00Z'));
  const d = await data(db, at('2026-10-11T10:00:00Z'));
  const [row] = d.fixed.rows;
  assert.deepEqual([row.status, row.platform, row.cases.map(item => [item.name, item.history])], ['landed', '—', [['named-control-absent-1', [1]]]]);
  assert.equal(d.fixed.replays, undefined);   // a replay no fix names is not a fix: it stays in the Fixed-site replays table (d.cases), not here
  assert.deepEqual(d.cases.map(item => item.name).sort(), ['cookie-banner-links-1', 'named-control-absent-1']);
});

test('claims: a snapshot of names and since, "as of" the upload; the Needs a fix row carries "In progress"', async () => {
  const db = d1();
  await smoke(db, '2026-10-11T07:00:00Z', {reached: 'posting'});
  await ingest(db, {kind: 'claims', day: '2026-10-11', rows: [{name: 'Hornbach SuccessFactors', since: '2026-10-11T06:00:00.000Z', session: 'job-pilotto-81'}]}, at('2026-10-11T08:00:00Z'));
  let d = await data(db, at('2026-10-11T09:00:00Z'));
  assert.deepEqual(d.fixed.inProgress, [{site: 'Hornbach SuccessFactors', since: '2026-10-11T06:00:00.000Z'}]);   // names and since only: no session
  assert.equal(d.fixed.claimsAt, '2026-10-11T08:00:00.000Z');
  assert.equal(d.pool.find(item => item.name === FIX.site).claimed, '2026-10-11T06:00:00.000Z');
  assert.equal((await ingest(db, {kind: 'claims', day: '2026-10-11', rows: []}, at('2026-10-11T10:00:00Z'))).ok, true);   // an empty list releases them all
  d = await data(db, at('2026-10-11T11:00:00Z'));
  assert.deepEqual([d.fixed.inProgress, d.pool[0].claimed], [[], null]);
});

test('each pool row carries its own runs (last 20: day, at, reached, filled, left, version) and its shape name', async () => {
  const db = d1();
  for (let night = 1; night <= 22; night++) await smoke(db, `2026-10-${String(night).padStart(2, '0')}T22:00:00Z`, {reached: 'form', filled: night, left: 1});
  const [item] = (await data(db, at('2026-10-23T08:00:00Z'))).pool;
  assert.equal(item.shape, 'Hornbach SuccessFactors');
  assert.equal(item.runs.length, 20);
  assert.deepEqual(Object.keys(item.runs[0]).sort(), ['at', 'day', 'filled', 'left', 'needsFix', 'reached', 'version']);
});

test('each fixed row carries what the expander shows: its host, every commit, and its runs with the ones after the landing marked', async () => {
  const db = d1();
  await smoke(db, '2026-10-10T22:00:00Z', {reached: 'posting'});
  await ingest(db, {kind: 'fixes', day: '2026-10-11', rows: [FIX, {...FIX, commit: 'f5975be', extensionVersion: '0.9.182', landedAt: '2026-10-11T00:52:34+02:00', rung: '3'}]}, at('2026-10-11T08:00:00Z'));
  await smoke(db, '2026-10-11T10:00:00Z', {reached: 'form', filled: 8, left: 3});
  const row = await fixedRow(db, '2026-10-11T11:00:00Z');
  assert.equal(row.host, 'jobs.hornbach.com');
  assert.deepEqual(row.fixes.map(item => [item.commit, item.extensionVersion, item.rung]), [['fdbdc23', '0.9.181', '2'], ['f5975be', '0.9.182', '3']]);
  assert.deepEqual(row.runs.map(item => [item.reached, item.after, item.share]), [['posting', false, null], ['form', true, 73]]);
  assert.equal(row.status, 'landed');   // one run after the LATEST landing cleared it: one clean run is not enough
  assert.equal(row.cleanRuns, 1);
});

test('the page: two tabs by URL hash, one charcoal panel (title, one sentence, "How verification works", toolbar, table, footer), five columns from heads(), a row expander', () => {
  assert.match(PAGE, /tab\('needs-fix'/); assert.match(PAGE, /tab\('fixed'/); assert.match(PAGE, /hash === '#fixed'/); assert.match(PAGE, /hashchange/);   // tabs by URL hash
  assert.match(PAGE, /heads\('fixed', \['Site \/ platform', 'Verification', 'Filled before → after', 'Fix', 'Details'\]/);
  assert.match(PAGE, /heads\('cases', \['Case', 'Rung guarded', 'Result', 'Last 10 runs', 'Last run', 'Since'\]/);   // the Fixed-site replays table is back, as it was (owner, 11 Oct 2026)
  assert.match(PAGE, /Fixed-site replays · every fixed site, replayed/);
  assert.doesNotMatch(PAGE, /'Guard'/);   // the Guard column is the expander now
  assert.match(PAGE, /Every landed fix is "Awaiting verification" until two uploaded runs clear it\./);
  assert.match(PAGE, /How verification works/);
  for (const word of ['Awaiting verification', 'Still failing', 'Confirmed', 'Regressed', 'No confirming run yet']) assert.ok(PAGE.includes(word), word);
  for (const old of ['Landed, unconfirmed', 'Landed, not better yet']) assert.ok(!PAGE.includes(old), old + ' is gone');
  assert.match(PAGE, /does not say how much more was filled/);   // Confirmed never implies the fill went up
  assert.match(PAGE, /Sites with a landed fix/);   // the tab's tooltip says what it counts
  assert.doesNotMatch(PAGE, /Replay only|replay-only/);   // the replays are their own table again, never rows here
  assert.match(PAGE, /padding:12px 16px/);
});

test('the two tabs are real tabs joined to the content: a tablist whose active tab shares the panel background, no gap between the strip and the panel', () => {
  assert.match(PAGE, /role: 'tablist'/); assert.match(PAGE, /role: 'tab'/); assert.match(PAGE, /'aria-selected'/);
  assert.match(PAGE, /\.tabs a\{[^}]*margin-bottom:-1px/);   // the tab overlaps the strip's line
  assert.match(PAGE, /\.tabs a\.on\{[^}]*background:var\(--card\)/);   // the active tab is the panel's own colour
  assert.match(PAGE, /\.tabs ~ section\.bycause\{[^}]*margin-top:0/);   // no gap under the strip
  assert.doesNotMatch(PAGE, /className: 'chip' \+ \(fixed/);   // the old chip buttons are gone
});

test('both tabs sit in the same panel: Needs a fix is a .fixpanel with the same card background, header, flat toolbar and 12px/16px cells as Fixed', () => {
  assert.match(PAGE, /fixBox\.append\(el\('div', \{className: 'fixpanel'\}, el\('div', \{className: 'fixhead'\}/);
  assert.match(PAGE, /\.tabs ~ section \.fixpanel\{[^}]*border-radius:0 0 12px 12px/);   // one rule for both panels
  assert.match(PAGE, /\.fixpanel \.filters\{[^}]*border:0/);   // the toolbar is flat inside the panel, not a second box
  assert.match(PAGE, /\.fixpanel td,\.fixpanel th\{padding:12px 16px/);
});

test('every paged table of the tabs and sections that share the block() helper shows 10 rows a page, the Fixed table too (owner, 11 Oct 2026); the pool keeps its own 15', () => {
  assert.match(PAGE, /NEXT_PER = 10\b/);
  assert.match(PAGE, /FIX_PER = NEXT_PER\b/);   // Fixed follows the same size, never its own number
  assert.match(PAGE, /const PER = 15\b/);
  assert.doesNotMatch(PAGE, /NEXT_PER = 5\b|FIX_PER = 5\b/);
});

test('the six metrics sit in one row: one strip, a big number, a short label and a small note each; 3 columns on a tablet, 2 on a phone; the long wording moved into a tooltip (owner, 11 Oct 2026)', () => {
  assert.match(PAGE, /\.tiles\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(PAGE, /@media \(max-width:1000px\)\{\.tiles\{grid-template-columns:repeat\(3,/); assert.match(PAGE, /@media \(max-width:520px\)\{\.tiles\{grid-template-columns:repeat\(2,/);
  for (const label of ['Replay checks passing', 'Smoke sites tested', 'Reached the form', 'Open regressions', 'Sites needing a fix', 'Boards dropped']) assert.ok(PAGE.includes(label), label);
  for (const old of ['fixed-site replays passing', 'smoke sites run in the last 10 nights', 'sites need a fix (stopped early', 'boards dropped in the fleet (layer 4)']) assert.ok(!PAGE.includes(old), old + ' is gone');
  assert.match(PAGE, /Stopped early, unexplained fields, or a regression/);   // the explanation is kept, as the tile's note and tooltip
  assert.equal((PAGE.match(/ tile\(/g) || []).length, 6, 'still six metrics, none dropped');
});

test('Needs a fix fits its panel: the row keeps Site / platform, Why, Last run and a Details expander; platform use, top cause and the filled runs live in the expander (owner, 11 Oct 2026)', () => {
  assert.match(PAGE, /block\('fix', 'Sites', [^\n]*\['Site \/ platform', 'Why', 'Last run', 'Details'\]/);
  const detail = PAGE.slice(PAGE.indexOf('const needDetail'), PAGE.indexOf('const drawFix = '));
  for (const part of ['Platform use', 'Top cause', 'Filled, last runs', 'Last run']) assert.ok(detail.includes(part), part + ' is reachable in the expander');
  assert.doesNotMatch(PAGE, /\['Site', 'Platform', 'Platform use', 'Why'/);   // the seven-column header is gone
});

test('one row open at a time in every table with an expander (the pool, Fixed, Needs a fix): they all flip through one helper that closes the others (owner, 11 Oct 2026)', () => {
  const helper = PAGE.match(/const toggleOpen = [^\n]*/)?.[0];
  assert.ok(helper, 'toggleOpen exists');
  const toggle = new Function(helper.replace(/^const toggleOpen = /, 'return ').replace(/;$/, ''))();
  const set = new Set();
  toggle(set, 'a'); toggle(set, 'b'); assert.deepEqual([...set], ['b']);   // opening b closes a
  toggle(set, 'b'); assert.deepEqual([...set], []);   // pressing the open one closes it
  for (const call of ['toggleOpen(open, s.shape)', 'toggleOpen(fixOpen, r.site)', 'toggleOpen(needOpen, s.shape)']) assert.ok(PAGE.includes(call), call);
  assert.doesNotMatch(PAGE, /\b\w*[oO]pen\.add\(/);   // nobody adds to an open set by hand
  assert.doesNotMatch(PAGE, /\b\w*[oO]pen\.has\(s\.name\)/);   // a pool row's name is its display name, not unique
});

// Two pool sites whose display names collide ("Ashbyhq" from two discovered shapes): pressing one opened both (owner, 11 Oct 2026). Every pool-fed
// table (the pool, Needs a fix) keys its open row by the unique shape. Runs the page script on a tiny fake DOM, presses each row, counts open rows.
test('pressing a row opens that row only, even when two pool sites share a display name (owner, 11 Oct 2026)', async () => {
  const script = PAGE.split('<script>')[1].split('</script>')[0], all = [];
  const make = tag => { const node = {tag, children: [], hidden: false, style: {}, className: '', set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
    append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
    text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }}; all.push(node); return node; };
  const row = shape => ({name: 'Twin', shape, platform: 'Custom', flow: '', start: 'x.com', end: '', reached: 'posting', history: ['posting'], at: '2026-10-10T10:00:00Z', day: '2026-10-10', raw: '', short: null, shares: [], regression: false, running: false, note: null, rung: null, signal: null, cause: null});
  const body = {tiles: {}, cases: [], fixed: {rows: [], inProgress: []}, platforms: [], flows: [], nights: [], steps: ['none', 'posting', 'account', 'code/bot', 'form', 'ready'], sites: [], dropped: [], now: '2026-10-10T12:00:00Z', next: {sites: [], hidden: {hosts: 0}},
    pool: [row('posting@x.com (found 2026-10-10)'), row('other@x.com (found 2026-10-10)')], scorecard: []};
  const app = make('div'), document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, async () => ({json: async () => body}), () => ({}), {escape: x => x}, () => 0, Object);
  await new Promise(resolve => setTimeout(resolve, 20));
  const live = node => node === app || app.children.some(function seen(kid) { return kid === node || (typeof kid === 'object' && kid.children.some(seen)); });
  const rows = () => all.filter(node => node.tag === 'tr' && /\bsite\b/.test(node.className) && node.text().includes('Twin') && live(node));
  const tables = () => all.filter(node => node.tag === 'table' && live(node) && rows().some(tr => node.children.includes(tr)));
  assert.equal(tables().length, 2, 'the pool and Needs a fix both list the twins');
  for (const at of [0, 1]) {
    for (const table of tables()) {
      const mine = table.children.filter(tr => rows().includes(tr));
      assert.equal(mine.length, 2, 'both twins listed');
      mine[at].onclick();
      const after = tables().find(t => t.className === table.className), open = after.children.filter(tr => rows().includes(tr) && /\bopen\b/.test(tr.className));
      assert.equal(open.length, 1, `${table.className || 'table'}: pressing twin ${at} opens exactly one row`);
      open[0].onclick();   // close it again for the next round
    }
  }
});

// A discovered site shows a short display name ("Ashbyhq") while its smoke runs, fill cards and claims carry the full shape: the server joins them by the shape.
test('a pool site with a display name finds its top cause, claim and "back" status by its full shape (owner, 11 Oct 2026)', async () => {
  const {hashOf} = await import('../src/applying-cause.js');
  const db = d1(), now = new Date('2026-10-11T12:00:00Z'), shape = 'Acme (found 2026-10-10)';
  await ingest(db, {kind: 'pool', day: '2026-10-11', rows: [{name: shape, start_host: 'jobs.example.com', signature: 'posting>form@jobs.example.com#form'}]}, now);
  await db.prepare(`INSERT INTO fill_cards (id, day, board, source, causes) VALUES (?, ?, 'ashby', 'pool', ?)`).bind(`pool-2026-10-11-${await hashOf(shape)}`, '2026-10-11', JSON.stringify({menu_not_opened: 3})).run();
  await ingest(db, {kind: 'claims', rows: [{name: shape, since: '2026-10-11T10:00:00Z'}]}, now);
  const site = (await data(db, now)).pool.find(item => item.shape === shape);
  assert.notEqual(site.name, shape, 'the row shows a display name');
  assert.equal(site.cause?.cause, 'menu_not_opened', 'its top cause is found by the shape');
  assert.equal(site.claimed, '2026-10-11T10:00:00.000Z', 'its claim is found by the shape');
});
