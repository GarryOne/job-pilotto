// Strategy's order and its one line of suggestions (owner, 18 Oct 2026, review fixes 3 and 10): heading → tabs → a compact notice → content; the
// full suggestions list only in Suggestions, one "N suggestions to improve your search · Review" line elsewhere; Notion only as one "View source in
// Notion" in the header's ⋯ menu, on the Notion store only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {improveWords} from '../renderer/strategy-parts.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('renderer/index.html');
const page = html.slice(html.indexOf('<div class="view strategy-page"'), html.indexOf('<p class="message" id="strategy-load">'));

test('heading, then the tabs, then the notices, then the content', () => {
  const at = marker => { const index = page.indexOf(marker); assert.ok(index > 0, `${marker} is on the page`); return index; };
  const order = ['<header class="view-head">', 'class="tabs strategy-tabs"', 'class="strategy-notices"', 'id="strategy-profile-empty"', 'id="strategy-outdated"',
    'id="strategy-improve"', 'id="strategy-yours"', 'id="strategy-suggestions"', 'id="strategy-scoring"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.doesNotMatch(page, /class="tab-head"/, 'the tab names the section: no second heading under it');
});

test('one line names how many suggestions and the top one; Review opens the list', () => {
  assert.deepEqual(improveWords({title: 'Expand your locations', text: '5 matching roles in France'}), {top: 'Top: Expand your locations (5 matching roles in France)'});
  assert.equal(improveWords({title: '+ Add role words', text: ''}).top, 'Top: Add role words');
  const suggestions = read('renderer/pages/strategy-suggestions.js');
  const draw = suggestions.slice(suggestions.indexOf('export function drawImprove('), suggestions.indexOf('// One row: icon, title'));
  assert.match(draw, /go\.addEventListener\('click', \(\) => showTab\('strategy-suggestions'\)\)/);
  assert.doesNotMatch(draw, /item-rows|improveRow/, 'one line, not a row per kind');
  // One count, two places (shared-counts.js): the tab's badge and the line are painted from it, never counted apart.
  assert.match(page, /id="suggestions-count" data-count-of="strategy-suggestions"/);
  assert.match(draw, /countOf: SUGGESTIONS, countOne: 'suggestion'/);
  assert.match(suggestions, /defineCount\(SUGGESTIONS, /);
  assert.doesNotMatch(suggestions, /\$\('suggestions-count'\)/, 'the badge is painted by paintCount only');
});

test('the line hides on Suggestions itself', () => {
  assert.match(read('renderer/pages/strategy-state.js'), /\.strategy-page'\)\?\.setAttribute\('data-tab', id\)/);
  assert.match(read('renderer/style.css'), /\.strategy-page\[data-tab="strategy-suggestions"\] \.improve-line \{ display: none; \}/);
});

test('Notion is one menu item behind ⋯, shown on the Notion store only', () => {
  assert.doesNotMatch(page.replace(/<!--[\s\S]*?-->/g, ''), /in Notion/, 'no "Edit in Notion" / "Open in Notion" button on the page');
  assert.match(page, /<button[^>]*id="strategy-more"[^>]*data-notion-only/);
  const init = read('renderer/pages/strategy.js');
  assert.equal((init.match(/in Notion/g) || []).length, 1);
  assert.match(init, /openMenu\(\$\('strategy-more'\), \[\{label: 'View source in Notion'/);
});

// Mockup 03 (owner, 18 Oct 2026): Main goals → Locations beside Job preferences → Advanced search settings folded; the bar after the tabs' content.
test('Your strategy: Main goals, then Locations beside Job preferences, then Advanced folded; one bar for every tab', () => {
  const at = id => page.indexOf(`id="${id}"`);
  for (const id of ['strategy-main-goals', 'strategy-locations', 'strategy-job-prefs', 'strategy-advanced', 'strategy-targets']) assert.ok(at(id) > 0, id);
  assert.ok(at('strategy-main-goals') < at('strategy-locations') && at('strategy-locations') < at('strategy-job-prefs') && at('strategy-job-prefs') < at('strategy-advanced'));
  assert.match(page, /<details class="card advanced-settings" id="strategy-advanced">/, 'folded until opened');
  assert.ok(at('strategy-advanced') < at('strategy-targets'), 'the Advanced cards live inside it');
  assert.ok(at('strategy-bar-host') > at('strategy-scoring'), 'the bar sits after every tab, so it stays on each');
  assert.doesNotMatch(html, /id="strategy-savebar"|id="strategy-leave-dialog"|id="targets-save"/, 'the old bar and its dialog are gone');
});

test('class: every Strategy card is reachable from ⌘K', () => {
  const nav = read('renderer/pages/nav.js');
  for (const name of ['Main goals', 'Locations', 'Job preferences', 'Advanced search settings']) assert.match(nav, new RegExp(`add\\('Strategy', '${name}'`), name);
});
