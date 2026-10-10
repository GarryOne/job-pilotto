// /admin/applying (src/applying.js): uploads are checked to fixed values, and the page's data shows each site's last step, its trend, regressions and cases.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {data, ingest} from '../src/applying.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-12T12:00:00Z');

test('an upload keeps fixed values only: a host (never a path), a known step; a bad kind or day is refused', async () => {
  const db = d1();
  assert.equal((await ingest(db, {kind: 'nope', day: '2026-10-12', rows: [{name: 'x'}]})).ok, false);
  assert.equal((await ingest(db, {kind: 'smoke', day: 'yesterday', rows: [{name: 'x'}]})).ok, false);
  await ingest(db, {kind: 'smoke', day: '2026-10-12', version: '0.9.165', rows: [{name: 'Lever form', host: 'https://jobs.lever.co/x/y', reached: 'teleported', filled: 3, left: 1}]}, now);
  const [row] = db.db.prepare('SELECT host, reached, filled FROM applying_runs').all();
  assert.deepEqual({...row}, {host: null, reached: null, filled: 3});   // a URL is not a host; an unknown step is dropped
});

test('the page data: each site\'s last step and last runs, regressions first; cases with their result; nights by step', async () => {
  const db = d1();
  await ingest(db, {kind: 'smoke', day: '2026-10-10', rows: [{name: 'jobs.ch account', host: 'www.jobs.ch', reached: 'code/bot'}, {name: 'Lever form', host: 'jobs.lever.co', reached: 'ready', filled: 9, left: 0}]}, now);
  await ingest(db, {kind: 'smoke', day: '2026-10-11', rows: [{name: 'jobs.ch account', host: 'www.jobs.ch', reached: 'posting', regression: true}]}, now);
  await ingest(db, {kind: 'recorded', day: '2026-10-11', version: '0.9.165', rows: [{name: 'cookie-banner-links-1', ok: true}, {name: 'cv-choice-step-1', ok: false, note: 'attached: #resumeFile'}]}, now);
  const d = await data(db, now);
  assert.deepEqual(d.sites.map(site => [site.name, site.reached, site.regression, site.history]), [['jobs.ch account', 'posting', true, ['code/bot', 'posting']], ['Lever form', 'ready', false, ['ready']]]);
  assert.deepEqual(d.cases.map(item => [item.name, item.ok, item.note]), [['cv-choice-step-1', false, 'attached: #resumeFile'], ['cookie-banner-links-1', true, null]]);
  assert.deepEqual([d.tiles.cases, d.tiles.casesFailing, d.tiles.sites, d.tiles.regressions, d.tiles.reachedForm], [2, 1, 2, 1, 50]);
  assert.deepEqual(d.nights.map(night => [night.day, night.counts['code/bot'], night.counts.ready, night.counts.posting]), [['2026-10-10', 1, 1, 0], ['2026-10-11', 0, 0, 1]]);
});

test('the pool: every site is listed, also one never run; platform and flow come from the host and signature; a path or query never gets in', async () => {
  const db = d1();
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [
    {name: 'Acme', start_host: 'job-boards.greenhouse.io', signature: 'other>form@job-boards.greenhouse.io#form'},
    {name: 'Beta', start_host: 'job-boards.greenhouse.io', signature: 'form@job-boards.greenhouse.io#ready'},
    {name: 'Gamma', start_host: 'career5.successfactors.eu'}, {name: 'Delta', start_host: 'a.wd5.myworkdayjobs.com'},
    {name: 'posting>form@x.com (found 2026-10-10)', start_host: 'careers.breitling.com', signature: 'posting>form@x.com#form'},
    {name: 'Leaky', start_host: 'https://x.com/jobs/1?token=abc', signature: 'form@x.com/path?q=1#form'}]}, now);
  const [leaky] = db.db.prepare("SELECT start_host, signature FROM applying_pool WHERE name = 'Leaky'").all();
  assert.deepEqual({...leaky}, {start_host: null, signature: null});
  await ingest(db, {kind: 'smoke', day: '2026-10-12', rows: [{name: 'Beta', host: 'job-boards.greenhouse.io', reached: 'ready'}]}, now);
  await ingest(db, {kind: 'pool', day: '2026-10-12', rows: [{name: 'Gamma', signature: 'posting>account@career5.successfactors.eu#code/bot'}]}, now);   // a later row without a host keeps the start host
  const d = await data(db, now), by = Object.fromEntries(d.pool.map(item => [item.name, item]));
  assert.equal(by.Acme.platform, 'Greenhouse'); assert.equal(by.Acme.flow, by.Beta.flow); assert.equal(by.Acme.raw, 'other>form@job-boards.greenhouse.io#form');
  assert.equal(by.Beta.reached, 'ready');
  assert.deepEqual([by.Acme.reached, by.Acme.history], ['form', ['form']]);   // known only from its signature: the step it showed
  assert.deepEqual([by.Delta.reached, by.Delta.history, by.Delta.flow], [null, [], null]);   // never run: "—"
  assert.equal(by['posting>form@x.com (found 2026-10-10)'], undefined); assert.equal(by.Breitling.flow, 'posting → form');   // a discovered site is named by its host's domain
  assert.equal(by.Gamma.platform, 'SuccessFactors'); assert.equal(by.Gamma.start, 'career5.successfactors.eu'); assert.equal(by.Gamma.flow, 'posting → account → bot check');
  assert.deepEqual(d.platforms.map(item => [item.name, item.sites, item.flows]), [['Greenhouse', 2, 1], ['Custom', 1, 0], ['Custom (x)', 1, 1], ['SuccessFactors', 1, 1], ['Workday', 1, 0]]);
  assert.equal(d.pool.length, 6);
});
