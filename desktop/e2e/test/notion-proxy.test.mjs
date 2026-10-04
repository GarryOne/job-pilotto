// The Notion stand-in fails exactly as planned: a number of calls, only writes, or every call; and passes through otherwise.
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import {decide, isWrite, startNotionProxy} from '../lib/notion-proxy.mjs';

test('a query is a read; a page change is a write', () => {
  assert.equal(isWrite('POST', '/v1/databases/abc/query'), false);
  assert.equal(isWrite('POST', '/v1/search'), false);
  assert.equal(isWrite('PATCH', '/v1/pages/abc'), true);
  assert.equal(isWrite('POST', '/v1/pages'), true);
});

test('the plan: N failures then pass; only writes; every call', () => {
  const plan = {mode: 'rate-limit', times: 2};
  assert.deepEqual([1, 2, 3].map(() => decide(plan, 'GET', '/v1/pages/x')), ['rate-limit', 'rate-limit', 'pass']);
  const writes = {mode: 'html', writes: true};
  assert.equal(decide(writes, 'POST', '/v1/databases/x/query'), 'pass');
  assert.equal(decide(writes, 'PATCH', '/v1/pages/x'), 'html');
  assert.equal(decide({mode: 'server-error'}, 'GET', '/v1/x'), 'server-error');
});

test('the server answers an HTML page, a 429 with retry-after, refuses a connection, and passes through', async () => {
  const notion = http.createServer((req, res) => { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({object: 'page', path: req.url})); });
  await new Promise(done => notion.listen(0, '127.0.0.1', done));
  const proxy = await startNotionProxy({target: `http://127.0.0.1:${notion.address().port}`});
  try {
    const get = () => fetch(`${proxy.url}/v1/pages/x`);
    assert.equal((await (await get()).json()).path, '/v1/pages/x');
    proxy.fail('html', {times: 1});
    const html = await get();
    assert.equal(html.status, 502);
    assert.match(await html.text(), /<!DOCTYPE html>/);
    proxy.fail('rate-limit', {times: 1});
    const busy = await get();
    assert.equal(busy.status, 429);
    assert.equal(busy.headers.get('retry-after'), '1');
    proxy.fail('offline');
    await assert.rejects(get());
    proxy.pass();
    assert.equal((await get()).status, 200);
    assert.equal(proxy.stats.failed, 3);
  } finally { await proxy.close(); notion.close(); }
});
