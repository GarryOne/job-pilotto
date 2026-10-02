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

test('the request carries the picture, the page and the expectations, on a cheap model by default', () => {
  const request = buildRequest({view: 'jobs', pngBase64: 'AAAA', rules: 'rule one'});
  assert.equal(request.model, 'claude-haiku-4-5');
  assert.equal(request.messages[0].content[0].source.data, 'AAAA');
  assert.match(request.messages[0].content[1].text, /Page: jobs[\s\S]*Expected to show:[\s\S]*rule one/);
});

test('the same problem has the same fingerprint, a different one does not', () => {
  const a = {view: 'jobs', kind: 'layout', title: 'Location cell 20 lines tall'};
  assert.equal(fingerprint(a), fingerprint({...a, title: 'location cell, 20 lines tall!'}));
  assert.notEqual(fingerprint(a), fingerprint({...a, view: 'settings'}));
});
