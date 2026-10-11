// Guards lib/replay-browser.mjs without a browser: which case a request belongs to, and that two cases on one host never run at once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {caseForRequest, nextRunnable} from '../lib/replay-browser.mjs';

const item = (name, ...hosts) => ({name, pages: hosts.map(host => ({url: `https://${host}/p`}))});

test('a request is the case whose host its url names; with no url, the first live case that answers the route', () => {
  const live = [{hosts: ['a.example'], answer: {}}, {hosts: ['b.example'], answer: {'/extension/page-kind': () => ({})}}];
  assert.equal(caseForRequest(live, '/extension/page-kind', JSON.stringify({url: 'https://a.example/x'})), live[0]);
  assert.equal(caseForRequest(live, '/extension/page-kind', JSON.stringify({url: 'https://b.example/x'})), live[1]);
  assert.equal(caseForRequest(live, '/extension/page-kind', '{}'), live[1]);
  assert.equal(caseForRequest(live, '/extension/other', '{}'), undefined);
});

test('a case whose host is running waits; the next free one goes first', () => {
  const queue = [item('one', 'a.example'), item('two', 'a.example', 'c.example'), item('three', 'd.example')];
  assert.equal(nextRunnable(queue, new Set()), 0);
  assert.equal(nextRunnable(queue, new Set(['a.example'])), 2);
  assert.equal(nextRunnable(queue, new Set(['a.example', 'd.example'])), -1);
});
