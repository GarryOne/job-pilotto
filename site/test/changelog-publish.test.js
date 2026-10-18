// tools/changelog-publish.mjs: which releases get an entry (stable, or a beta the gate approved), the draft with a fake model: kinds, floor, hidden versions, and a failed AI answer publishes nothing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {draftEntry, plan} from '../../tools/changelog-publish.mjs';

const release = (version, extra = {}) => ({tagName: `desktop-v${version}`, isPrerelease: true, isDraft: false, publishedAt: '2026-10-18T01:00:00Z', body: '', ...extra});
const approved = {body: 'Beta-approved: abc123'};
const work = {tag: 'desktop-v0.7.20', prev: 'desktop-v0.7.16', version: '0.7.20', date: '2026-10-18', channel: 'beta'};
const model = (...texts) => { const calls = []; return {calls, fetch: async (url, init) => { calls.push(JSON.parse(init.body)); const text = texts.shift(); return new Response(JSON.stringify({content: [{type: 'text', text}], usage: {input_tokens: 1500, output_tokens: 400}, stop_reason: 'end_turn'})); }}; };

test('stable releases and approved betas get an entry; a build that failed its gate does not; its commits roll into the next one', () => {
  const releases = [release('0.7.15', {isPrerelease: false}), release('0.7.16', {isPrerelease: false}), release('0.7.17', approved), release('0.7.18'), release('0.7.19', approved), release('0.7.20', {isDraft: true, ...approved}), {...release('pr-assets-1'), tagName: 'pr-assets-1'}];
  const {draft} = plan(releases, {});
  assert.deepEqual(draft.map(item => [item.version, item.prev, item.channel]), [['0.7.16', 'desktop-v0.7.15', 'stable'], ['0.7.17', 'desktop-v0.7.16', 'beta'], ['0.7.19', 'desktop-v0.7.17', 'beta']]);
});

test('a version is drafted once; a stored beta that became stable is promoted; versions before 0.7.16 and the oldest release (no "since") are skipped', () => {
  const releases = [release('0.7.14', {isPrerelease: false}), release('0.7.16', {isPrerelease: false}), release('0.7.17', {isPrerelease: false}), release('0.7.18', approved)];
  const done = plan(releases, {'0.7.16': 'stable', '0.7.17': 'beta'});
  assert.deepEqual(done.draft.map(item => item.version), ['0.7.18']);
  assert.deepEqual(done.promote, [{version: '0.7.17', channel: 'stable'}]);
  assert.deepEqual(plan(releases, {}).draft.map(item => item.version), ['0.7.16', '0.7.17', '0.7.18']);
});

test('the draft is grouped by kind, rule-breakers are dropped, and the cost is measured', async () => {
  const ai = model(JSON.stringify({groups: [{kind: 'fixes', items: [{emoji: '🐛', lead: 'Dropdowns fixed', text: 'Required dropdowns fill again.'}, {lead: 'Pro', text: 'Pro costs $29.'}]}, {kind: 'features', items: [{emoji: '🔎', lead: 'Better search', text: 'Search shows more jobs.'}]}]}));
  const done = await draftEntry(work, {subjects: ['Fix dropdowns', 'Add search'], key: 'k', fetch: ai.fetch});
  assert.deepEqual(done.entry.groups.map(group => group.kind), ['features', 'fixes']);
  assert.equal(done.dropped.length, 1);
  assert.ok(done.cost > 0 && done.cost < 0.01, `cost ${done.cost}`);
  assert.match(ai.calls[0].messages[0].content, /0\.7\.20 \(changes since 0\.7\.16\)/);
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
