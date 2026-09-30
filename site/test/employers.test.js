// The central employer index route: public cacheable GET, key-protected PUT that can't wipe the list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../src/index.js';

const store = new Map();
const env = () => ({INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')},
  WAITLIST: {get: async key => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); }}});
const call = (e, method, headers = {}, body) => worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/index',
  {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, {});
const feed = (slug, extra = {}) => ({company: `Co ${slug}`, ats: 'lever', slug, quality: 71.6, jobs: 12, relevant: 4.6, checked: '2026-09-30', places: ['Zurich, Switzerland', 7], ...extra});
const auth = {Authorization: 'Bearer k3y'};


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

test('publish, then anyone can download it: public, cacheable, ETag revalidation', async () => {
  store.clear();
  const bad = [{company: 'Evil', ats: 'nonsense', slug: 'x'}, {company: 'NoSlug', ats: 'lever'}, 'junk', feed('a', {tier: 'weird'})];
  const put = await call(env(), 'PUT', auth, {feeds: [...bad, feed('a')]});
  assert.equal(put.status, 200);
  assert.equal((await put.json()).feeds, 1);   // unknown ATS, slug-less, junk and the duplicate are dropped
  const get = await call(env(), 'GET');       // no credentials
  assert.equal(get.status, 200);
  assert.match(get.headers.get('Cache-Control'), /public, max-age=/);
  const body = await get.json();
  assert.deepEqual(body.feeds[0], {company: 'Co a', ats: 'lever', slug: 'a', tier: 'Standard', quality: 72, jobs: 12, checked: '2026-09-30', places: ['Zurich, Switzerland'], kind: 'employer', fits: {roles: [], regions: []}, relevant: 5});
  const again = await call(env(), 'GET', {'If-None-Match': get.headers.get('ETag')});
  assert.equal(again.status, 304);
});

test('an install id header is accepted and changes nothing stored', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const before = store.get('index:employers');
  assert.equal((await call(env(), 'GET', {'X-Install-Id': 'abcd-1234-efgh'})).status, 200);
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

test('the landing page reads the pool size from this same route and says users can add their own employers', async () => {
  const {readFileSync} = await import('node:fs');
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /fetch\('\/api\/index'\)/);
  assert.equal((page.match(/class="ico"/g) || []).length, 6);   // an icon beside each title; nothing else added to the panel
  assert.doesNotMatch(page, /cov-head|fit-pill/);
  assert.match(page, /<small>Portals<\/small>/);     // each card of the first row has two tiles
  assert.match(page, /<b>SCOUT<\/b><small>Your own<\/small>/);
  assert.match(page, /id="pool-employers"/);
  assert.match(page, /id="pool-jobs"/);
  assert.match(page, /Open jobs/);
  assert.doesNotMatch(page, /IT & engineering roles/);   // the tile stays wide: every open job, all roles
  assert.match(page, /Add any company, or run your own scout/);   // the pool is a start, not the limit (the third card says so)
  assert.match(page, /Can I add my own employers\?/);
  assert.doesNotMatch(page, /tech jobs in Switzerland/);   // the pool is worldwide; the focus is the kind of job
  assert.match(page, /switch that off in Settings/);   // the sharing note lives in the FAQ and privacy page, not the small card
  const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.match(privacy, /on by default/);
  assert.match(privacy, /Installs set up before this existed start with it off/);
  assert.doesNotMatch(page, /maintained (employer )?index/i);
});

test('an entry can be marked as a job portal; anything else is an employer', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a'), feed('b', {kind: 'board'}), feed('c', {kind: 'weird'})]});
  const kinds = (await (await call(env(), 'GET')).json()).feeds.map(f => f.kind);
  assert.deepEqual(kinds, ['employer', 'board', 'employer']);
});

test('the index keeps who a feed fits, from the fixed lists only', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a', {fits: {roles: ['sre_devops', 'my-secret'], regions: ['europe', 'Zurich']}}), feed('b')]});
  const feeds = (await (await call(env(), 'GET')).json()).feeds;
  assert.deepEqual(feeds[0].fits, {roles: ['sre_devops'], regions: ['europe']});
  assert.deepEqual(feeds[1].fits, {roles: [], regions: []});
});
