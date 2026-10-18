// tools/changelog-publish.mjs: which releases get an entry (stable, or a beta the gate approved), the draft with a fake model: kinds, floor, hidden versions, and a failed AI answer publishes nothing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {problems} from '../src/changelog.js';
import {PATHSPEC, chunksOf, draftEntry, estimate, newerThanStored, plan, startEntry} from '../../tools/changelog-publish.mjs';

const release = (version, extra = {}) => ({tagName: `desktop-v${version}`, isPrerelease: true, isDraft: false, publishedAt: '2026-10-18T01:00:00Z', body: '', ...extra});
const approved = {body: 'Beta-approved: abc123'};
const work = {tag: 'desktop-v0.7.20', prev: 'desktop-v0.7.16', version: '0.7.20', date: '2026-10-18', channel: 'beta'};
const model = (...texts) => { const calls = []; return {calls, fetch: async (url, init) => { calls.push(JSON.parse(init.body)); const text = texts.shift(); return new Response(JSON.stringify({content: [{type: 'text', text}], usage: {input_tokens: 1500, output_tokens: 400}, stop_reason: 'end_turn'})); }}; };

test('stable releases and approved betas get an entry; a build that failed its gate does not; its commits roll into the next one', () => {
  const releases = [release('0.7.15', {isPrerelease: false}), release('0.7.16', {isPrerelease: false}), release('0.7.17', approved), release('0.7.18'), release('0.7.19', approved), release('0.7.20', {isDraft: true, ...approved}), {...release('pr-assets-1'), tagName: 'pr-assets-1'}];
  const {draft} = plan(releases, {}, 'abc1234');
  assert.deepEqual(draft.map(item => [item.version, item.prev, item.channel]), [['0.7.15', 'abc1234', 'stable'], ['0.7.16', 'desktop-v0.7.15', 'stable'], ['0.7.17', 'desktop-v0.7.16', 'beta'], ['0.7.19', 'desktop-v0.7.17', 'beta']]);
});

test('a version is drafted once and re-running skips it; a stored beta that became stable is promoted; the oldest release is the changes since the first commit', () => {
  const releases = [release('0.7.14', {isPrerelease: false}), release('0.7.16', {isPrerelease: false}), release('0.7.17', {isPrerelease: false}), release('0.7.18', approved)];
  const done = plan(releases, {'0.7.16': 'stable', '0.7.17': 'beta'}, 'abc1234');
  assert.deepEqual(done.draft.map(item => item.version), ['0.7.14', '0.7.18']);
  assert.deepEqual(done.promote, [{version: '0.7.17', channel: 'stable'}]);
  assert.deepEqual(plan(releases, {}, 'abc1234').draft.map(item => [item.version, item.prev]), [['0.7.14', 'abc1234'], ['0.7.16', 'desktop-v0.7.14'], ['0.7.17', 'desktop-v0.7.16'], ['0.7.18', 'desktop-v0.7.17']]);
  assert.deepEqual(plan(releases, {'0.7.14': 'stable', '0.7.16': 'stable', '0.7.17': 'stable', '0.7.18': 'beta'}, 'abc1234'), {draft: [], promote: []});
});

test('an alpha tag is the oldest version, shown as x.y.z, and sorts before the next release', () => {
  const releases = [release('0.5.0', {isPrerelease: false}), release('0.4.0-alpha.254', {isPrerelease: false})];
  assert.deepEqual(plan(releases, {}, 'abc1234').draft.map(item => [item.version, item.tag, item.prev]), [['0.4.0', 'desktop-v0.4.0-alpha.254', 'abc1234'], ['0.5.0', 'desktop-v0.5.0', 'desktop-v0.4.0-alpha.254']]);
});

test('the 0.0.1 entry is the project start, dated at the first commit, and passes the same checks', () => {
  const entry = startEntry('2026-09-24');
  assert.deepEqual([entry.version, entry.date, entry.channel], ['0.0.1', '2026-09-24', 'start']);
  assert.deepEqual(problems(entry), []);
  assert.equal(entry.groups.length, 1);
});

test('the draft is grouped by kind, rule-breakers are dropped, and the cost is measured', async () => {
  const ai = model(JSON.stringify({groups: [{kind: 'fixes', items: [{emoji: '🐛', lead: 'Dropdowns fixed', text: 'Required dropdowns fill again.'}, {lead: 'Pro', text: 'Pro costs $29.'}]}, {kind: 'features', items: [{emoji: '🔎', lead: 'Better search', text: 'Search shows more jobs.'}]}]}));
  const done = await draftEntry(work, {subjects: ['Fix dropdowns', 'Add search'], key: 'k', fetch: ai.fetch});
  assert.deepEqual(done.entry.groups.map(group => group.kind), ['features', 'fixes']);
  assert.equal(done.dropped.length, 1);
  assert.ok(done.cost > 0 && done.cost < 0.01, `cost ${done.cost}`);
  assert.match(ai.calls[0].messages[0].content, /0\.7\.20 \(changes since 0\.7\.16\)/);
  const first = model('{"groups":[]}');
  await draftEntry({...work, prev: 'abc1234', first: true}, {subjects: ['x'], key: 'k', fetch: first.fetch});
  assert.match(first.calls[0].messages[0].content, /changes since the start of the project/);
});

test('nothing a user would notice is hidden, not retried; no commits cost nothing', async () => {
  assert.equal((await draftEntry(work, {subjects: [], key: 'k', fetch: model().fetch})).hidden, true);
  const done = await draftEntry(work, {subjects: ['Refactor tests'], key: 'k', fetch: model('{"groups":[]}').fetch});
  assert.equal(done.hidden, true);
  assert.ok(done.cost > 0);
});

test('an unusable AI answer is retried once, then the version is not published and the error says why', async () => {
  const good = JSON.stringify({groups: [{kind: 'features', items: [{lead: 'New', text: 'A thing.'}]}]});
  assert.ok((await draftEntry(work, {subjects: ['x'], key: 'k', fetch: model('sorry', good).fetch})).entry);
  await assert.rejects(draftEntry(work, {subjects: ['x'], key: 'k', fetch: model('sorry', 'still no').fetch}), /0\.7\.20: the model's answer was unusable twice \(not JSON\)/);
  await assert.rejects(draftEntry(work, {subjects: ['x'], key: 'k', fetch: async () => new Response('{"error":{"message":"credit balance too low"}}', {status: 400})}), /credit balance too low/);
});

const group = (lead, kind = 'features') => JSON.stringify({groups: [{kind, items: [{lead, text: `${lead} works now.`}]}]});
const many = n => Array.from({length: n}, (_, i) => `Change ${i}`);

test('only what a user can see is read: tests, e2e, fixtures, recordings, CI, docs and tools never reach the AI', () => {
  const spec = PATHSPEC.join(' ');
  for (const kept of ['desktop', 'src', 'extension', 'worker/src', 'config']) assert.ok(PATHSPEC.includes(kept), kept);
  for (const dropped of ['desktop/e2e', 'desktop/test', 'desktop/scripts', 'desktop/docs']) assert.match(spec, new RegExp(`:\\(exclude\\)${dropped}`), dropped);
  assert.match(spec, /exclude,glob\)\*\*\/fixtures\/\*\*/);
  assert.doesNotMatch(spec, /(^| )tools( |$)|\.github|(^| )docs( |$)/);
});

test('big versions are cut in chunks of at most 300 subjects', () => {
  assert.deepEqual(chunksOf(many(650)).map(chunk => chunk.length), [300, 300, 50]);
  assert.deepEqual(chunksOf(many(10)).map(chunk => chunk.length), [10]);
  assert.deepEqual(chunksOf([]), []);
});

test('a big version is drafted per chunk and merged by one short call; each prompt stays small', async () => {
  const ai = model(group('One'), group('Two', 'fixes'), group('Merged'));
  const done = await draftEntry(work, {subjects: many(450), key: 'k', fetch: ai.fetch});
  assert.equal(ai.calls.length, 3);
  assert.match(ai.calls[0].messages[0].content, /part 1 of 2/);
  assert.match(ai.calls[2].messages[0].content, /One/);
  assert.deepEqual(done.entry.groups.map(item => item.items[0].lead), ['Merged']);
  for (const call of ai.calls) assert.ok(call.messages[0].content.length < 12000);
});

test('a version of one chunk costs one call; a failed merge falls back to the chunk results, never publishing a rule-breaker', async () => {
  const one = model(group('Only'));
  await draftEntry(work, {subjects: many(300), key: 'k', fetch: one.fetch});
  assert.equal(one.calls.length, 1);
  const bad = model(group('One'), group('Two', 'fixes'), 'no json', 'no json');
  const done = await draftEntry(work, {subjects: many(450), key: 'k', fetch: bad.fetch});
  assert.deepEqual(done.entry.groups.map(item => item.kind), ['features', 'fixes']);
});

test('the run stops at its spend cap: no call is made past it and the version is not published', async () => {
  const ai = model(group('One'), group('Two'), group('Three'));
  const spend = {total: 0.15, cap: 0.15};
  await assert.rejects(draftEntry(work, {subjects: many(10), key: 'k', fetch: ai.fetch, spend}), /spend cap/);
  assert.equal(ai.calls.length, 0);
});

test('the $0 estimate says per version the chunks, tokens in and out, and the cost', () => {
  const {chunks, tokensIn, tokensOut, cost} = estimate(many(650));
  assert.equal(chunks, 3);
  assert.ok(tokensIn > 650 * 3 && tokensIn < 25000, `in ${tokensIn}`);
  assert.ok(tokensOut > 0 && cost > 0 && cost < 0.05, `cost ${cost}`);
  // measured on the 18 Oct 2026 backfill (a full answer is ~2,000 output tokens): 216 subjects cost $0.0016, 15 cost $0.0007, 5 cost $0.0003, 1,140 (4 chunks + join) $0.0112
  const near = (subjects, actual) => { const {cost} = estimate(many(subjects)); assert.ok(cost > actual * 0.6 && cost < actual * 1.6, `${subjects} subjects: est ${cost} vs ${actual}`); };
  near(216, 0.0016); near(15, 0.0007); near(5, 0.0003); near(989, 0.0112);
  assert.deepEqual(estimate([]), {chunks: 0, tokensIn: 0, tokensOut: 0, cost: 0});
});

test('an automatic run drafts only versions newer than the newest stored one; older gaps wait for --backfill', () => {
  const list = ['0.5.0', '0.7.2', '0.7.17', '0.7.18'].map(version => ({version}));
  assert.deepEqual(newerThanStored(list, {'0.7.16': 'stable'}).map(item => item.version), ['0.7.17', '0.7.18']);
  assert.deepEqual(newerThanStored(list, {'0.7.18': 'beta'}), []);
  assert.equal(newerThanStored(list, {}).length, 4);
});
