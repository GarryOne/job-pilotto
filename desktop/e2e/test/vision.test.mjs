// The AI review's answer is only trusted in a fixed shape; a stable fingerprint keeps one problem from becoming a PR every night.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SYSTEM, buildRequest, fingerprint, parseFindings} from '../lib/vision.mjs';

test('only well-formed findings survive, with the page they were found on', () => {
  const reply = 'Here you go: ' + JSON.stringify({findings: [
    {severity: 'high', kind: 'layout', title: 'Location cell 20 lines tall', detail: 'The Jobs row is 700px tall.', suggestion: 'Show two places and a count.'},
    {severity: 'urgent', kind: 'layout', title: 'bad severity', detail: 'x'},
    {severity: 'low', kind: 'taste', title: 'bad kind', detail: 'x'},
    {severity: 'low', kind: 'text', title: '', detail: 'empty title'},
    {severity: 'low', kind: 'layout', title: 'Tight spacing', detail: 'A few pixels.'},
    'junk', null]});
  const out = parseFindings(reply, 'jobs');
  assert.deepEqual(out.map(item => [item.view, item.severity, item.kind, item.title]), [['jobs', 'medium', 'layout', 'Location cell 20 lines tall'], ['jobs', 'low', 'layout', 'Tight spacing']]);   // a layout finding is high only with a stated workaround
  const wrong = parseFindings(JSON.stringify({findings: [{severity: 'high', kind: 'functionality', title: 'Save does nothing', detail: 'x'}, {severity: 'high', kind: 'error-shown', title: 'A stack trace', detail: 'y'}, {severity: 'high', kind: 'text', title: 'Vague warning', detail: 'z'}]}), 'jobs');
  assert.deepEqual(wrong.map(item => item.severity), ['high', 'high', 'medium'], 'only a wrong app can block a journey');
  const costly = parseFindings(JSON.stringify({findings: [{severity: 'high', kind: 'text', title: 'Two clocks', detail: 'x', workaround: 'They must compare both times and guess which is right, every time they open a run.'}, {severity: 'high', kind: 'text', title: 'Vague', detail: 'y', workaround: 'ok'}]}), 'jobs');
  assert.deepEqual(costly.map(item => item.severity), ['high', 'medium'], 'very bad UX is high only when it says what the person must do and why it costs them');
  assert.deepEqual(parseFindings('no json at all', 'jobs'), []);
  assert.deepEqual(parseFindings('{"findings": "nope"}', 'jobs'), []);
});

test('the request carries the picture, the page and the expectations, on Sonnet by default (interpreting a screenshot is where a cheap model cries wolf)', () => {
  const request = buildRequest({view: 'jobs', pngBase64: 'AAAA', rules: 'rule one'});
  assert.equal(request.model, 'claude-sonnet-5-5');
  assert.equal(request.messages[0].content[0].source.data, 'AAAA');
  assert.match(request.messages[0].content[1].text, /Page: jobs[\s\S]*Expected to show:/);
  assert.match(request.system.at(-1).text, /design rules[\s\S]*rule one/);
});

test('the fixed part (instructions + design rules) comes first and is cached; what changes per page comes after it', () => {
  const a = buildRequest({view: 'jobs', pngBase64: 'AAAA', rules: 'rule one', facts: {x: 1}});
  const b = buildRequest({view: 'settings', pngBase64: 'BBBB', rules: 'rule one'});
  assert.deepEqual(a.system, b.system, 'the cached prefix must be byte-identical across pages, or nothing is ever read from the cache');
  assert.deepEqual(a.system.at(-1).cache_control, {type: 'ephemeral'});
  assert.equal(a.system.filter(block => block.cache_control).length, 1);
  assert.equal(JSON.stringify(a.messages).includes('rule one'), false, 'the rules are not sent twice');
  assert.deepEqual(buildRequest({view: 'jobs', pngBase64: 'AAAA'}).system.at(-1).cache_control, {type: 'ephemeral'}, 'no rules: the instructions alone are cached');
});

test('a review\'s cost comes from the API\'s own usage figures: input, cache write 1.25x, cache read 0.1x, output; an unknown model is not guessed', async () => {
  const {usageCost} = await import('../lib/vision.mjs');
  const usd = usageCost('claude-sonnet-5-5', {input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000, output_tokens: 500});
  assert.ok(Math.abs(usd - (1000 * 2 + 2000 * 2.5 + 10000 * 0.2 + 500 * 10) / 1e6) < 1e-12, String(usd));
  assert.equal(usageCost('claude-sonnet-5-5', {}), 0);
  assert.equal(usageCost('some-new-model', {input_tokens: 1}), null);
});

test('the same problem has the same fingerprint, a different one does not', () => {
  const a = {view: 'jobs', kind: 'layout', title: 'Location cell 20 lines tall'};
  assert.equal(fingerprint(a), fingerprint({...a, title: 'location cell, 20 lines tall!'}));
  assert.notEqual(fingerprint(a), fingerprint({...a, view: 'settings'}));
});

test('the reviewer is given the app\'s own facts and told to look for contradictions and misleading states, on any screenshot it finds', async () => {
  const {SYSTEM, expectedFor} = await import('../lib/vision.mjs');
  const request = buildRequest({view: 'settings-connections-cli-chosen', pngBase64: 'AAAA', facts: {aiEngineChosen: 'cli', anthropicKeySaved: true}});
  assert.match(request.messages[0].content[1].text, /FACTS about the app's state[\s\S]*"aiEngineChosen": "cli"[\s\S]*"anthropicKeySaved": true/);
  assert.match(SYSTEM, /CONTRADICTS the facts|CONTRADICT/);
  assert.match(SYSTEM, /MISLEAD/);
  assert.match(expectedFor('settings-connections-cli-chosen'), /"connections-cli-chosen" part of Settings/);
  assert.equal(buildRequest({view: 'jobs', pngBase64: 'AAAA'}).messages[0].content[1].text.includes('FACTS'), false, 'no facts, no facts block');
});

test('the request never carries a temperature: claude-sonnet-5-5 rejects it with a 400 (the nightly review did nothing for days because of it)', () => {
  const request = buildRequest({view: 'jobs', pngBase64: 'AAAA'});
  assert.equal('temperature' in request, false);
  assert.equal(request.model, 'claude-sonnet-5-5');
});

test('the activity suite\'s screenshots of failure and queued states are judged against what the Actions page and its panel should show', async () => {
  const {expectedFor} = await import('../lib/vision.mjs');
  for (const view of ['activity-run-failed', 'activity-run-warned', 'activity-limit-paused', 'activity-queued']) assert.match(expectedFor(view), /Recent activity panel/);
});

test('the review is told to report every defect separately and to look at the sidebar and the bottom bar; a failure screenshot has its own expectation', async () => {
  const {SYSTEM, expectedFor} = await import('../lib/vision.mjs');
  assert.match(SYSTEM, /EVERY defect[\s\S]*its own finding/);
  assert.match(SYSTEM, /sidebar[\s\S]*bar along the bottom/);
  assert.match(expectedFor('failure-screenshot'), /sidebar and the bottom bar/);
});

// #98 (a toast over the header, "hides Refresh": invented) and #100 ("Gmail not connected" vs a follow-up built from logged events: a guess about the app's insides), 3 Oct 2026.
test('the review is told that transient UI and guesses about the app\'s insides are not findings', () => {
  assert.match(SYSTEM, /Do NOT report transient interface: a toast or notification/);
  assert.match(SYSTEM, /Do NOT report a guess about how the app works inside/);
  assert.match(SYSTEM, /A contradiction needs proof: two things you can SEE disagree, or the picture disagrees with a stated FACT/);
  assert.match(SYSTEM, /When you only suspect, say nothing/);
  assert.match(SYSTEM, /A picture freezes motion: a line that scrolls in a frame \(a ticker or marquee\)/, '#97: a scrolling tip ticker caught mid-scroll was reported as clipped text');
});
