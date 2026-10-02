// The AI review's answer is only trusted in a fixed shape; a stable fingerprint keeps one problem from becoming a PR every night.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRequest, fingerprint, parseFindings} from '../lib/vision.mjs';

test('only well-formed findings survive, with the page they were found on', () => {
  const reply = 'Here you go: ' + JSON.stringify({findings: [
    {severity: 'high', kind: 'layout', title: 'Location cell 20 lines tall', detail: 'The Jobs row is 700px tall.', suggestion: 'Show two places and a count.'},
    {severity: 'urgent', kind: 'layout', title: 'bad severity', detail: 'x'},
    {severity: 'low', kind: 'taste', title: 'bad kind', detail: 'x'},
    {severity: 'low', kind: 'text', title: '', detail: 'empty title'},
    'junk', null]});
  const out = parseFindings(reply, 'jobs');
  assert.deepEqual(out.map(item => [item.view, item.severity, item.kind, item.title]), [['jobs', 'high', 'layout', 'Location cell 20 lines tall']]);
  assert.deepEqual(parseFindings('no json at all', 'jobs'), []);
  assert.deepEqual(parseFindings('{"findings": "nope"}', 'jobs'), []);
});

test('the request carries the picture, the page and the expectations, on Sonnet by default (interpreting a screenshot is where a cheap model cries wolf)', () => {
  const request = buildRequest({view: 'jobs', pngBase64: 'AAAA', rules: 'rule one'});
  assert.equal(request.model, 'claude-sonnet-5');
  assert.equal(request.messages[0].content[0].source.data, 'AAAA');
  assert.match(request.messages[0].content[1].text, /Page: jobs[\s\S]*Expected to show:[\s\S]*rule one/);
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
