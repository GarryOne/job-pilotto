// The slow/failing AI proxy: each mode answers the way the real API does, and a bad mode name is refused (a typo must not silently pass requests through).
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {FAILURES, failureFor, startAiProxy} from '../lib/ai-proxy.mjs';

const post = url => fetch(`${url}/v1/messages`, {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}});

test('every failure mode is an Anthropic error body with its status', () => {
  for (const [mode, failure] of Object.entries(FAILURES)) {
    const made = failureFor(mode);
    assert.equal(made.status, failure.status);
    const body = JSON.parse(made.body);
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, failure.type);
  }
  assert.equal(failureFor('pass'), null);
  assert.equal(failureFor('hang'), null);
});

test('the no-credit body is worded the way the engine recognises as a spending limit', () => {
  assert.match(JSON.parse(failureFor('no-credit').body).error.message, /credit balance/);
});

test('a proxy in a failure mode answers it without reaching the target, and passes through again afterwards', async () => {
  let reached = 0;
  const target = http.createServer((req, res) => { reached++; res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ok":true}'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const proxy = await startAiProxy({target: `http://127.0.0.1:${target.address().port}`});
  try {
    proxy.setMode('rate-limit');
    const refused = await post(proxy.url);
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).error.type, 'rate_limit_error');
    assert.equal(reached, 0);
    proxy.setMode('pass');
    const answered = await post(proxy.url);
    assert.equal(answered.status, 200);
    assert.equal(reached, 1);
    assert.equal(proxy.stats.calls, 2);
  } finally { await proxy.close(); await new Promise(resolve => target.close(resolve)); }
});

test('an unknown mode is refused', async () => {
  const proxy = await startAiProxy();
  try { assert.throws(() => proxy.setMode('rate_limit'), /unknown proxy mode/); } finally { await proxy.close(); }
});

test('hang never answers', async () => {
  const proxy = await startAiProxy();
  try {
    proxy.setMode('hang');
    const outcome = await Promise.race([post(proxy.url).then(() => 'answered', () => 'closed'), new Promise(resolve => setTimeout(() => resolve('waiting'), 400))]);
    assert.equal(outcome, 'waiting');
  } finally { await proxy.close(); }
});

test('a refusal asks for an almost immediate retry, so the SDK does not back off for seconds in a test', async () => {
  const proxy = await startAiProxy();
  try {
    for (const mode of ['rate-limit', 'server-error']) {
      proxy.setMode(mode);
      const answer = await post(proxy.url);
      assert.equal(answer.headers.get('retry-after-ms'), '10', mode);
    }
  } finally { await proxy.close(); }
});
