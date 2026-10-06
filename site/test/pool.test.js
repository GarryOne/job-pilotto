// "Help the pool grow": accepted only in the fixed shape, limited, hashed, aggregated for the scout only, dropped after 90 days.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {purge} from '../src/pool.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_stats.sql', '0002_telemetry.sql', '0003_contributions.sql', '0027_contributions_v2.sql', '0028_nofeed.sql', '0031_board_reads.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, prepare: sql => statement(sql)};
}
const kvStore = () => { const map = new Map(); return {map, get: async k => map.get(k) ?? null, put: async (k, v) => { map.set(k, v); }}; };
const setup = () => ({STATS: d1(), WAITLIST: kvStore(), STATS_SALT: 'salt', INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')}});
const post = (env, body) => worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/contribute', {method: 'POST', body: JSON.stringify(body)}), env, {});
const read = (env, headers = {}) => worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/contributions', {headers}), env, {});
const feed = (slug, extra = {}) => ({ats: 'lever', slug, company: `Co ${slug}`, matched: true, own: false, ...extra});
const body = (install, feeds, extra = {}) => ({v: 1, install, roles: ['sre_devops'], regions: ['europe'], feeds, ...extra});

test('stores only the fixed shape: unknown systems, bad slugs and tags outside the lists are dropped', async () => {
  const env = setup();
  const response = await post(env, body('install-aaaa1111', [feed('a'), feed('a'), {ats: 'nonsense', slug: 'x', company: 'X'}, feed('../etc'), feed('b', {company: ''}), 'junk'],
    {roles: ['sre_devops', 'my-secret-role'], regions: ['europe', 'Zurich']}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).feeds, 1);
  const rows = env.STATS.db.prepare('SELECT * FROM contributions').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].roles, 'sre_devops');
  assert.equal(rows[0].regions, 'europe');
  assert.doesNotMatch(rows[0].install, /install-aaaa1111/);   // hashed
});

test('invalid bodies and a wrong method are refused', async () => {
  const env = setup();
  assert.equal((await post(env, {v: 3, install: 'install-aaaa1111', feeds: [feed('a')]})).status, 400);   // v1 and v2 are known
  assert.equal((await post(env, {v: 1, install: 'x', feeds: [feed('a')]})).status, 400);
  assert.equal((await post(env, body('install-aaaa1111', []))).status, 400);
  assert.equal((await worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/contribute'), env, {})).status, 405);
});

test('many small shares a minute per install (each find as it is made), then a pause', async () => {
  const env = setup();
  for (let i = 0; i < 30; i++) assert.equal((await post(env, body('install-aaaa1111', [feed(`f${i}`)]))).status, 200, `share ${i}`);
  assert.equal((await post(env, body('install-aaaa1111', [feed('one-too-many')]))).status, 429);
  assert.equal((await post(env, body('install-bbbb2222', [feed('b')]))).status, 200, 'another install is not held back');
});

test('the aggregate is for the scout only, counts distinct installs, and keeps tags of matched installs', async () => {
  const env = setup();
  await post(env, body('install-aaaa1111', [feed('a'), feed('own', {matched: false, own: true})]));
  await post(env, body('install-bbbb2222', [feed('a')], {roles: ['data'], regions: ['europe', 'remote']}));
  await post(env, body('install-cccc3333', [feed('a', {matched: false})], {roles: ['security']}));
  assert.equal((await read(env)).status, 404);
  assert.equal((await read(env, {Authorization: 'Bearer nope'})).status, 404);
  const {feeds} = await (await read(env, {Authorization: 'Bearer k3y'})).json();
  const a = feeds.find(f => f.slug === 'a');
  assert.deepEqual([a.installs, a.matched_installs], [3, 2]);
  assert.deepEqual(a.roles, {sre_devops: 1, data: 1});        // the unmatched install's tags don't count
  assert.deepEqual(a.regions, {europe: 2, remote: 1});
  assert.equal(feeds.find(f => f.slug === 'own').own_installs, 1);
  assert.doesNotMatch(JSON.stringify(feeds), /install-/);      // no install id, not even hashed
});

test('rows older than 90 days are dropped', async () => {
  const env = setup();
  await post(env, body('install-aaaa1111', [feed('a')]));
  env.STATS.db.prepare("UPDATE contributions SET day = '2026-01-01'").run();
  await purge(env, new Date('2026-09-30T12:00:00Z'));
  assert.equal(env.STATS.db.prepare('SELECT COUNT(*) AS n FROM contributions').get().n, 0);
});

test('share v2: how it was found, jobs listed, matches, its job site and a failed read are kept, checked, and added up for the scout', async () => {
  const env = setup();
  const v2 = (install, extra) => ({...body(install, [feed('coop', {ats: 'successfactors', slug: 'jobs.coop.ch', ...extra})]), v: 2});
  assert.equal((await post(env, v2('install-aaaa1111', {how: 'ai_idea', jobs: 3142, hits: 7, site: 'https://jobs.coop.ch/viewalljobs/', failed: false}))).status, 200);
  assert.equal((await post(env, v2('install-bbbb2222', {how: 'made-up', jobs: 3200, hits: 2, site: 'javascript:alert(1)', failed: true}))).status, 200);
  const rows = env.STATS.db.prepare('SELECT how, jobs, hits, site, failed FROM contributions ORDER BY jobs').all();
  assert.deepEqual(rows.map(row => ({...row})), [{how: 'ai_idea', jobs: 3142, hits: 7, site: 'https://jobs.coop.ch/viewalljobs/', failed: 0},
    {how: null, jobs: 3200, hits: 2, site: null, failed: 1}]);
  const all = await (await read(env, {Authorization: 'Bearer k3y'})).json();
  const coop = all.feeds.find(item => item.slug === 'jobs.coop.ch');
  assert.deepEqual({how: coop.how, jobs: coop.jobs, hits: coop.hits, failed: coop.failed_installs, site: coop.site, installs: coop.installs},
    {how: {ai_idea: 1}, jobs: 3200, hits: 9, failed: 1, site: 'https://jobs.coop.ch/viewalljobs/', installs: 2});
});

test('"no readable job site" results are kept per install, added up for the scout, and checked', async () => {
  const env = setup();
  const share = install => ({...body(install, []), v: 2, nofeed: [{company: 'Fnac Suisse SA', host: 'fnac.ch'}, {company: 'Bad', host: 'javascript:x'}, {company: ''}]});
  assert.equal((await post(env, share('install-aaaa1111'))).status, 200);
  assert.equal((await post(env, share('install-bbbb2222'))).status, 200);
  const all = await (await read(env, {Authorization: 'Bearer k3y'})).json();
  const fnac = all.nofeed.find(item => item.key === 'fnacsuisse');
  assert.deepEqual({company: fnac.company, host: fnac.host, installs: fnac.installs}, {company: 'Fnac Suisse SA', host: 'fnac.ch', installs: 2});
  assert.equal(all.nofeed.find(item => item.key === 'bad').host, null, 'a host that is not one is dropped');
});

test('every feed read and every board go up; "read fine, nothing for this role" is counted; a same-day instant share keeps the check\'s match', async () => {
  const env = setup();
  const v2 = (install, extra) => ({v: 2, install, roles: ['creative_media'], regions: ['europe'], feeds: [], ...extra});
  await post(env, v2('install-aaaa1111', {feeds: [feed('quiet', {matched: false, jobs: 12, hits: 0, how: 'index'}), feed('hit', {jobs: 40, hits: 2})],
    boards: [{board: 'jobsch', jobs: 300, hits: 9}, {board: 'google_jobs', jobs: 15, hits: 0}, {board: 'my private query', jobs: 1, hits: 1}]}));
  await post(env, v2('install-aaaa1111', {feeds: [feed('hit', {matched: false, how: 'ai_idea'})]}));   // scout's one-item share, same day
  assert.equal(env.STATS.db.prepare('SELECT matched FROM contributions WHERE slug = ?').get('hit').matched, 1);
  assert.deepEqual(env.STATS.db.prepare('SELECT board FROM board_reads ORDER BY board').all().map(r => r.board), ['google_jobs', 'jobsch'], 'fixed ids only');
  const all = await (await read(env, {Authorization: 'Bearer k3y'})).json();
  const quiet = all.feeds.find(f => f.slug === 'quiet');
  assert.deepEqual(quiet.quiet_roles, {creative_media: 1});
  const jobsch = all.boards.find(b => b.board === 'jobsch');
  assert.deepEqual([jobsch.matched_installs, jobsch.roles.creative_media], [1, {installs: 1, matched: 1}]);
  assert.equal(all.boards.find(b => b.board === 'google_jobs').matched_installs, 0);
});
