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
