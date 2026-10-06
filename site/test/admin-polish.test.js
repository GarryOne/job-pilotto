// The admin pages' shared polish (owner's UI review, 7 Oct 2026): the question as a muted line under the title, one table script
// on every page, amber filter pills, Overview's precision as a percent of a percent no more, E2E titles with short hashes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filterLinks, withNav} from '../src/admin.js';
import {page as overview} from '../src/overview.js';

test('the question sits under the page title, without the yellow label, and the table script is on the page', () => {
  const html = withNav('<html><head></head><body><main><header><h1>App</h1></header><table></table></main></body></html>', '/admin/app');
  assert.match(html, /<\/header><p class="admin-question">Do the installed apps run well/);
  assert.doesNotMatch(html, /The question this page answers/);
  assert.match(html, /<script>document\.querySelectorAll\('main table'\)/);
  const bare = withNav('<html><head></head><body><main><p>x</p></main></body></html>', '/admin/e2e');
  assert.match(bare, /<\/nav><p class="admin-question">/, 'a page without a header gets it under the menu');
});

test('filter links: the current one is the amber pill', () => {
  const html = filterLinks([[7, '7 days', '?days=7'], [30, '30 days', '?days=30']], 30);
  assert.match(html, /<a class="filter" href="\?days=7">7 days<\/a><a class="filter on" href="\?days=30" aria-current="true">30 days<\/a>/);
});

test('Overview: a series with no history is just its number; no series says where to look', () => {
  const html = overview({cards: {'self-healing': [{label: 'precision', values: [null, null, 0.38], format: v => `${Math.round(v * 100)}%`}]}, attention: [], recall: null, from: 'a', to: 'b'});
  assert.match(html, /<span>38%<\/span>/);
  assert.doesNotMatch(html, /3800%/);
  assert.match(html, /E2E runs<\/h2><p class="muted">No weekly numbers here: open the page →/);
});
