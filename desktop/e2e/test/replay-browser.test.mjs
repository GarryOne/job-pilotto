// Guards lib/replay-browser.mjs without a browser: which case a request belongs to, and that two cases on one host never run at once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {caseForRequest, contactForUrl, nextRunnable, openerRoot} from '../lib/replay-browser.mjs';

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

// appPort: the caller's own stand-in app answers (row replay): the helper starts no stub of its own and the extension talks to that port. Opens a browser: opt-in like the recorded pages.
const optIn = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1 (it starts Chromium with the real extension)';
test('an appPort app gets the extension\'s calls and no stub is started', {skip: optIn}, async () => {
  const http = await import('node:http');
  const {freePort} = await import('../lib/extension.mjs');
  const {startReplayBrowser} = await import('../lib/replay-browser.mjs');
  const port = await freePort(), seen = [];
  const app = http.createServer((request, response) => {
    seen.push(request.url.split('?')[0]);
    response.writeHead(200, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json'});
    response.end('{}');
  });
  await new Promise(resolve => app.listen(port, '127.0.0.1', resolve));
  const browser = await startReplayBrowser([], {appPort: port});
  try {
    assert.equal(browser.run.requests.length, 0, 'the helper\'s own stub recorded nothing');
    await browser.run.page.goto('about:blank');
    const deadline = Date.now() + 15000;
    while (!seen.some(url => url.startsWith('/extension/')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(seen.some(url => url.startsWith('/extension/')), `the extension never called the app on port ${port} (saw: ${seen.join(', ')})`);
  } finally { await browser.close(); app.close(); }
});

test('each tab gets the applicant details of its own case: a phone split in pieces, the default for a case with none', () => {
  const live = [{hosts: ['a.example'], item: {contact: {phoneParts: ['+41', '79', '000 00 00']}}}, {hosts: ['b.example'], item: {}}];
  assert.equal(contactForUrl(live, 'https://a.example/apply').phone, '+41 79 000 00 00');
  assert.equal(contactForUrl(live, 'https://a.example/apply').first_name, 'Test');
  assert.equal(contactForUrl(live, 'https://b.example/apply'), null);
  assert.equal(contactForUrl(live, 'https://elsewhere.example/'), null);
  assert.equal(contactForUrl(live, 'not a url'), null);
});

test('a new tab belongs to the case tab at the end of its opener chain; one with no known opener is unplaced', () => {
  const tabA = {}, tabB = {}, popup = {opener: tabA, page: {}}, second = {opener: popup.page, page: {}}, other = {opener: tabB, page: {}}, orphan = {opener: null, page: {}}, notYet = {opener: undefined, page: {}};
  const entries = [popup, second, other, orphan, notYet];
  assert.equal(openerRoot(entries, popup), tabA);
  assert.equal(openerRoot(entries, second), tabA, 'a popup of a popup');
  assert.equal(openerRoot(entries, other), tabB);
  assert.equal(openerRoot(entries, orphan), undefined);
  assert.equal(openerRoot(entries, notYet), undefined);
});
