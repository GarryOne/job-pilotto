// The e2e's AI meter and replay cache (lib/ai-meter.mjs): what a suite pays is counted from the API's usage, and a request seen before is answered free.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {count, priceName, requestKey, resetUsage, usage, usageOf, writeUsage} from '../lib/ai-meter.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {modelFetch} from '../lib/model.mjs';

const answer = {id: 'msg_1', type: 'message', model: 'claude-haiku-4-5-20251001', content: [{type: 'text', text: 'ok'}], usage: {input_tokens: 1000000, output_tokens: 100000}};

test('a dated model id is priced as its alias, and the usage is read from a JSON answer or a stream', () => {
  assert.equal(priceName('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.deepEqual(usageOf(JSON.stringify(answer)), {model: answer.model, usage: answer.usage});
  const stream = ['event: message_start', `data: ${JSON.stringify({type: 'message_start', message: {model: 'claude-sonnet-5-5', usage: {input_tokens: 10, output_tokens: 1}}})}`,
    'event: message_delta', `data: ${JSON.stringify({type: 'message_delta', usage: {output_tokens: 42}})}`].join('\n');
  assert.deepEqual(usageOf(stream, 'text/event-stream'), {model: 'claude-sonnet-5-5', usage: {input_tokens: 10, output_tokens: 42}});
  assert.equal(usageOf('not json'), null);
});

test('a call is costed from its usage; an unknown model is counted but never priced', () => {
  resetUsage();
  count('app', usageOf(JSON.stringify(answer)));   // 1M in at $1 + 0.1M out at $5 = $1.50
  count('app', {model: 'some-new-model', usage: {input_tokens: 5}});
  assert.equal(usage().app.calls, 2);
  assert.equal(usage().app.unpriced, 1);
  assert.ok(Math.abs(usage().app.usd - 1.5) < 1e-9);
});

test('the request key ignores metadata but not the prompt', () => {
  const a = Buffer.from(JSON.stringify({model: 'm', messages: [{role: 'user', content: 'hi'}], metadata: {user_id: '1'}}));
  const b = Buffer.from(JSON.stringify({model: 'm', messages: [{role: 'user', content: 'hi'}], metadata: {user_id: '2'}}));
  const c = Buffer.from(JSON.stringify({model: 'm', messages: [{role: 'user', content: 'hello'}]}));
  assert.equal(requestKey('/v1/messages', a), requestKey('/v1/messages', b));
  assert.notEqual(requestKey('/v1/messages', a), requestKey('/v1/messages', c));
});

async function fakeAnthropic() {
  const seen = {calls: 0};
  const server = http.createServer((req, res) => { seen.calls++; req.resume(); req.on('end', () => { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(answer)); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(resolve => server.close(resolve))};
}

test('the proxy pays and keeps a new request, and with replay on answers the same request from the cache without calling the model', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cache-')), upstream = await fakeAnthropic();
  const saved = {cache: process.env.E2E_AI_CACHE, replay: process.env.E2E_AI_REPLAY};
  t.after(async () => { await upstream.close(); process.env.E2E_AI_CACHE = saved.cache ?? ''; process.env.E2E_AI_REPLAY = saved.replay ?? ''; fs.rmSync(dir, {recursive: true, force: true}); });
  process.env.E2E_AI_CACHE = dir; process.env.E2E_AI_REPLAY = '';
  resetUsage();
  const proxy = await startAiProxy({target: upstream.url});
  const ask = () => fetch(`${proxy.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model: 'claude-haiku-4-5', messages: [{role: 'user', content: 'score this'}]})}).then(r => r.json());
  assert.equal((await ask()).content[0].text, 'ok');
  assert.equal(upstream.seen.calls, 1, 'the first call reached the model');   // positive control: the fake upstream was really used
  assert.equal(usage().app.calls, 1);
  assert.equal(fs.readdirSync(dir).length, 1, 'the paid answer was kept');
  process.env.E2E_AI_REPLAY = '1';
  assert.equal((await ask()).content[0].text, 'ok');
  assert.equal(upstream.seen.calls, 1, 'the replayed call never reached the model');
  assert.equal(usage().app.replayed, 1);
  assert.ok(usage().app.saved > 1.49);
  await proxy.close();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-'));
  writeUsage(out);
  const written = JSON.parse(fs.readFileSync(path.join(out, 'ai-usage-app.json'), 'utf8'));
  assert.equal(written.calls, 1);
  assert.ok(Math.abs(written.usd - 1.5) < 1e-6);
  assert.ok(!fs.existsSync(path.join(out, 'ai-usage-judges.json')), 'no judge calls, no judges file');
});

test('a failure mode is never kept nor replayed', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cache-'));
  const saved = process.env.E2E_AI_CACHE;
  t.after(() => { process.env.E2E_AI_CACHE = saved ?? ''; fs.rmSync(dir, {recursive: true, force: true}); });
  process.env.E2E_AI_CACHE = dir;
  const proxy = await startAiProxy({target: 'http://127.0.0.1:9'});
  proxy.setMode('rate-limit');
  const response = await fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}'});
  assert.equal(response.status, 429);
  await proxy.close();
  assert.equal(fs.readdirSync(dir).length, 0);
});

test('a judge call on the API engine is counted as the judges\' spend', async t => {
  const upstream = await fakeAnthropic();
  t.after(() => upstream.close());
  resetUsage();
  const response = await modelFetch(`${upstream.url}/v1/messages`, {method: 'POST', body: '{}'}, {engine: () => 'api'});
  assert.equal((await response.json()).content[0].text, 'ok', 'the caller still reads the whole answer');
  assert.equal(usage().judges.calls, 1);
  assert.equal(usage().app.calls, 0);
});

test('per-key cost: each key\'s tokens at the day\'s billed price per token; only tracked keys, by name', async () => {
  const {keyDays} = await import('../ai-cost-report.mjs');
  const usage = [
    {day: '2026-10-05', api_key_id: 'a', model: 'claude-haiku-4-5-20251001', service_tier: 'standard', uncached_input_tokens: 1e6, output_tokens: 1e5},
    {day: '2026-10-05', api_key_id: 'b', model: 'claude-haiku-4-5-20251001', service_tier: 'standard', uncached_input_tokens: 3e6, output_tokens: 3e5},
    {day: '2026-10-05', api_key_id: 'c', model: 'claude-sonnet-5-5', service_tier: 'batch', cache_creation: {ephemeral_1h_input_tokens: 1e6}},
  ];
  // the bill: Haiku input $8 for 4M tokens ($2/M), output $2 for 0.4M; Sonnet batch has no 1 h line -> list price, 2 x $2/M
  const lines = [{day: '2026-10-05', model: 'claude-haiku-4-5-20251001', service_tier: 'standard', token_type: 'uncached_input_tokens', amount: '800'},
    {day: '2026-10-05', model: 'claude-haiku-4-5-20251001', service_tier: 'standard', token_type: 'output_tokens', amount: '200'}];
  const rows = keyDays(usage, {a: 'job-pilotto-e2e-testing', b: 'sre-job-watch', c: 'job-pilotto-in-house-credit'}, lines, ['job-pilotto-e2e-testing', 'job-pilotto-in-house-credit']);
  assert.deepEqual(rows.sort((x, y) => x.key.localeCompare(y.key)), [{day: '2026-10-05', key: 'job-pilotto-e2e-testing', usd: 2.5}, {day: '2026-10-05', key: 'job-pilotto-in-house-credit', usd: 4}]);
});

test('a refused call is recorded with the API\'s status, type and message', async t => {
  const {apiErrors, resetUsage: reset, writeUsage: write} = await import('../lib/ai-meter.mjs');
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(400, {'content-type': 'application/json'}); res.end(JSON.stringify({type: 'error', error: {type: 'invalid_request_error', message: 'You have reached your specified API usage limits.'}})); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  reset();
  const proxy = await startAiProxy({target: `http://127.0.0.1:${server.address().port}`});
  assert.equal((await fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}'})).status, 400);
  await proxy.close();
  assert.deepEqual(apiErrors(), {'400 invalid_request_error: You have reached your specified API usage limits.': 1});
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-err-'));
  write(out);
  assert.ok(fs.existsSync(path.join(out, 'ai-errors.json')));
});

// 7 Oct 2026: interactions paid most of its app calls in every gate on the fixed path; a miss is now kept in the suite's artifacts to compare runs.
test('a request replay cannot answer is kept in the artifacts, without its metadata; not when not replaying', async () => {
  const {keepMiss} = await import('../lib/ai-meter.mjs');
  const fsMod = await import('node:fs'), osMod = await import('node:os'), pathMod = await import('node:path');
  const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'miss-'));
  const body = Buffer.from(JSON.stringify({model: 'm', messages: [{role: 'user', content: 'hi'}], metadata: {user_id: 'x'}}));
  keepMiss('k1', '/v1/messages', body, {E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir, E2E_ARTIFACTS: dir});
  const kept = JSON.parse(fsMod.readFileSync(pathMod.join(dir, 'ai-misses', 'k1.json'), 'utf8'));
  assert.deepEqual(kept, {url: '/v1/messages', request: {model: 'm', messages: [{role: 'user', content: 'hi'}]}});
  keepMiss('k2', '/v1/messages', body, {E2E_AI_REPLAY: '0', E2E_AI_CACHE: dir, E2E_ARTIFACTS: dir});
  assert.equal(fsMod.existsSync(pathMod.join(dir, 'ai-misses', 'k2.json')), false, 'a live run (no replay) keeps nothing');
});

// 7 Oct 2026 (owner): a replayed answer never aged, so a change in the model's behaviour would never reach the suites. Kept answers now expire after 3 days.
test('a kept answer is replayed for 3 days, then asked live again; an undated one is asked again', async () => {
  const {keep, recall} = await import('../lib/ai-meter.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  const env = {E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir};
  keep('fresh', {status: 200, contentType: 'application/json', body: Buffer.from('{"ok":1}')}, env);
  assert.equal(recall('fresh', env)?.body.toString(), '{"ok":1}', 'positive control: a new answer is replayed');
  const saved = Date.parse(JSON.parse(fs.readFileSync(path.join(dir, 'fresh.json'), 'utf8')).savedAt);
  assert.ok(recall('fresh', env, saved + 2.9 * 86400000), 'still replayed on day 3');
  assert.equal(recall('fresh', env, saved + 3.1 * 86400000), null, 'asked live after 3 days');
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({status: 200, contentType: 'application/json', body: Buffer.from('{}').toString('base64')}));
  assert.equal(recall('old', env), null, 'an answer kept before the rule (no date) is asked again once');
});
