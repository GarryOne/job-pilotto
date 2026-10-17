// The daily discovery batch's input (src/discovery-candidates.js): installs share only address, host and source; the CI picker reads them with the narrow key.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {cleanCandidates} from '../src/discovery-candidates.js';
import {purge} from '../src/pool.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const map = new Map(); return {get: async k => map.get(k) ?? null, put: async (k, v) => { map.set(k, v); }}; };
const setup = () => ({STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', INDEX_PUBLISH_KEY: 'k3y', REPLAYS_PUBLISH_KEY: 'narrow', ASSETS: {fetch: () => new Response('asset')}});
const post = (env, body) => worker.fetch(new Request('https://www.jobpilotto.top/api/contribute', {method: 'POST', body: JSON.stringify(body)}), env, {});
const input = (env, key = 'narrow') => worker.fetch(new Request('https://www.jobpilotto.top/applying/discovery-input', {headers: key ? {Authorization: `Bearer ${key}`} : {}}), env, {});
const item = (path, source = 'matches', host = 'careers.example.com') => ({url: `https://${host}${path}`, host, source});

test('only plain https addresses with their own host and a fixed source are kept; the rest is dropped and counted', () => {
  const kept = cleanCandidates([item('/jobs/1'), item('/jobs/1'), item('/jobs/2', 'applying'), {...item('/jobs/3'), source: 'sold'}, {...item('/jobs/4'), host: 'other.example.com'},
    {url: 'https://careers.example.com/j?q=geneva', host: 'careers.example.com', source: 'matches'}, {url: 'http://careers.example.com/x', host: 'careers.example.com', source: 'matches'},
    {url: 'https://u:p@careers.example.com/x', host: 'careers.example.com', source: 'matches'}, item('/x', 'matches', 'e2e-co.example.com'), {url: 5}, null]);
  assert.deepEqual(kept.map(row => row.url), ['https://careers.example.com/jobs/1', 'https://careers.example.com/jobs/2']);
  assert.equal(cleanCandidates(Array.from({length: 90}, (_, n) => item(`/j/${n}`))).length, 40, 'at most 40');
  for (const row of kept) assert.deepEqual(Object.keys(row).sort(), ['host', 'source', 'url'], 'no other field is kept');
});

test('an install shares candidates; the narrow key reads them; no title, company or install leaves', async () => {
  const env = setup();
  const reply = await post(env, {v: 2, install: 'abc-12345678', roles: [], regions: [], candidates: [item('/jobs/1'), {...item('/jobs/2'), title: 'Head of Secret Plans', company: 'Hidden AG'}, item('/bad?x=1')]});
  const answer = await reply.json();
  assert.equal(reply.status, 200, JSON.stringify(answer));
  assert.equal(answer.candidates, 2);
  assert.deepEqual(answer.dropped, {candidates: 1}, 'a refusal is counted, so a naming drift shows in the app\'s log');
  assert.equal((await input(env, 'wrong')).status, 404);
  assert.equal((await input(env, '')).status, 404);
  assert.equal((await input(env, 'k3y')).status, 404, 'the scout\'s key is not this key');
  const got = await (await input(env)).json();
  assert.deepEqual(got.candidates.map(row => [row.url, row.host, row.source, row.installs]), [['https://careers.example.com/jobs/1', 'careers.example.com', 'matches', 1], ['https://careers.example.com/jobs/2', 'careers.example.com', 'matches', 1]]);
  const text = JSON.stringify(got);
  for (const private_ of ['Secret Plans', 'Hidden AG', 'abc-12345678']) assert.ok(!text.includes(private_), private_);
  assert.ok(Array.isArray(got.demand) && Array.isArray(got.misses));
});

test('addresses older than 14 days are dropped by the daily purge', async () => {
  const env = setup();
  await post(env, {v: 2, install: 'abc-12345678', roles: [], regions: [], candidates: [item('/jobs/1')]});
  await purge(env, new Date(Date.now() + 15 * 86400000));
  assert.equal(env.STATS.db.prepare('SELECT COUNT(*) AS n FROM discovery_candidates').get().n, 0);
});
