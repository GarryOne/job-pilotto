// The widget zoo's format and verdicts (lib/widget-zoo.mjs), without a browser: every page names a known widget, asks one question, checks one commit, stays small and names no
// real site; a replay result becomes read / committed / safe as the runner prints it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {MAX_PAGE_BYTES, harnessLine, loadZoo, summarizeZoo, verdictOf, zooProblems} from '../lib/widget-zoo.mjs';

const zoo = loadZoo();

test('the zoo has pages', () => assert.ok(zoo.length >= 8, `only ${zoo.length} pages`));

test('every zoo page is well formed, small and on a made-up host', () => {
  for (const item of zoo) {
    assert.deepEqual(zooProblems(item), [], item.name);
    const file = path.join(item.dir, item.pages[0].file);
    assert.ok(fs.statSync(file).size <= MAX_PAGE_BYTES, `${item.name}: page over ${MAX_PAGE_BYTES} bytes`);
    assert.match(new URL(item.pages[0].url).hostname, /\.zoo\.example\.com$/, `${item.name}: the host is made up`);
  }
});

test('each zoo page has its own host, so pages replay side by side', () => {
  const hosts = zoo.map(item => new URL(item.pages[0].url).hostname);
  assert.equal(new Set(hosts).size, hosts.length);
});

test('a format problem is named', () => {
  assert.deepEqual(zooProblems({widget: 'text', shape: 'x', pages: [{}], expect: {asked: ['Q'], filled: ['#a'], notTold: ['pressed the submit']}}), []);
  const problems = zooProblems({widget: 'slider', shape: '', pages: [], expect: {asked: []}});
  for (const part of ['not one of WIDGETS', 'no shape', 'one question', 'no commit check', 'notTold', 'one page']) assert.ok(problems.some(line => line.includes(part)), part);
});

test('a replay result becomes read, committed and safe', () => {
  const item = {name: 'a', widget: 'typeahead'};
  assert.deepEqual(verdictOf(item, {failures: []}), {name: 'a', widget: 'typeahead', read: true, committed: true, safe: true, failures: []});
  assert.equal(verdictOf(item, {failures: ['filled: #x']}).committed, false);
  assert.equal(verdictOf(item, {failures: ['filled: #x']}).read, true);
  assert.equal(verdictOf(item, {failures: ['asked: Q', 'filled: #x']}).read, false);
  assert.equal(verdictOf(item, {failures: ['present: .on']}).committed, false);
  assert.equal(verdictOf(item, {failures: ['notTold: pressed the submit']}).safe, false);
  const broken = verdictOf(item, {failures: ['error: browser closed']});
  assert.equal(broken.read || broken.committed, false);
});

test('the summary counts per widget', () => {
  const summary = summarizeZoo([{name: 'a', widget: 'text', read: true, committed: true, safe: true}, {name: 'b', widget: 'text', read: true, committed: false, safe: false}]);
  assert.deepEqual(summary, {total: 2, read: 2, committed: 1, unsafe: ['b'], byWidget: {text: {total: 2, committed: 1}}});
});

test('the --model route answers the fill check with the model and every other phase with a canned ready', async () => {
  const {modelRoute} = await import('../lib/widget-zoo-model.mjs');
  const shadow = new Map();
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({controls: [{n: 1, verdict: 'ok', reason: ''}, {n: 2, verdict: 'empty', reason: 'not_kept'}]})}]})}};
  const route = await modelRoute(shadow, {client});
  assert.deepEqual(await route(JSON.stringify({phase: 'form', sketch: {}})), {ok: true, answer: 'ready', step: 'final'});
  const sketch = {url: 'https://text.zoo.example.com/apply', title: 'Apply', controls: [{type: 'text', label: 'First name', state: 'filled', match: 'yes'}, {type: 'text', label: 'City', state: 'empty', match: 'no'}], buttons: [], texts: [], frames: []};
  const found = await route(JSON.stringify({phase: 'fill', sketch}));
  assert.equal(found.answer, 'shadow');
  assert.deepEqual(shadow.get('text.zoo.example.com'), [{n: 2, label: 'City', verdict: 'empty', reason: 'not_kept'}]);
});

test('--model never runs with an API key or in CI', async () => {
  const {modelRoute} = await import('../lib/widget-zoo-model.mjs');
  await assert.rejects(() => modelRoute(new Map(), {env: {ANTHROPIC_API_KEY: 'x'}}), /ANTHROPIC_API_KEY/);
  await assert.rejects(() => modelRoute(new Map(), {env: {CI: 'true'}}), /not in CI/);
});

test('a zoo run that replayed no page says "harness error" first, never a finding', () => {
  assert.equal(harnessLine([], 8, 'Cannot find module desktop/shared/alias-schema.js'), 'harness error: replayed 0 of 8 pages (Cannot find module desktop/shared/alias-schema.js)');
  assert.equal(harnessLine([{failures: ['error: browser closed']}, {failures: ['isolation: another tab']}], 2), 'harness error: replayed 0 of 2 pages');
  assert.equal(harnessLine([{failures: ['error: x']}, {failures: ['filled: #a']}], 2), '');   // one page replayed (and missed): a finding, not a dead harness
});
