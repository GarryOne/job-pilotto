// The Overview tab of each admin section: every page of a section with an Overview declares headline numbers (a new page without them fails here),
// each loader answers on an empty database and on seeded rows, and the Overview draws one tile per number.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {HEADLINES} from '../src/headlines.js';
import {headlinePages, sectionTiles} from '../src/section-overview.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const reads = {rows: 0, queries: 0};
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => { reads.queries++; const results = db.prepare(sql).all(...args); reads.rows += results.length; return {results}; },
    first: async () => { reads.queries++; return db.prepare(sql).get(...args); }, _sql: sql, _args: args});
  return {db, reads, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const now = new Date('2026-10-15T12:00:00Z');
const overviews = PAGES.filter(page => page.overview);

test('every page of a section that has an Overview declares headline numbers', () => {
  assert.ok(overviews.length >= 1);
  for (const overview of overviews) {
    const pages = headlinePages(overview.group);
    assert.ok(pages.length >= 1, `${overview.group} has no pages`);
    for (const page of pages) assert.equal(typeof HEADLINES[page.path], 'function', `${page.path} (${overview.group}) has no entry in src/headlines.js`);
  }
});

test('every loader returns well-formed tiles on an empty database, and a missing database', async () => {
  for (const overview of overviews) for (const page of headlinePages(overview.group)) for (const e of [env(), {}]) {
    const tiles = await HEADLINES[page.path](e, now);
    assert.ok(tiles.length >= 1 && tiles.length <= 4, `${page.path}: 1-4 tiles`);
    for (const tile of tiles) {
      assert.ok(tile.label && String(tile.value).length, `${page.path}: label and value`);
      assert.ok(['good', 'warn', 'bad', 'none'].includes(tile.status), `${page.path}: status`);
    }
  }
});

test('Operations loaders read the rows their pages keep', async () => {
  const e = env(), {db} = e.STATS;
  db.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?)').run('2026-10-15', '2026-10-15T09:00:00Z', JSON.stringify({totals: {real: 73, judged: 181, precision: 40}, fixer: {landed: 21, opened: 24, open: 0}, recall: {caught: 21, planted: 22, missed: ['dead-button']}}));
  db.prepare('INSERT INTO digest_days (day, groups, open_line, numbers, drafts, usd, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?)').run('2026-10-15', '[{"t":1},{"t":2}]', '', '[1,2,3]', '2026-10-15T10:00:00Z');
  db.prepare('INSERT INTO ai_cost_runs (job, run_id, day, at, usd, calls) VALUES (?, ?, ?, ?, ?, 1)').run('self-heal', 'r1', '2026-10-15', '2026-10-15T08:00:00Z', 8.15);
  const [heal, fixer] = await HEADLINES['/admin/self-healing'](e, now);
  assert.deepEqual([heal.value, heal.status, heal.sub.includes('dead-button'), fixer.value], ['40%', 'warn', true, '21']);
  assert.deepEqual((await HEADLINES['/admin/operations/build-log'](e, now))[0].sub, '2 goals');
  assert.equal((await HEADLINES['/admin/ai-cost'](e, now))[0].value, '$8.15');
});

test('the E2E tile counts reds and runs of the last 7 days and names the top cause', async () => {
  const e = env();
  e.STATS.db.prepare('INSERT INTO e2e_snapshot (id, at, body) VALUES (1, ?, ?)').run('2026-10-14T12:00:00Z', JSON.stringify({days: [{day: '2026-10-14', runs: 10, reds: 2}, {day: '2026-09-01', runs: 99, reds: 99}], fails: [{day: '2026-10-14', cause: 'timeout', n: 2}]}));
  const [tile] = await HEADLINES['/admin/operations/e2e'](e, now);
  assert.deepEqual([tile.value, tile.status, tile.sub], ['2 of 10', 'warn', 'top cause: timeout (2)']);
});

test('a failing loader becomes a grey tile, not an error', async () => {
  const group = overviews[0].group, tiles = await sectionTiles({STATS: {prepare: () => { throw new Error('down'); }}}, group, now);
  assert.ok(tiles.length >= 1 && tiles.every(tile => tile.href && tile.page));
});

test('the Operations Overview draws the section tiles above the time page', async () => {
  const response = await call(env(), '/admin/operations/overview', owner), html = await response.text();
  assert.equal(response.status, 200);
  for (const page of headlinePages(PAGES.find(item => item.path === '/admin/operations/overview').group)) assert.ok(html.includes(`href="${page.path}"`), `${page.path} has a tile`);
  assert.match(html, /class="tile/);
});

test('Form filling: real use under 3 installs says "Too few" with its counts, 3 installs give a percentage', async () => {
  const e = env(), card = (id, install) => e.STATS.db.prepare("INSERT INTO fill_cards (id, day, board, required, filled, install, source) VALUES (?, '2026-10-14', 'b', 10, 8, ?, 'user')").run(id, install);
  card('a', 'i1'); card('b', 'i1');
  const [few] = await HEADLINES['/admin/real-form-filling'](e, now);
  assert.deepEqual([few.value, few.status, few.few, few.sub.includes('2 forms from 1 install')], ['Too few', 'none', true, true]);
  card('c', 'i2'); card('d', 'i3');
  const [enough] = await HEADLINES['/admin/real-form-filling'](e, now);
  assert.deepEqual([enough.value, enough.status], ['80%', 'good']);
});

test('Form filling: the benchmark tile reads the stored snapshot and the learning tiles read the recipe table', async () => {
  const e = env();
  e.STATS.db.prepare('INSERT INTO benchmark_snapshot (id, at, body) VALUES (1, ?, ?)').run('2026-10-15T00:00:00Z', JSON.stringify({segments: {'thin:user': {tools: [{tool: 'Our extension', ours: true, raw: 81}, {tool: 'Other', ours: false, raw: 70}], trend: [{raw: 60}, {raw: 81}]}}}));
  const [bench] = await HEADLINES['/admin/benchmark-form-filling'](e, now);
  assert.deepEqual([bench.value, bench.status, bench.series], ['81% vs 70%', 'none', [60, 81]]);
  const rows = await HEADLINES['/admin/form-learning'](e, now);
  assert.equal(rows.find(tile => tile.label === 'Learned recipes').value, '0');
});

test('the Form filling Overview is the first tab, draws a tile per page, and is owner-only', async () => {
  const first = PAGES.find(page => page.group === 'Form filling');
  assert.equal(first.overview, true);
  assert.equal((await call(env(), first.path)).status, 404);
  const html = await (await call(env(), first.path, owner)).text();
  for (const page of headlinePages('Form filling')) assert.ok(html.includes(`href="${page.path}"`), `${page.path} has a tile`);
});

test('Growth and Intelligence: each Overview is the first tab, owner-only, with a tile per page; the series come from the /admin Overview gatherer', async () => {
  for (const group of ['Growth', 'Intelligence']) {
    const first = PAGES.find(page => page.group === group);
    assert.equal(first.overview, true, `${group}: the Overview is the first page`);
    assert.equal((await call(env(), first.path)).status, 404);
    const html = await (await call(env(), first.path, owner)).text();
    for (const page of headlinePages(group)) assert.ok(html.includes(`href="${page.path}"`), `${page.path} has a tile`);
  }
  const e = env();
  e.STATS.db.prepare("INSERT INTO telemetry (day, install, kind, data, at, version, platform, fingerprint, summary) VALUES ('2026-10-14', 'i1', 'health', '{}', '2026-10-14T00:00:00Z', '1', 'mac', '', '')").run();
  const [machines] = await HEADLINES['/admin/app'](e, now);
  assert.deepEqual([machines.label, machines.value], ['Active installs', '1']);
});

test('Signups and Monetization tiles use their pages\' own collectors; too few trials is "Too few", not a colour', async () => {
  const [trials] = await HEADLINES['/admin/monetization'](env(), now);
  assert.deepEqual([trials.value, trials.status, trials.few], ['Too few', 'none', true]);
  const [accounts] = await HEADLINES['/admin/signups'](env(), now);
  assert.equal(accounts.value, '0');
});
