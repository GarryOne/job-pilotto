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

// Run the page's own script on a tiny DOM that, like a browser, writes a null child as the text "null" (the page once showed "null" under an empty list).
test('the page draws the section with no stray text, with and without suggestions', async () => {
  const {PAGE} = await import('../src/applying.js');
  const script = PAGE.split('<script>')[1].split('</script>')[0];
  const make = tag => ({tag, children: [], hidden: false, style: {}, set textContent(value) { this.children = value === '' ? [] : [String(value)]; }, get textContent() { return this.children.map(String).join(''); },
    append(...kids) { this.children.push(...kids.map(kid => (typeof kid === 'object' && kid !== null ? kid : String(kid)))); },
    text() { return this.children.map(kid => (typeof kid === 'string' ? kid : kid.text())).join('|'); }});
  const run = async (next, scorecard = []) => {
    const app = make('div');
    const document = {createElement: make, getElementById: () => app, querySelector: () => null, hidden: true, body: make('body')};
    const pool = {tiles: {}, cases: [], pool: [], platforms: [], flows: [], nights: [], steps: [], sites: [], dropped: [], now: '2026-10-10T12:00:00Z', next, scorecard};
    const fetch = async () => ({json: async () => pool});
    new Function('document', 'fetch', 'getComputedStyle', 'CSS', 'setInterval', 'Object', script)(document, fetch, () => ({}), {escape: x => x}, () => 0, Object);
    await new Promise(resolve => setTimeout(resolve, 20));
    return app.text();
  };
  assert.ok(!/null/.test(await run({sites: [], hidden: {hosts: 0}})), 'no "null" with an empty list');
  const card = await run({sites: [], hidden: {hosts: 0}}, [{platform: 'Greenhouse', verdict: 'Blind spot', matchShare: 54, forms: 6, filledShare: 30, poolSites: 3, poolReached: 100, installs: 4}]);
  assert.ok(card.indexOf('Platform scorecard') > card.indexOf('Next sites to add') && card.indexOf('Platform scorecard') < card.indexOf('Fixed-site replays'), 'second section, under the next sites');
  assert.ok(card.includes('Blind spot') && card.includes('Greenhouse') && card.includes('Platform scorecard') && !/null/.test(card), 'the scorecard row is drawn');
  const withPlatforms = await run({platforms: [{platform: 'Workday', matchShare: 82, poolShare: 0, poolSites: 0, installs: 1, applications: 0}], sites: [], hidden: {hosts: 0}});
  assert.ok(withPlatforms.includes('Workday') && withPlatforms.includes('82%') && !/null/.test(withPlatforms), 'a platform from one install is listed');
  const text = await run({sites: Array.from({length: 7}, (_, i) => ({host: `h${i}.acme.md`, platform: 'Custom', poolSites: 0, installs: 3, uses: 3, readyShare: 50, countries: []})), hidden: {hosts: 0}});
  assert.ok(text.indexOf('Next sites to add') >= 0 && text.indexOf('Next sites to add') < text.indexOf('Fixed-site replays'), 'the list is the first section, above the replays');
  assert.ok(!/null/.test(text) && text.includes('h0.acme.md') && !text.includes('h5.acme.md') && text.includes('Showing 1–5 of 7') && text.includes('Next →'), 'top 5, the count and the pager');
});

// The owner (10 Oct 2026): the list must not rely only on installs: if most matched jobs are on Workday and the pool has no Workday site, that comes first, even from one install.
const feed = (env, install, ats, hits, slug = ats) => env.db.exec(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, hits) VALUES ('${install}', '2026-10-09', '${ats}', '${slug}', 'c', 1, 0, '', '', ${hits})`);

test('a platform most matched jobs are on and the pool lacks comes first, from one install; a platform the pool already over-covers is not listed', async () => {
  const env = d1();
  feed(env, 'i1', 'workday', 80, 'a'); feed(env, 'i1', 'workday', 40, 'b');   // one install, 120 of 150 matched jobs
  feed(env, 'i2', 'greenhouse', 20, 'c'); feed(env, 'i3', 'greenhouse', 6, 'd');
  feed(env, 'i2', 'careers', 500, 'own');   // an employer's own site, not a platform: ignored
  env.db.exec("INSERT INTO fill_cards (id, day, board, version) VALUES ('f1', '2026-10-09', 'greenhouse', 'v'), ('f2', '2026-10-09', 'greenhouse', 'v'), ('f3', '2026-10-09', 'h:0123456789', 'v')");
  const pool = [{name: 'g1', start: 'boards.greenhouse.io', end: '', platform: 'Greenhouse'}, {name: 'g2', start: 'x.greenhouse.io', end: '', platform: 'Greenhouse'}, {name: 'c1', start: 'a.ch', end: '', platform: 'Custom'}];
  const {platforms} = await nextToAdd(env, pool, now);
  assert.deepEqual(platforms.map(item => [item.platform, item.poolSites, item.matchShare, item.installs]), [['Workday', 0, 82, 1]]);
  assert.equal(platforms[0].poolShare, 0);
  assert.ok(!JSON.stringify(platforms).includes('careers') && !/"i\d"/.test(JSON.stringify(platforms)), 'no own-site system, no install id');
  env.db.exec("DELETE FROM contributions WHERE ats = 'workday'");
  const without = await nextToAdd(env, pool, now);
  assert.deepEqual(without.platforms.map(item => [item.platform, item.matchShare, item.poolShare]), [['Greenhouse', 100, 67]], 'alone, greenhouse is still 100% of the matches against 67% of the pool');
});

test('applications on a known board count beside the matched jobs', async () => {
  const env = d1();
  feed(env, 'i1', 'ashby', 10);
  env.db.exec("INSERT INTO fill_cards (id, day, board, version) VALUES ('f1', '2026-10-09', 'ashby', 'v'), ('f2', '2026-10-09', 'ashby', 'v')");
  const {platforms} = await nextToAdd(env, [], now);
  assert.deepEqual(platforms.map(item => [item.platform, item.applications]), [['Ashby', 2]]);
});

test('a platform the pool does not cover is listed even when small (at least 1%); a gap under 2 points where the pool has sites is left out', async () => {
  const env = d1();
  feed(env, 'i1', 'lever', 3, 'a'); feed(env, 'i1', 'greenhouse', 96, 'b'); feed(env, 'i1', 'teamtailor', 1, 'c');
  const pool = [{name: 'l', start: 'jobs.lever.co', end: '', platform: 'Lever'}, ...Array.from({length: 49}, (_, i) => ({name: `g${i}`, start: `x${i}.greenhouse.io`, end: '', platform: 'Greenhouse'}))];
  const {platforms} = await nextToAdd(env, pool, now);
  assert.deepEqual(platforms.map(item => [item.platform, item.matchShare]), [['Teamtailor', 1]], 'lever: 3% vs 2% is noise; greenhouse: 96% of matches vs 98% of the pool; teamtailor has no pool site');
});
