// "Needs a fix" by cause (site/src/applying-groups.js): ONE function groups the Needs a fix rows by their top cause and puts the rows that need a pool run, not a fix, first
// ("Run first": the last run is older than the latest landed build, or there is no run at all). The page embeds its source (the "By cause" tab) and tools/needs-fix-causes.mjs
// imports it, so they cannot disagree. Seeded data through the real ingest and data(); the page's own script runs on a tiny DOM; the command reads the same JSON.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {GROUPS_SOURCE, needsFixGroups, newestVersion} from '../src/applying-groups.js';
import {groupLines, groupsOf} from '../../tools/needs-fix-causes.mjs';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');

async function seeded() {
  const db = d1();
  const names = ['Aaa stale', 'Bbb never run', 'Ccc unread', 'Ddd unread too', 'Eee no option', 'Fff no cause', 'Ggg fine', 'Hhh stale but fine'];
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: names.map(name => ({name, start_host: 'jobs.example.com'}))}, now);
  const run = (version, name, row) => ingest(db, {kind: 'smoke', day: '2026-10-12', version, rows: [{name, host: 'jobs.example.com', ...row}]}, now);
  await run('0.9.180', 'Aaa stale', {reached: 'posting'});            // older than the latest build: a run, not a fix
  await run('0.9.188', 'Ccc unread', {reached: 'posting'});
  await run('0.9.188', 'Ddd unread too', {reached: 'account'});
  await run('0.9.188', 'Eee no option', {reached: 'posting'});
  await run('0.9.188', 'Fff no cause', {reached: 'posting'});
  await run('0.9.188', 'Ggg fine', {reached: 'ready', filled: 9, left: 0});
  await run('0.9.170', 'Hhh stale but fine', {reached: 'ready', filled: 9, left: 0});   // old build, but nothing to fix: not listed
  await ingest(db, {kind: 'fixes', day: '2026-10-12', rows: [{site: 'Ccc unread', commit: 'abcdef1', extensionVersion: '0.9.185', rung: '2', landedAt: '2026-10-11T10:00:00Z', guard: []}]}, now);
  await ingest(db, {kind: 'claims', day: '2026-10-12', rows: [{name: 'Ddd unread too', since: '2026-10-12T10:00:00Z'}, {name: 'Bbb never run', since: '2026-10-12T09:00:00Z'}]}, now);
  const json = JSON.parse(JSON.stringify(await data(db, now)));
  const cause = {'Ccc unread': 'unread', 'Ddd unread too': 'unread', 'Eee no option': 'no_option'};   // the pool's fill-card causes (src/applying-cause.js), set on the seeded rows
  for (const row of json.pool) row.cause = cause[row.name] ? {cause: cause[row.name], lost: 3, nights: 2} : null;
  return json;
}

// The page's own script on a tiny DOM, fed the same JSON: the text of its "By cause" table.
async function pageText(json) {
  const script = PAGE.split('<script>')[1].split('</script>')[0];
  const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
    append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
    text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
  const app = make('div');
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, async () => ({json: async () => json}), () => ({}), {escape: x => x}, () => 0, Object);
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = app.text(), from = text.indexOf('By cause · what to fix first');
  return text.slice(from, text.indexOf('Nights', from));
}

test('the latest landed build is the newest version seen in the uploaded runs and in the fix ledger', async () => {
  const json = await seeded();
  assert.equal(json.latestBuild, '0.9.188');
  assert.equal(newestVersion(['0.9.9', '0.9.10', null, '', '0.9.188', '0.9.180']), '0.9.188');   // numeric, not alphabetical
  assert.equal(newestVersion([]), null);
});

test('rows group by top cause; Run first (stale build or never run) comes first; rows with no cause are listed last; a stale row with nothing to fix is not listed', async () => {
  const json = await seeded();
  const groups = needsFixGroups(json.pool, json.scorecard, json.steps, json.latestBuild);
  assert.deepEqual(groups.map(group => [group.label, group.count, group.rows.map(row => row.name)]), [
    ['Run first', 2, ['Bbb never run', 'Aaa stale']],   // never run first, then the oldest build
    ['unread', 2, ['Ccc unread', 'Ddd unread too']],
    ['no_option', 1, ['Eee no option']],
    ['No cause recorded', 1, ['Fff no cause']]]);
  assert.deepEqual(groups.map(group => [group.claimed, group.neverRun]), [[1, 1], [1, 0], [0, 0], [0, 0]]);   // claims count rows; the session is never on the site
  assert.ok(groups[0].oldest && groups[1].oldest && groups[3].oldest, 'the oldest run of the rows that have one');
  assert.ok(!groups.flatMap(group => group.rows.map(row => row.name)).some(name => ['Ggg fine', 'Hhh stale but fine'].includes(name)));
});

test('the page and the command give the same groups on the same data', async () => {
  const json = await seeded();
  const fromCommand = groupsOf(json), text = await pageText(json);
  assert.deepEqual(fromCommand.map(group => group.label), ['Run first', 'unread', 'no_option', 'No cause recorded']);
  let at = -1;
  for (const group of fromCommand) {
    const found = text.slice(at + 1).match(new RegExp(group.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\|(?:[^|]*\\|)??(\\d+)\\|([^|]*)\\|'));
    assert.ok(found, 'the page lists ' + group.label + ' after the previous group');
    assert.equal(Number(found[1]), group.count, group.label + ' rows');
    assert.equal(found[2], group.claimed ? group.claimed + ' of ' + group.count : '—', group.label + ' claimed');
    at = text.indexOf(group.label, at + 1);
  }
  const lines = groupLines(json);
  assert.match(lines[0], /cause\s+rows\s+claimed\s+oldest run/);
  assert.match(lines[1], /^Run first\s+2\s+1 of 2\s+never run/);
  assert.match(lines[2], /^unread\s+2\s+1 of 2\s+\d{4}-\d\d-\d\d/);
  assert.equal(lines.length, 5);
  assert.doesNotMatch(lines.join('\n'), /job-pilotto-\d|token|key/i);
});

test('there is one grouping: the page embeds the function\'s own source, has a By cause tab, and no grouping of its own', () => {
  assert.ok(PAGE.includes(GROUPS_SOURCE), 'the page carries needsFixGroups verbatim');
  assert.doesNotMatch(GROUPS_SOURCE, /`|\$\{|\\/, 'the source can sit inside the page template');
  assert.match(PAGE, /#by-cause/); assert.match(PAGE, /'By cause · '/);
  assert.match(PAGE, /block\('causes', [^\n]*\['Cause', 'Rows', 'Claimed', 'Oldest run', 'Details'\]/);
  assert.equal(typeof needsFixGroups, 'function');
});
