// Usage-weighted pool (docs/superpowers/specs/2026-10-10-usage-weighted-pool.md): the end host of an application is kept as a count per install and day, and only
// served as an aggregate that >= 3 distinct installs used. Guard for site/src/hostuse.js and the card ingest in site/src/recipes.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {cleanHost, nextSites, recordUse} from '../src/hostuse.js';
import {controls} from '../src/recipes.js';

const cases = JSON.parse(readFileSync(new URL('./host-cases.json', import.meta.url), 'utf8'));
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-10T12:00:00Z');

test('a host is kept only as a plain host name; a path, query, port, token or address is dropped', () => {
  for (const [input, output] of cases.good) assert.equal(cleanHost(input), output, input);
  for (const input of cases.bad) assert.equal(cleanHost(input), null, JSON.stringify(input));
});

test('a host reaches the aggregate only when 3 distinct installs used it; a country only when 3 installs of it did; no install is ever named', async () => {
  const env = d1();
  for (const install of ['i1', 'i2', 'i3', 'i4']) await recordUse(env, {install, day: '2026-10-09', host: 'careers.acme.md', ready: install !== 'i3'});
  for (const install of ['i1', 'i2']) await recordUse(env, {install, day: '2026-10-09', host: 'jobs.small.md', ready: true});
  await recordUse(env, {install: 'i1', day: '2026-10-09', host: 'careers.acme.md', ready: true});   // the same install again: still one install
  for (const install of ['i1', 'i2', 'i3', 'i4']) env.db.exec(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, countries) VALUES ('${install}', '2026-10-09', 'x', 'y', 'z', 0, 0, '', '', '${install === 'i4' ? 'ro' : 'md'}')`);
  const result = await nextSites(env, {now});
  assert.deepEqual(result.sites.map(site => [site.host, site.installs, site.uses, site.ready]), [['careers.acme.md', 4, 5, 4]]);
  assert.deepEqual(result.sites[0].countries, [{country: 'md', installs: 3}, {country: 'other', installs: 1}]);
  assert.equal(result.hidden.hosts, 1, 'a host below the threshold is only counted, never named');
  const text = JSON.stringify(result);
  assert.ok(!text.includes('jobs.small.md') && !/"i[1-4]"/.test(text) && !text.includes('"ro"'), 'no small host, no install id and no one-install country in the answer');
});

test('uses older than 90 days are not counted', async () => {
  const env = d1();
  for (const install of ['i1', 'i2', 'i3']) await recordUse(env, {install, day: '2026-06-01', host: 'old.acme.md', ready: true});
  assert.deepEqual((await nextSites(env, {now})).sites, []);
});

test('a card with a host is counted once, with the board it came with; a bad host is left out and the card still counts', async () => {
  const env = {STATS: d1(), STATS_SALT: 's'};
  const card = (id, host) => ({id, v: '0.9.1', required: 3, filled: 3, left: 0, board: 'h:0123456789', host});
  const send = body => controls(new Request('https://x/api/recipes/controls', {method: 'POST', body: JSON.stringify({install: 'install-aaaa1111', ...body})}), env, now);
  await send({cards: [card('fill-0001-abc', 'Careers.Acme.MD'), card('fill-0002-abc', 'acme.md/jobs?token=1')]});
  await send({cards: [card('fill-0001-abc', 'careers.acme.md')]});   // the same card sent again (a retry)
  const rows = env.STATS.db.prepare('SELECT host, n, ready FROM host_uses').all();
  assert.deepEqual(rows.map(row => ({...row})), [{host: 'careers.acme.md', n: 1, ready: 1}]);
  assert.equal(env.STATS.db.prepare('SELECT COUNT(*) AS n FROM fill_cards').get().n, 2);
  assert.ok(!/install-aaaa1111/.test(JSON.stringify(rows)), 'the raw install id is never stored with a host');
});
