// The central employer index route: GET needs an install token (or the owner's key) with a daily cap, a public summary holds only counts,
// and the key-protected PUT can't wipe the list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../src/index.js';
import {clean} from '../src/employers.js';

const store = new Map();
const env = () => ({INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')},
  WAITLIST: {get: async key => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); }}});
const call = (e, method, headers = {}, body) => worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/index',
  {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, {});
const feed = (slug, extra = {}) => ({company: `Co ${slug}`, ats: 'lever', slug, quality: 71.6, jobs: 12, relevant: 4.6, checked: '2026-09-30', places: ['Zurich, Switzerland', 7], ...extra});
const auth = {Authorization: 'Bearer k3y'};
// An install's token for the index, minted the way the engine does.
const tokenOf = async (install, purpose = 'index') => (await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/install-token',
  {method: 'POST', body: JSON.stringify({install, purpose})}), env(), {})).json()).token;
const holder = async (install = 'abcd-1234-efgh') => ({'X-Install-Id': install, Authorization: `Bearer ${await tokenOf(install)}`});


test('before anything is published: 404, so clients keep their starter list', async () => {
  store.clear();
  assert.equal((await call(env(), 'GET')).status, 404);
});

test('publishing needs the key; without it the route looks absent', async () => {
  store.clear();
  assert.equal((await call(env(), 'PUT', {}, {feeds: [feed('a')]})).status, 404);
  assert.equal((await call(env(), 'PUT', {Authorization: 'Bearer nope'}, {feeds: [feed('a')]})).status, 404);
  assert.equal((await call({...env(), INDEX_PUBLISH_KEY: undefined}, 'PUT', {Authorization: 'Bearer undefined'}, {feeds: [feed('a')]})).status, 404);
  assert.equal(store.size, 0);
});

test('publish, then installs with a token download it: private cache, ETag revalidation; no credentials get a 401', async () => {
  store.clear();
  const bad = [{company: 'Evil', ats: 'nonsense', slug: 'x'}, {company: 'NoSlug', ats: 'lever'}, 'junk', feed('a', {tier: 'weird'})];
  const put = await call(env(), 'PUT', auth, {feeds: [...bad, feed('a')]});
  assert.equal(put.status, 200);
  assert.equal((await put.json()).feeds, 1);   // unknown ATS, slug-less, junk and the duplicate are dropped
  assert.equal((await call(env(), 'GET')).status, 401);   // no credentials
  const get = await call(env(), 'GET', await holder());
  assert.equal(get.status, 200);
  assert.match(get.headers.get('Cache-Control'), /private, max-age=/);
  const body = await get.json();
  assert.deepEqual(body.feeds[0], {company: 'Co a', ats: 'lever', slug: 'a', tier: 'Standard', quality: 72, jobs: 12, checked: '2026-09-30', places: ['Zurich, Switzerland'], kind: 'employer', fits: {roles: [], regions: []}, regions: [], relevant: 5});
  const again = await call(env(), 'GET', {...await holder(), 'If-None-Match': get.headers.get('ETag')});
  assert.equal(again.status, 304);
  assert.equal((await call(env(), 'GET', auth)).status, 200);   // the owner's scout
});

test('a token opens only what it was minted for; a wrong or missing install id is refused', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const forRecipes = await tokenOf('abcd-1234-efgh', 'recipes');
  assert.equal((await call(env(), 'GET', {'X-Install-Id': 'abcd-1234-efgh', Authorization: `Bearer ${forRecipes}`})).status, 401);
  assert.equal((await call(env(), 'GET', {...await holder(), 'X-Install-Id': 'someone-else-1'})).status, 401);
  assert.equal((await call(env(), 'GET', {Authorization: `Bearer ${await tokenOf('abcd-1234-efgh')}`})).status, 401);
});

test('the summary is public and holds only counts, never the feeds', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a'), feed('b', {kind: 'board'}), feed('c', {jobs: 8})]});
  const res = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/index?summary=1'), env(), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {employers: 2, jobs: 20});   // the job portal is not counted as an employer
});

test('an install can download a few times a day, then waits', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const e = env(), headers = await holder('limit-install-1');
  const get = () => worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/index', {headers}), e, {});
  for (let i = 0; i < 24; i++) assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 429);
});

test('a download changes nothing stored', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const before = store.get('index:employers');
  assert.equal((await call(env(), 'GET', await holder())).status, 200);
  assert.equal(store.get('index:employers'), before);
});

test('a broken scout run cannot wipe the list, and empty or invalid bodies are refused', async () => {
  store.clear();
  const many = Array.from({length: 20}, (_, i) => feed(`s${i}`));
  assert.equal((await call(env(), 'PUT', auth, {feeds: many})).status, 200);
  assert.equal((await call(env(), 'PUT', auth, {feeds: many.slice(0, 5)})).status, 409);
  assert.equal((await call(env(), 'PUT', auth, {feeds: []})).status, 400);
  assert.equal(JSON.parse(store.get('index:employers')).feeds.length, 20);
  const raw = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/index', {method: 'PUT', headers: auth, body: 'not json'}), env(), {});
  assert.equal(raw.status, 400);
});

test('other methods are refused', async () => {
  assert.equal((await call(env(), 'POST', auth, {feeds: []})).status, 405);
});

test('the landing page reads the pool size from the public summary of this route and says users can add their own employers', async () => {
  const {readFileSync} = await import('node:fs');
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /fetch\('\/api\/index\?summary=1'\)/);
  assert.doesNotMatch(page, /class="ico"|pool-tile|cov-head|fit-pill/);   // the original plain grid: no icons, no cards
  assert.match(page, /<b class="num" id="pool-employers">0<\/b> employers with <b class="num" id="pool-jobs">0<\/b> open jobs/);   // normal text, coloured
  assert.match(page, /id="pool-employers"/);
  assert.match(page, /id="pool-jobs"/);
  assert.doesNotMatch(page, /IT & engineering roles/);   // the tile stays wide: every open job, all roles
  assert.match(page, /Add any company you care about, or run your own scout/);   // the pool is a start, not the limit (the third card says so)
  assert.match(page, /Can I add my own employers\?/);
  assert.doesNotMatch(page, /tech jobs in Switzerland/);   // the pool is worldwide; the focus is the kind of job
  assert.match(page, /switch that off in Settings/);   // the sharing note lives in the FAQ and privacy page, not the small card
  const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.match(privacy, /on by default/);
  assert.match(privacy, /Every install also helps it grow, <b>on by default<\/b> \(you can turn it off\)/);   // opt-out for everyone (7 Oct 2026)
  assert.doesNotMatch(page, /maintained (employer )?index/i);
});

test('an entry can be marked as a job portal; anything else is an employer', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a'), feed('b', {kind: 'board'}), feed('c', {kind: 'weird'})]});
  const kinds = (await (await call(env(), 'GET', auth)).json()).feeds.map(f => f.kind);
  assert.deepEqual(kinds, ['employer', 'board', 'employer']);
});

test('the index keeps who a feed fits, from the fixed lists only', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a', {fits: {roles: ['sre_devops', 'my-secret'], regions: ['europe', 'Zurich']}}), feed('b')]});
  const feeds = (await (await call(env(), 'GET', auth)).json()).feeds;
  assert.deepEqual(feeds[0].fits, {roles: ['sre_devops'], regions: ['europe']});
  assert.deepEqual(feeds[1].fits, {roles: [], regions: []});
});

test('in the soft rollout older installs without a token still get the list, and are counted', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const soft = {...env(), INDEX_GATE: 'soft'};
  assert.equal((await call(soft, 'GET')).status, 200);
  assert.equal((await call(soft, 'GET', {'X-Install-Id': 'abcd-1234-efgh', Authorization: 'Bearer wrong'})).status, 200);
  assert.equal((await call(env(), 'GET')).status, 401);   // the default enforces
});

// ---------- the index in D1: an install downloads the slice for its own regions ----------
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0018_employer_index.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const sliced = (e, regions, headers) => worker.fetch(new Request(`https://www.jobpilotto.workers.dev/api/index?regions=${regions}`, {headers}), e, {});

test('published feeds land in D1 with their regions, and an install gets only its regions plus feeds of unknown places', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  const feeds = [feed('zh', {regions: ['europe']}), feed('ny', {regions: ['north_america']}), feed('rem', {regions: ['remote', 'europe']}),
    feed('nowhere', {regions: []}), feed('bad', {regions: ['mars', 'europe']})];
  const put = await call(e, 'PUT', auth, {feeds});
  assert.deepEqual(await put.json(), {ok: true, feeds: 5, d1: true, legacy: 'updated'});
  const got = await (await sliced(e, 'europe', await holder())).json();
  assert.equal(got.version, 2);
  assert.deepEqual(got.feeds.map(f => f.slug).sort(), ['bad', 'nowhere', 'rem', 'zh']);   // not the New York feed
  assert.deepEqual(got.feeds.find(f => f.slug === 'bad').regions, ['europe'], 'unknown region words are dropped');
  const remote = await (await sliced(e, 'remote,evil', await holder())).json();
  assert.deepEqual(remote.feeds.map(f => f.slug).sort(), ['nowhere', 'rem']);
  // An older app (no regions) still gets the whole list from KV.
  assert.equal((await (await call(e, 'GET', await holder())).json()).feeds.length, 5);
});

test('the slice needs a token like the whole list, and a later publish replaces the D1 rows', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await call(e, 'PUT', auth, {feeds: Array.from({length: 12}, (_, i) => feed(`f${i}`, {regions: ['europe']}))});
  assert.equal((await sliced(e, 'europe', {})).status, 401);
  assert.equal((await call(e, 'PUT', auth, {feeds: [feed('only', {regions: ['europe']})]})).status, 409, 'a sudden loss is refused');
  await call(e, 'PUT', auth, {feeds: Array.from({length: 10}, (_, i) => feed(`g${i}`, {regions: ['europe']}))});
  const got = await (await sliced(e, 'europe', await holder())).json();
  assert.deepEqual(got.feeds.map(f => f.slug).sort(), Array.from({length: 10}, (_, i) => `g${i}`).sort());
});

test('a list too large for one KV value still goes to D1, and older apps keep the last list that fit', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await call(e, 'PUT', auth, {feeds: [feed('small', {regions: ['europe']})]});
  const big = Array.from({length: 4000}, (_, i) => feed(`b${i}`, {regions: ['europe'], places: Array.from({length: 8}, (_, j) => `Place ${j} ${'x'.repeat(30)}`)}));
  const answer = await (await call(e, 'PUT', auth, {feeds: big})).json();
  assert.equal(answer.legacy, 'too large, unchanged');
  assert.equal((await (await sliced(e, 'europe', await holder())).json()).feeds.length, 4000);
  assert.equal((await (await call(e, 'GET', await holder())).json()).feeds.length, 1);
});

test('the central scout sends its own numbers with the index; they are checked to a fixed shape and shown on /intel', async () => {
  store.clear();
  const db = d1();
  db.db.exec(readFileSync(new URL('../migrations/0019_scouting.sql', import.meta.url), 'utf8').split('\n').filter(line => !line.startsWith('ALTER')).join('\n'));
  const e = {...env(), STATS: db};
  const stats = {feeds: 412, jobs: 39000, relevant: 2100, by_ats: {greenhouse: 120, '<script>': 1}, by_region: {europe: 300}, queue: {pending: 2954, found: 400},
    recipes: 12, page_reads: 30, link_choices: 9, commoncrawl: 'CC-MAIN-2026-39', ideas_at: '2026-10-03T04:30:00', ideas_note: 'Tried Swiss banks <b>now</b>',
    sources: [{origin: 'Common Crawl', probed: 500, found: 40}], market: [{term: 'devops', ours: 61, jobsch: 305}], extra: 'dropped'};
  await call(e, 'PUT', auth, {feeds: [feed('a', {regions: ['europe']})], stats});
  const {load, section} = await import('../src/scouting.js');
  const shown = await load(db);
  assert.equal(shown.feeds, 412);
  assert.equal(shown.extra, undefined);
  assert.deepEqual(Object.keys(shown.by_ats), ['greenhouse', 'script']);
  const html = section(shown);
  assert.match(html, /Market coverage/);
  assert.match(html, /<b>20%<\/b>/);                 // 61 of 305
  assert.doesNotMatch(html, /<b>now<\/b>/, 'text from the scout is escaped');
});

// What a feed hires for (src/role_kinds.py): only known kinds and shares 0–1 reach the apps; anything else is dropped, never passed on.
test('a feed\'s mix of kinds is kept only in its fixed shape', () => {
  const [kept, odd, none] = clean([
    {company: 'Datadog', ats: 'greenhouse', slug: 'datadog', kinds: {software: 0.951, hacking: 1, other: 3, logistics: '0.2'}},
    {company: 'Odd', ats: 'greenhouse', slug: 'odd', kinds: ['software']},
    {company: 'None', ats: 'greenhouse', slug: 'none'}]);
  assert.deepEqual(kept.kinds, {software: 0.95});
  assert.equal('kinds' in odd, false);
  assert.equal('kinds' in none, false);
});

test('a feed\'s freshness is kept only in its fixed shape', () => {
  const [kept, odd] = clean([
    {company: 'Coop', ats: 'successfactors', slug: 'jobs.coop.ch', fresh: {ok: '2026-10-06', fails: 2, jobs: 3200, trend: 'up', new: '2026-10-06', extra: 'x'}},
    {company: 'Odd', ats: 'lever', slug: 'odd', fresh: {ok: 'never'}}]);
  assert.deepEqual(kept.fresh, {ok: '2026-10-06', fails: 2, jobs: 3200, trend: 'up', new: '2026-10-06'});
  assert.equal('fresh' in odd, false);
});
