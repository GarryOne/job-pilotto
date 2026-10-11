// The Needs a fix order (site/src/applying-order.js) is ONE function: /admin/applying embeds its source and tools/needs-fix-order.mjs imports it, so the page and
// the command cannot disagree. Seeded data through the real ingest and data(); the page's own script runs on a tiny DOM; the command reads the same JSON.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGE, data, ingest} from '../src/applying.js';
import {ORDER_SOURCE, needsFixOrder} from '../src/applying-order.js';
import {orderLines, rankRows} from '../../tools/needs-fix-order.mjs';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');
const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];

async function seeded() {
  const db = d1();
  const pool = [['Aaa small site', 'jobs.small.example'], ['Bbb big platform', 'job-boards.greenhouse.io'], ['Ccc regressed', 'jobs.small.example'], ['Ddd big form', 'job-boards.greenhouse.io'],
    ['Eee other big', 'job-boards.greenhouse.io'], ['Fff gone', 'jobs.small.example'], ['Ggg ready', 'job-boards.greenhouse.io'], ['Hhh bot check', 'jobs.small.example']];
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: pool.map(([name, start_host]) => ({name, start_host}))}, now);
  const run = (name, host, row) => ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name, host, ...row}]}, now);
  await run('Aaa small site', 'jobs.small.example', {reached: 'posting'});
  await run('Bbb big platform', 'job-boards.greenhouse.io', {reached: 'posting'});
  await run('Ccc regressed', 'jobs.small.example', {reached: 'account', regression: true});
  await run('Ddd big form', 'job-boards.greenhouse.io', {reached: 'form', filled: 5, left: 12, asked: 17, unexplained: 6});
  await run('Eee other big', 'job-boards.greenhouse.io', {reached: 'account'});
  await run('Fff gone', 'jobs.small.example', {reached: 'posting', note: 'posting gone'});
  await run('Ggg ready', 'job-boards.greenhouse.io', {reached: 'ready', filled: 9, left: 0});
  await run('Hhh bot check', 'jobs.small.example', {reached: 'code/bot'});
  await ingest(db, {kind: 'claims', day: '2026-10-12', rows: [{name: 'Eee other big', since: '2026-10-12T10:00:00Z'}]}, now);
  const json = JSON.parse(JSON.stringify(await data(db, now)));
  json.scorecard = [{platform: 'Greenhouse', verdict: 'Fine', matchShare: 54}, {platform: 'Custom', verdict: 'Fine', matchShare: 1}];   // real use decides the platform step
  return json;
}

// The page's own script on a tiny DOM, fed the same JSON: the row names of the Needs a fix section, in the order the page draws them.
async function pageOrder(json, names) {
  const script = PAGE.split('<script>')[1].split('</script>')[0];
  const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
    append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
    text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
  const app = make('div');
  const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
  new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, async () => ({json: async () => json}), () => ({}), {escape: x => x}, () => 0, Object);
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = app.text(), section = text.slice(text.indexOf('Needs a fix · where applying stops'), text.indexOf('Nights'));
  return names.map(name => [name, section.indexOf(name)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

test('the page and the command give the same Needs a fix order on the same data', async () => {
  const json = await seeded(), names = json.pool.map(row => row.name);
  const fromCommand = rankRows(json).map(row => row.name), fromPage = await pageOrder(json, names);
  assert.deepEqual(fromCommand, ['Ccc regressed', 'Bbb big platform', 'Eee other big', 'Ddd big form', 'Aaa small site']);   // regression; then Greenhouse (54% of real use) by earliest stop (posting, account, a form with unexplained fields last); then the small platform
  assert.deepEqual(fromPage, fromCommand, 'the page draws the order the command prints');
  assert.ok(!fromCommand.includes('Fff gone') && !fromCommand.includes('Ggg ready') && !fromCommand.includes('Hhh bot check'), 'a gone posting, a ready form and a documented bot check are not on the list');
});

test('there is one sort: the page embeds the function\'s own source and no longer defines its own', () => {
  assert.ok(PAGE.includes(ORDER_SOURCE), 'the page carries needsFixOrder verbatim');
  const rest = PAGE.replace(ORDER_SOURCE, '');
  assert.doesNotMatch(rest, /byWorst|stageOf/);   // outside the embedded function the page has no sort of its own
  assert.equal(typeof needsFixOrder, 'function');
  assert.doesNotMatch(ORDER_SOURCE, /`|\$\{|\\/, 'the source can sit inside the page template');
});

test('the command prints rank, shape, platform, reached, filled/left and claimed, one line a site, worst first', async () => {
  const json = await seeded();
  const lines = orderLines(json);
  assert.match(lines[0], /rank\s+shape\s+platform\s+reached\s+filled\/left\s+claimed/);
  assert.match(lines[1], /^1\s+Ccc regressed\s+Custom\s+account\s+—\s+—$/);
  assert.match(lines[2], /^2\s+Bbb big platform\s+Greenhouse\s+posting\s+—\s+—$/);
  assert.match(lines[3], /^3\s+Eee other big\s+Greenhouse\s+account\s+—\s+2026-10-12 10:00$/);   // the claim's since, never the session
  assert.match(lines[4], /^4\s+Ddd big form\s+Greenhouse\s+form\s+5\/12\s+—$/);
  assert.equal(lines.length, 6);
  assert.doesNotMatch(lines.join('\n'), /job-pilotto-\d|token|key/i);
});
