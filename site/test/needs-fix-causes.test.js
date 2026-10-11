// "Needs a fix" by cause (site/src/applying-groups.js): ONE function groups the Needs a fix rows by their top cause and puts the rows that need a pool run, not a fix, first
// ("Run first": the last run is older than the latest landed build, or there is no run at all). The page embeds its source (the "By cause" tab) and tools/needs-fix-causes.mjs
// imports it, so they cannot disagree. Seeded data through the real ingest and data(); the page's own script runs on a tiny DOM; the command reads the same JSON.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {GROUPS_SOURCE, needsFixGroups} from '../src/applying-groups.js';
import {needsFixOrder} from '../src/applying-order.js';
import {groupLines, groupsOf} from '../../tools/needs-fix-causes.mjs';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');

async function seeded({newBuild = false} = {}) {
  const db = d1();
  const names = ['Aaa fixed since', 'Bbb never run', 'Ccc unread', 'Ddd unread too', 'Eee no option', 'Fff no cause', 'Ggg fine', 'Hhh never run fine'];
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: names.map(name => ({name, start_host: 'jobs.example.com', ...(name === 'Bbb never run' ? {signature: 'posting@jobs.example.com#posting'} : {})}))}, now);
  const run = (version, name, row) => ingest(db, {kind: 'smoke', day: '2026-10-12', version, rows: [{name, host: 'jobs.example.com', ...row}]}, now);
  await run('0.9.180', 'Aaa fixed since', {reached: 'posting'});     // its last run predates the fix landed FOR IT (0.9.185): needs a run, not a fix
  await run('0.9.188', 'Ccc unread', {reached: 'posting'});          // its fix (0.9.185) is older than its run: stays in its cause group
  await run('0.9.170', 'Ddd unread too', {reached: 'account'});      // an old build, but no fix landed for it: stays in its cause group (a build alone moves nothing)
  await run('0.9.188', 'Eee no option', {reached: 'posting'});
  await run('0.9.188', 'Fff no cause', {reached: 'posting'});
  await run('0.9.188', 'Ggg fine', {reached: 'ready', filled: 9, left: 0});
  if (newBuild) await run('0.9.199', 'Ggg fine', {reached: 'ready', filled: 9, left: 0});   // a newer build lands and runs for another site
  const fix = (site, extensionVersion) => ({site, commit: 'abcdef1', extensionVersion, rung: '2', landedAt: '2026-10-11T10:00:00Z', guard: []});
  await ingest(db, {kind: 'fixes', day: '2026-10-12', rows: [fix('Aaa fixed since', '0.9.185'), fix('Ccc unread', '0.9.185')]}, now);
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

test('only the Needs a fix rows are grouped: every row in exactly one group, the groups add up to the Needs a fix count, a row that never ran and is not on the list is not shown', async () => {
  const json = await seeded();
  const groups = needsFixGroups(json.pool, json.scorecard, json.steps, json.fixed.rows), listed = needsFixOrder(json.pool, json.scorecard, json.steps).rows;
  const names = groups.flatMap(group => group.rows.map(row => row.name));
  assert.equal(names.length, listed.length, 'the groups add up to the Needs a fix count');
  assert.equal(new Set(names).size, names.length, 'no row is in two groups');
  assert.deepEqual([...names].sort(), listed.map(row => row.name).sort(), 'the same rows');
  assert.ok(!names.includes('Hhh never run fine') && !names.includes('Ggg fine'), 'never-run rows that are not on Needs a fix, and ready rows, are not shown');
  assert.equal(json.latestBuild, undefined, 'there is no "latest build": a new build alone says nothing about a row');
});

test('rows group by top cause; Run first = never run, or last run before a fix landed for that row; no-cause rows last; each group is a subset', async () => {
  const json = await seeded();
  const groups = needsFixGroups(json.pool, json.scorecard, json.steps, json.fixed.rows);
  assert.deepEqual(groups.map(group => [group.label, group.count, group.rows.map(row => row.name)]), [
    ['Run first', 2, ['Bbb never run', 'Aaa fixed since']],   // never run first, then a run that predates its fix
    ['unread', 2, ['Ccc unread', 'Ddd unread too']],
    ['no_option', 1, ['Eee no option']],
    ['No cause recorded', 1, ['Fff no cause']]]);
  assert.deepEqual(groups[0].reasons, ['never run', 'fix 0.9.185 landed since its last run']);
  assert.deepEqual(groups.map(group => [group.claimed, group.neverRun]), [[1, 1], [1, 0], [0, 0], [0, 0]]);   // claims count rows; the session is never on the site
  assert.ok(groups[1].oldest && groups[3].oldest, 'the oldest run of the rows that have one');
});

test('a new build alone moves nothing into Run first (cc, 11 Oct 2026: every landing bumps the build)', async () => {
  const before = needsFixGroups(...Object.values((({pool, scorecard, steps, fixed}) => ({pool, scorecard, steps, rows: fixed.rows}))(await seeded())));
  const afterJson = await seeded({newBuild: true});
  const after = needsFixGroups(afterJson.pool, afterJson.scorecard, afterJson.steps, afterJson.fixed.rows);
  const shape = groups => groups.map(group => [group.label, group.rows.map(row => row.name)]);
  assert.deepEqual(shape(after), shape(before));
  assert.ok(afterJson.pool.some(row => row.version === '0.9.199'), 'the newer build really was uploaded');
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
