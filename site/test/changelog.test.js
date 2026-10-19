// The public /changelog (src/changelog.js, public/changelog.html): nothing internal or Pro-related can be published, an entry is three kinds of items with emoji, the page renders text only.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {test} from 'node:test';
import {FORBIDDEN, cleanGroups, newestFirst, problems, versionOf} from '../src/changelog.js';

const pub = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const good = {version: '0.7.16', date: '2026-10-14', channel: 'stable', groups: [{kind: 'improvements', items: [{emoji: '⚡', lead: 'Faster first job', text: 'Your first matching job now shows up in about 18 seconds.'}]}]};

test('what must never be public is caught: costs, prices, Pro, test accounts, outages, CI, sessions, PRs, keys', () => {
  const leaks = ['Pro is $29 one-time', 'Costs went down by 30%', 'Fixed a test account sign-in', 'After the outage on Tuesday', 'CI is faster now', 'The session fixer was renamed', 'Merged PR #1000', 'Your API key is stored safely', 'Billing page added', 'The free AI budget is shown'];
  for (const text of leaks) assert.match(text, FORBIDDEN, text);
  for (const text of ['Your first matching job now shows up in about 18 seconds.', 'Forms with radio questions are filled correctly.', 'Reopening a broken page starts again from the job posting.']) assert.doesNotMatch(text, FORBIDDEN, text);
});

test('an answer keeps clean items in page order, drops rule-breakers, unknown kinds and bad emoji; an unusable answer is an error', () => {
  const answer = JSON.stringify({groups: [
    {kind: 'fixes', items: [{emoji: '🐛', lead: 'Dropdown fixed', text: 'Required dropdowns are filled.'}, {lead: 'Pro plan', text: 'Pro is $29.'}, {lead: '', text: 'no lead'}]},
    {kind: 'features', items: [{emoji: 'not an emoji', lead: 'New thing', text: 'It can do more.'}]},
    {kind: 'internal', items: [{lead: 'Secret', text: 'Should not show.'}]}]});
  const cleaned = cleanGroups(`Here:\n${answer}`);
  assert.deepEqual(cleaned.groups.map(group => group.kind), ['features', 'fixes'], 'page order, unknown kind gone');
  assert.deepEqual(cleaned.groups[0].items, [{lead: 'New thing', text: 'It can do more.'}], 'a bad emoji is left out, the item stays');
  assert.deepEqual(cleaned.groups[1].items, [{emoji: '🐛', lead: 'Dropdown fixed', text: 'Required dropdowns are filled.'}]);
  assert.equal(cleaned.dropped.length, 1);
  assert.equal(cleanGroups('nope').error, 'not JSON');
  assert.equal(cleanGroups({}).error, 'no groups');
  assert.deepEqual(cleanGroups({groups: []}), {groups: [], dropped: []});
  assert.equal(versionOf('desktop-v0.7.16'), '0.7.16');
});

test('only a well-formed, clean entry passes: version, date, channel, kinds, items, no leaks; newest first', () => {
  assert.deepEqual(problems(good), []);
  assert.ok(problems({...good, version: 'v1'}).includes('version'));
  assert.ok(problems({...good, channel: 'alpha'}).includes('channel'));
  assert.deepEqual(problems({...good, version: '0.0.1', channel: 'start'}), []);
  assert.ok(problems({...good, groups: []}).includes('groups'));
  assert.ok(problems({...good, groups: [{kind: 'secrets', items: good.groups[0].items}]}).some(item => item.startsWith('kind')));
  assert.ok(problems({...good, groups: [{kind: 'fixes', items: []}]}).some(item => item.startsWith('items')));
  assert.ok(problems({...good, groups: [{kind: 'fixes', items: [{lead: 'Pro', text: 'Pro launched.'}]}]}).some(item => item.startsWith('item')));
  assert.ok(problems({...good, groups: [{kind: 'fixes', items: [{emoji: 'abc', lead: 'A', text: 'B.'}]}]}).some(item => item.startsWith('item')));
  assert.deepEqual(newestFirst(['0.7.2', '0.7.16', '0.7.12'].map(version => ({version}))).map(entry => entry.version), ['0.7.16', '0.7.12', '0.7.2']);
  assert.deepEqual(newestFirst(['0.0.1', '0.4.0', '0.7.2'].map(version => ({version}))).map(entry => entry.version), ['0.7.2', '0.4.0', '0.0.1']);
});

test('every entry in the fallback file passes the same rules', () => {
  const published = JSON.parse(pub('changelog-seed.json'));
  assert.ok(Array.isArray(published));
  for (const entry of published) assert.deepEqual(problems(entry), [], `version ${entry.version}`);
  assert.equal(new Set(published.map(entry => entry.version)).size, published.length);
});

test('no static file shadows /changelog.json: a file in public/ is served before the Worker, so the stored versions would never show (18 Oct 2026: the page stayed on 0.7.16)', () => {
  assert.equal(existsSync(new URL('../public/changelog.json', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/changelog-seed.json', import.meta.url)), true);
});

test('the page reads changelog.json, shows the three group titles and the channel, writes text (never HTML), is in the sitemap and linked from the footer', () => {
  const html = pub('changelog.html');
  for (const title of ['New features', 'Improvements', 'Bug fixes']) assert.match(html, new RegExp(title));
  assert.match(html, /Beta/);
  assert.match(html, /fetch\('changelog\.json'\)/);
  assert.doesNotMatch(html.split('<script>')[1], /innerHTML/);
  assert.match(pub('sitemap.xml'), /<loc>https:\/\/www\.jobadabra\.top\/changelog<\/loc>/);
  assert.match(pub('index.html'), /<a href="changelog\.html">What's new<\/a>/);
  assert.doesNotMatch(html, /\$\d|\bPro\b/);
});

test('the page puts a row of dots above the project-start entry (the gap before the first registered release) and labels it as the start', () => {
  const script = pub('changelog.html').split('<script>')[1];
  assert.match(script, /entry\.channel === 'start'/);
  assert.match(script, /className = 'gap'/);
  assert.match(script, /aria-hidden/);
  assert.match(script, /Project start/);
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
  assert.match(html, /Every version of Jobadabra, in plain words\./);
  assert.match(html, /The first release notes are coming soon\./);
  assert.match(pub('styles.css'), /\.section-head\.stacked \{ grid-template-columns: 1fr; \}/);
});
