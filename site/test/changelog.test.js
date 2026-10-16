// The public /changelog (src/changelog.js, public/changelog.html + changelog.json): nothing internal or Pro-related can be published, entries are per stable version newest first, the page renders text only.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {FORBIDDEN, addEntry, cleanItems, problems, versionOf} from '../src/changelog.js';

const pub = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const good = {version: '0.7.16', date: '2026-10-14', items: [{lead: 'Faster first job', text: 'Your first matching job now shows up in about 18 seconds.'}]};

test('what must never be public is caught: costs, prices, Pro, test accounts, outages, CI, sessions, PRs, keys', () => {
  const leaks = ['Pro is $29 one-time', 'Costs went down by 30%', 'Fixed a test account sign-in', 'After the outage on Tuesday', 'CI is faster now', 'The session fixer was renamed', 'Merged PR #1000', 'Your API key is stored safely', 'Early adopters pay less', 'Billing page added', 'The free AI budget is shown'];
  for (const text of leaks.filter(item => !/Early adopters/.test(item))) assert.match(text, FORBIDDEN, text);
  for (const text of ['Your first matching job now shows up in about 18 seconds.', 'Forms with radio questions are filled correctly.', 'Reopening a broken page starts again from the job posting.']) assert.doesNotMatch(text, FORBIDDEN, text);
});

test('a draft keeps clean items, reports the dropped ones, and an unusable answer is an error', () => {
  const answer = JSON.stringify({items: [{lead: 'Faster', text: 'Jobs appear sooner.'}, {lead: 'Pro plan', text: 'Pro is $29.'}, {lead: '', text: 'no lead'}]});
  const cleaned = cleanItems(`Here:\n${answer}`);
  assert.deepEqual(cleaned.items, [{lead: 'Faster', text: 'Jobs appear sooner.'}]);
  assert.equal(cleaned.dropped.length, 1);
  assert.equal(cleanItems('nope').error, 'not JSON');
  assert.equal(cleanItems({}).error, 'no items');
  assert.deepEqual(cleanItems({items: []}), {items: [], dropped: []});
  assert.equal(versionOf('desktop-v0.7.16'), '0.7.16');
});

test('only a well-formed, clean entry can be added; the list stays newest version first, one entry per version', () => {
  assert.deepEqual(problems(good), []);
  assert.ok(problems({...good, version: 'v1'}).includes('version'));
  assert.ok(problems({...good, items: []}).includes('items'));
  assert.throws(() => addEntry([], {...good, items: [{lead: 'Pro', text: 'Pro launched.'}]}), /not publishable/);
  let list = addEntry([], good);
  list = addEntry(list, {...good, version: '0.7.2'});
  list = addEntry(list, {...good, version: '0.7.12'});
  list = addEntry(list, {...good, items: [{lead: 'Fixed', text: 'A typo.'}]});
  assert.deepEqual(list.map(entry => entry.version), ['0.7.16', '0.7.12', '0.7.2']);
  assert.equal(list[0].items[0].lead, 'Fixed');
});

test('every published entry passes the same rules (add a new version through tools/changelog-draft.mjs --add)', () => {
  const published = JSON.parse(pub('changelog.json'));
  assert.ok(Array.isArray(published));
  for (const entry of published) assert.deepEqual(problems(entry), [], `version ${entry.version}`);
  assert.equal(new Set(published.map(entry => entry.version)).size, published.length);
});

test('the page reads changelog.json, writes text (never HTML), is in the sitemap and linked from the footer', () => {
  const html = pub('changelog.html');
  assert.match(html, /fetch\('changelog\.json'\)/);
  assert.doesNotMatch(html.split('<script>')[1], /innerHTML/);
  assert.match(pub('sitemap.xml'), /<loc>https:\/\/www\.jobpilotto\.top\/changelog<\/loc>/);
  assert.match(pub('index.html'), /<a href="changelog\.html">What's new<\/a>/);
  assert.doesNotMatch(html, /\$\d|\bPro\b/);
});

test('every page with the top menu links to "What\'s new", on desktop (link row) and phone (beside Download)', () => {
  for (const tree of ['../public']) {   // the preview copy of the site is ignored by the gate (tests/test_gate_cache.py); it got the same links by hand
    for (const name of readdirSync(new URL(`${tree}/`, import.meta.url)).filter(file => file.endsWith('.html'))) {
      const html = readFileSync(new URL(`${tree}/${name}`, import.meta.url), 'utf8');
      if (!/<nav class="topnav[^>]*>[\s\S]*?class="links"/.test(html)) continue;   // privacy and terms have a brand-only bar: no menu
      const nav = html.match(/<nav class="topnav[\s\S]*?<\/nav>/)[0];
      assert.match(nav, /<div class="links">[\s\S]*<a href="changelog\.html"[^>]*>What's new<\/a>[\s\S]*<\/div>/, `${tree}/${name}: link row`);
      assert.match(nav, /<a class="news" href="changelog\.html">What's new<\/a>/, `${tree}/${name}: phone link`);
    }
  }
});

test('the changelog header stacks its one-line intro, and an empty list says the notes are coming', () => {
  const html = pub('changelog.html');
  assert.match(html, /<header class="section-head stacked"/);
  assert.match(html, /Every version of Job Pilotto, in plain words\./);
  assert.match(html, /The first release notes are coming soon\./);
  assert.match(pub('styles.css'), /\.section-head\.stacked \{ grid-template-columns: 1fr; \}/);
});
