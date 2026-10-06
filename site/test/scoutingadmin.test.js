// /admin/scouting (src/scoutingadmin.js): the central employer list's growth and health, from the site's own tables; counts and names only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {page, snapshot, topKind} from '../src/scoutingadmin.js';

const feeds = [
  {company: 'Coop', ats: 'successfactors', slug: 'jobs.coop.ch', regions: ['europe'], kinds: {sales_retail: 0.6, logistics: 0.3}, fresh: {ok: '2026-10-06', fails: 0, jobs: 3142, trend: 'up', new: '2026-10-06'}},
  {company: 'Datadog', ats: 'greenhouse', slug: 'datadog', regions: ['europe', 'north_america'], kinds: {software: 0.95}, fresh: {ok: '2026-10-01', fails: 4, jobs: 0, trend: 'down', new: null}},
  {company: 'Old', ats: 'lever', slug: 'old', regions: []}];

test('the daily snapshot counts employers, those outside IT, failing ones, finds from installs and dead ends', () => {
  assert.equal(topKind(feeds[0]), 'sales_retail');
  assert.equal(topKind(feeds[2]), 'unknown');
  assert.deepEqual(snapshot(feeds, 1, 7), {feeds: 3, non_it: 1, failing: 1, from_pool: 1, dead_ends: 7});
});

test('the page says its verdict and draws every section, from data or with an empty line', () => {
  const html = page({feeds, daily: [{day: '2026-09-29', feeds: 2, non_it: 1, failing: 0, from_pool: 0, dead_ends: 0}], sharing7: 1, sharing30: 2, shared: 5,
    routes: [{how: 'ai_idea', feeds: 3, hits: 9}], useful: [{company: 'Coop', hits: 9, installs: 1, jobs: 3142}], dead: [{company: 'Fnac Suisse', host: 'fnac.ch', installs: 2, last: '2026-10-06'}],
    deadTotal: 2, central: null});
  assert.match(html, /3 employers in the central list, \+1 this week; 1 install sharing this week; 33% hire mostly outside IT\./);
  for (const heading of ['Growth', 'The pool', 'Discovery routes that work', 'Coverage by kind of role and region', 'Freshness', 'Most useful employers', 'Dead ends', 'Scouting'])
    assert.match(html, new RegExp(heading), heading);
  assert.match(html, /<td>Datadog<\/td><td>4<\/td>/, 'a failing employer is listed');
  const empty = page({feeds: [], daily: [], sharing7: 0, sharing30: 0, shared: 0, routes: [], useful: [], dead: [], deadTotal: 0, central: null});
  assert.match(empty, /No employer list published yet/);
});
