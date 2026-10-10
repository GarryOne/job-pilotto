// The free AI credit (src/trial.js): only owner-signed keys, forwarded with the trial key, counted per key and month.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {costUsd, trial} from '../src/trial.js';

const b64 = bytes => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']);
const publicKey = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
async function licenseKey(payload) {
  const body = b64(new TextEncoder().encode(JSON.stringify(payload)));
  return `JP1.${body}.${b64(await crypto.subtle.sign({name: 'Ed25519'}, pair.privateKey, new TextEncoder().encode(body)))}`;
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const env = () => ({ANTHROPIC_TRIAL_KEY: 'sk-trial', WAITLIST: kv(), LICENSE_PUBLIC_KEY: publicKey, TRIAL_PER_KEY_USD: '1', TRIAL_MONTH_USD: '20'});
const call = (e, key, body = {model: 'claude-haiku-4-5', max_tokens: 10, messages: []}, fetcher, path = '/api/ai/v1/messages') =>
  trial(new Request(`https://www.jobpilotto.top${path}`, {method: path.endsWith('messages') ? 'POST' : 'GET',
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01'}, ...(path.endsWith('messages') ? {body: JSON.stringify(body)} : {})}), e, fetcher);
const anthropic = (usage = {input_tokens: 1000, output_tokens: 1000}, seen = []) => async (url, init) => {
  seen.push({url, key: init.headers['x-api-key']});
  return Response.json({model: 'claude-haiku-4-5', usage, content: [{type: 'text', text: 'hi'}]});
};

test('a signed key is forwarded with the trial key and its cost is counted', async () => {
  const e = env(), seen = [];
  const key = await licenseKey({id: 'aaaa1111', name: 'Ana', kind: 'founder'});
  const response = await call(e, key, undefined, anthropic(undefined, seen));
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{url: 'https://api.anthropic.com/v1/messages', key: 'sk-trial'}]);
  assert.ok(Number(e.WAITLIST.m.get('trial:key:aaaa1111')) > 0);  // 1000 in + 1000 out on Haiku = 0.6 cents
  const credit = await (await call(e, key, undefined, null, '/api/ai/credit')).json();
  assert.equal(credit.limitUsd, 1);
  assert.ok(credit.usedUsd > 0 && credit.usedUsd < 0.01);
});

test('no key, a forged key or an expired key: 401, nothing forwarded', async () => {
  const seen = [];
  const other = await crypto.subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']);
  const body = b64(new TextEncoder().encode(JSON.stringify({id: 'x1', name: 'X', kind: 'founder'})));
  const forged = `JP1.${body}.${b64(await crypto.subtle.sign({name: 'Ed25519'}, other.privateKey, new TextEncoder().encode(body)))}`;
  for (const key of ['', 'sk-ant-real', forged, await licenseKey({id: 'old1', name: 'O', kind: 'friend', until: '2020-01-01'})]) {
    assert.equal((await call(env(), key, undefined, anthropic(undefined, seen))).status, 401);
  }
  assert.equal(seen.length, 0);
});

test('$1 used up, or the monthly cap reached: 402 with what to do', async () => {
  const key = await licenseKey({id: 'bbbb2222', name: 'Bo', kind: 'friend'});
  const spent = env(); spent.WAITLIST.m.set('trial:key:bbbb2222', '100');
  const r1 = await call(spent, key, undefined, anthropic());
  assert.equal(r1.status, 402);
  assert.match((await r1.json()).error.message, /own Anthropic key/);
  const capped = env(); capped.WAITLIST.m.set(`trial:month:${new Date().toISOString().slice(0, 7)}`, '2000');
  assert.equal((await call(capped, key, undefined, anthropic())).status, 402);
});

// A streamed answer (the strategy draft) passes through event by event and is charged from its message_start + message_delta usage.
test('a streamed answer passes through unchanged and its cost is counted', async () => {
  const e = env();
  const key = await licenseKey({id: 'cccc3333', name: 'Cy', kind: 'friend'});
  const events = [
    {type: 'message_start', message: {model: 'claude-sonnet-5-5', usage: {input_tokens: 10000, output_tokens: 1}}},
    {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '{"a":'}},
    {type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 2000}},
    {type: 'message_stop'},
  ];
  const sse = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(sse);
  const fetcher = async () => new Response(new ReadableStream({start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); }}),
    {headers: {'content-type': 'text/event-stream; charset=utf-8'}});
  const response = await call(e, key, {model: 'claude-sonnet-5-5', stream: true, max_tokens: 10, messages: []}, fetcher);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /event-stream/);
  assert.equal(await response.text(), sse);
  // 10k in at $2/M + 2k out at $10/M = $0.04 = 4 cents
  assert.equal(Number(e.WAITLIST.m.get('trial:key:cccc3333')), 4);
});

test('cost: list prices; unknown models charged like the priciest', () => {
  assert.equal(costUsd('claude-haiku-4-5', {input_tokens: 1e6, output_tokens: 0}), 1);
  assert.equal(costUsd('claude-sonnet-5-20260101', {input_tokens: 0, output_tokens: 1e6}), 10);
  assert.equal(costUsd('claude-sonnet-5-5', {input_tokens: 1e6, output_tokens: 0}), 2);   // Sonnet 5.5: $2 / $10
  assert.equal(costUsd('claude-opus-5-5', {input_tokens: 1e6, output_tokens: 0}), 4);     // Opus 5.5: $4 / $20
  assert.equal(costUsd('mystery', {input_tokens: 1e6}), 15);
});
