// A downloaded app's channel (src/attribution.js): a Download click keeps its network's hash; the app's first start, from the same
// network and platform within 7 days, gets that click's source back. Only a label; the hashes go after 8 days.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {attribution, purge} from '../src/attribution.js';
import {download} from '../src/stats.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_stats.sql', '0032_download_net.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_SALT: 'salt', fetcher: async () => new Response('{}', {status: 404})});
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
const click = (e, query, ip, at, referer) => download(new Request(`https://www.jobpilotto.workers.dev/download/mac?${query}`,
  {headers: {'CF-Connecting-IP': ip, 'User-Agent': BROWSER, ...(referer ? {Referer: referer} : {})}}), e, null, new Date(at));
const ask = async (e, platform, ip, at) => (await (await attribution(new Request(`https://www.jobpilotto.workers.dev/api/attribution?platform=${platform}`,
  {headers: {'CF-Connecting-IP': ip, 'User-Agent': 'Electron'}}), e, new Date(at))).json()).source;

test('the app gets the source of the latest click from its network and platform', async () => {
  const e = env();
  await click(e, 'from=hero&src=reddit-devops', '1.2.3.4', '2026-10-01T10:00:00Z');
  await click(e, 'from=hero', '1.2.3.4', '2026-10-02T10:00:00Z', 'https://www.linkedin.com/feed/');
  await click(e, 'from=hero&src=other', '9.9.9.9', '2026-10-02T11:00:00Z');
  assert.equal(await ask(e, 'mac', '1.2.3.4', '2026-10-02T10:05:00Z'), 'linkedin.com');
  assert.equal(await ask(e, 'windows', '1.2.3.4', '2026-10-02T10:05:00Z'), null, 'another platform is no match');
  assert.equal(await ask(e, 'mac', '5.5.5.5', '2026-10-02T10:05:00Z'), null, 'another network is no match');
  assert.equal(await ask(e, 'mac', '1.2.3.4', '2026-10-10T10:05:00Z'), null, 'older than 7 days is no match');
});

test('the network is stored as a salted hash, never the address, and dropped after 8 days', async () => {
  const e = env();
  await click(e, 'from=hero', '1.2.3.4', '2026-10-01T10:00:00Z');
  await click(e, 'from=hero', '1.2.3.4', '2026-10-09T10:00:00Z');
  const nets = e.STATS.db.prepare('SELECT net FROM downloads ORDER BY at').all().map(r => r.net);
  assert.match(nets[0], /^[0-9a-f]{24}$/);
  assert.ok(!JSON.stringify(e.STATS.db.prepare('SELECT * FROM downloads').all()).includes('1.2.3.4'));
  await purge(e, new Date('2026-10-10T00:00:00Z'));
  assert.deepEqual(e.STATS.db.prepare('SELECT net IS NULL AS gone FROM downloads ORDER BY at').all().map(r => r.gone), [1, 0]);
});

test('a bad platform is a 404; no address or no database answers no source', async () => {
  const e = env();
  assert.equal((await attribution(new Request('https://x/api/attribution?platform=linux'), e)).status, 404);
  assert.equal(await ask(e, 'mac', '', '2026-10-02T10:05:00Z'), null);
  assert.equal((await (await attribution(new Request('https://x/api/attribution?platform=mac', {headers: {'CF-Connecting-IP': '1.1.1.1'}}), {})).json()).source, null);
});
