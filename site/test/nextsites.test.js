// "Next sites to add" on /admin/applying (src/nextsites.js): the hosts real users' applications ended on that the pool lacks, ranked by volume, from the k>=3 aggregate only.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {recordUse} from '../src/hostuse.js';
import {nextToAdd} from '../src/nextsites.js';
import {data} from '../src/applying.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-10T12:00:00Z');
async function use(env, host, installs, times = 1) {
  for (let i = 1; i <= installs; i += 1) for (let t = 0; t < times; t += 1) await recordUse(env, {install: `i${i}`, day: '2026-10-09', host, ready: i % 2 === 0});
}
const country = (env, installs, code) => { for (const install of installs) env.db.exec(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, countries) VALUES ('${install}', '2026-10-09', 'x', 'y', 'z', 0, 0, '', '', '${code}')`); };

test('a host the pool already covers is not suggested; the rest is ranked by installs, then uses, with its platform and the pool sites on it', async () => {
  const env = d1();
  await use(env, 'careers.acme.md', 5, 2);
  await use(env, 'jobs.ashbyhq.com', 6);
  await use(env, 'covered.example.ch', 4);
  await use(env, 'rare.example.md', 2);   // under 3 installs: never listed
  country(env, ['i1', 'i2', 'i3', 'i4', 'i5'], 'md');
  const pool = [{name: 'Covered', start: 'covered.example.ch', end: 'www.covered.example.ch', platform: 'Custom'}, {name: 'Ashby one', start: 'jobs.ashbyhq.com', end: '', platform: 'Ashby'}];
  const result = await nextToAdd(env, pool, now);
  assert.deepEqual(result.sites.map(site => [site.host, site.platform, site.poolSites, site.installs]), [['careers.acme.md', 'Custom', 0, 5]]);
  assert.deepEqual(result.sites[0].countries, [{country: 'md', installs: 5}]);
  assert.equal(result.sites[0].readyShare, 40);   // ready on even installs only: i2 and i4, twice each, of 10 uses
  assert.ok(!/"i\d"/.test(JSON.stringify(result)), 'no install in the answer');
});

test('the page data carries the list, and it is empty and harmless with no host uses', async () => {
  const env = d1();
  const empty = await data(env, now);
  assert.deepEqual(empty.next.sites, []);
  await use(env, 'careers.acme.md', 3);
  assert.equal((await data(env, now)).next.sites.length, 1);
});
