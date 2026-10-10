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
