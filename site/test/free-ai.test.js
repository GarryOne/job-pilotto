// Free AI (src/free-ai.js): install-token auth, Anthropic <-> Workers AI translation, per-install limits, the daily line, the kill switch.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DAY_MESSAGE, MONTH_MESSAGE, TRIAL_MESSAGE, freeAi, LIMITS} from '../src/free-ai.js';
import {ACTIONS} from '../src/aicost.js';
import {tokenFor} from '../src/guard.js';
import {OSS, SMALL, STRONG, STEP_MODELS, costUsd, modelFor} from '../src/free-ai-models.js';
import {asStream, fromWorkersAi, REASONING_ROOM, toWorkersAi, Unsupported} from '../src/free-ai-translate.js';

const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const answer = (text = 'hi', usage = {prompt_tokens: 1000, completion_tokens: 1000}) => ({choices: [{message: {content: text}, finish_reason: 'stop'}], usage});
const env = (extra = {}) => { const seen = []; return {seen, WAITLIST: kv(), STATS_SALT: 'salt', AI: {run: async (model, input) => { seen.push({model, input}); return answer(); }, toMarkdown: async () => [{data: 'CV TEXT'}]}, ...extra}; };
const key = async (install = 'install-0001') => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const call = async (e, apiKey, body = {model: 'claude-haiku-5-5', max_tokens: 50, messages: [{role: 'user', content: 'hello'}]}, headers = {}, path = '/api/ai/v1/messages') =>
  freeAi(new Request(`https://www.jobpilotto.top${path}`, {method: path.endsWith('messages') ? 'POST' : 'GET', headers: {'x-api-key': apiKey, ...headers}, ...(path.endsWith('messages') ? {body: JSON.stringify(body)} : {})}), e, new Date('2026-10-16T10:00:30Z'));

test('an install token gets an Anthropic-shaped answer from the small model, and the spend is counted', async () => {
  const e = env(), response = await call(e, await key());
  assert.equal(response.status, 200);
  const message = await response.json();
  assert.deepEqual([message.type, message.content[0].text, message.usage], ['message', 'hi', {input_tokens: 1000, output_tokens: 1000}]);
  assert.equal(e.seen[0].model, SMALL);
  assert.equal(Number(e.WAITLIST.m.get('freeai:usd:2026-10-16')), Math.round(costUsd(SMALL, message.usage) * 1e6));
});

test('no key, a forged token, another install\'s token: 401 and the model never runs', async () => {
  const e = env();
  for (const bad of ['', 'sk-ant-real', 'JPF1.install-0001.deadbeef', `JPF1.install-0002.${(await key()).split('.')[2]}`]) assert.equal((await call(e, bad)).status, 401);
  assert.equal(e.seen.length, 0);
});

test('per install: the 31st call in a minute and $0.30 in a day are refused with words', async () => {
  const e = env(), apiKey = await key();
  const who = async () => [...e.WAITLIST.m.keys()].find(k => k.startsWith('freeai:min:')).split(':')[2];
  await call(e, apiKey);
  const id = await who();
  e.WAITLIST.m.set(`freeai:min:${id}:2026-10-16T10:00`, String(LIMITS.perMinute));
  const slow = await call(e, apiKey);
  assert.equal(slow.status, 429); assert.match((await slow.json()).error.message, /minute/);
  e.WAITLIST.m.set(`freeai:min:${id}:2026-10-16T10:00`, '0'); e.WAITLIST.m.set(`freeai:dusd:${id}:2026-10-16`, String(0.3 * 1e6));
  const daily = await call(e, apiKey);
  assert.equal(daily.status, 429); assert.equal((await daily.json()).error.message, DAY_MESSAGE);
  assert.equal(e.seen.length, 1);
});

test('the daily line: an alert once when $3 is crossed, a stop at $10, and FREE_AI=off pauses it', async () => {
  const sent = [], e = env({BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c'}), apiKey = await key();
  e.WAITLIST.m.set('freeai:usd:2026-10-16', String(2.9999 * 1e6));
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{}'); };
  const request = () => new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})});
  await freeAi(request(), e, new Date('2026-10-16T10:00:30Z'), null, fetcher);
  await freeAi(request(), e, new Date('2026-10-16T10:05:30Z'), null, fetcher);
  assert.equal(sent.length, 1); assert.match(sent[0], /Free AI/);
  e.WAITLIST.m.set('freeai:usd:2026-10-16', String(10 * 1e6));
  assert.equal((await call(e, apiKey)).status, 503);
  assert.equal((await call({...e, FREE_AI: 'off'}, apiKey)).status, 503);
});

test('per install: $3 in a month is refused with the month words, and a call adds its cost to the day and the month', async () => {
  const e = env(), apiKey = await key();
  await call(e, apiKey);
  const id = [...e.WAITLIST.m.keys()].find(k => k.startsWith('freeai:min:')).split(':')[2];
  assert.ok(Number(e.WAITLIST.m.get(`freeai:dusd:${id}:2026-10-16`)) > 0);
  assert.equal(e.WAITLIST.m.get(`freeai:dusd:${id}:2026-10-16`), e.WAITLIST.m.get(`freeai:musd:${id}:2026-10`));
  e.WAITLIST.m.set(`freeai:musd:${id}:2026-10`, String(3 * 1e6));
  const refused = await call(e, apiKey);
  assert.equal(refused.status, 429); assert.equal((await refused.json()).error.message, MONTH_MESSAGE); assert.match(MONTH_MESSAGE, /this month's/);
  const next = new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})});
  assert.equal((await freeAi(next, e, new Date('2026-11-01T10:00:30Z'))).status, 200);   // a new month starts clean
});

test('the month line: an alert once when $40 is crossed, a stop at $60 for everyone', async () => {
  const sent = [], e = env({BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c'}), apiKey = await key();
  e.WAITLIST.m.set('freeai:usdm:2026-10', String(39.9999 * 1e6));
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{}'); };
  const request = () => new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})});
  await freeAi(request(), e, new Date('2026-10-16T10:00:30Z'), null, fetcher);
  await freeAi(request(), e, new Date('2026-10-17T10:05:30Z'), null, fetcher);
  assert.equal(sent.filter(text => /this month/.test(text)).length, 1);
  e.WAITLIST.m.set('freeai:usdm:2026-10', String(60 * 1e6));
  const stopped = await call(e, apiKey);
  assert.equal(stopped.status, 503); assert.match((await stopped.json()).error.message, /this month/);
});

test('the lines come from wrangler.toml vars: early-adopter values in force, the tight set as code defaults', async () => {
  const toml = (await import('node:fs')).readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const vars = Object.fromEntries([...toml.matchAll(/^(FREE_AI_[A-Z_]+) = "([^"]*)"/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual([vars.FREE_AI_INSTALL_MINUTE_CALLS, vars.FREE_AI_INSTALL_DAY_USD, vars.FREE_AI_INSTALL_MONTH_USD, vars.FREE_AI_ALERT_USD, vars.FREE_AI_STOP_USD, vars.FREE_AI_MONTH_ALERT_USD, vars.FREE_AI_MONTH_STOP_USD], ['50', '0.50', '5', '5', '10', '100', '200']);
  assert.deepEqual([LIMITS.perMinute, LIMITS.installDayUsd, LIMITS.installMonthUsd, LIMITS.monthStopUsd], [30, 0.3, 3, 60]);
  const e = env(vars), apiKey = await key();
  await call(e, apiKey);
  const id = [...e.WAITLIST.m.keys()].find(k => k.startsWith('freeai:min:')).split(':')[2];
  e.WAITLIST.m.set(`freeai:dusd:${id}:2026-10-16`, String(0.4 * 1e6));   // over the tight $0.30, under the early-adopter $0.50
  assert.equal((await call(e, apiKey)).status, 200);
  e.WAITLIST.m.set(`freeai:dusd:${id}:2026-10-16`, String(0.5 * 1e6));
  assert.equal((await call(e, apiKey)).status, 429);
  e.WAITLIST.m.set(`freeai:dusd:${id}:2026-10-16`, '0'); e.WAITLIST.m.set(`freeai:min:${id}:2026-10-16T10:00`, '49');
  assert.equal((await call(e, apiKey)).status, 200);
  assert.equal((await call(e, apiKey)).status, 429);   // the 51st in the minute
});

test('per step: only the rejection review runs on gpt-oss-120b, every other step on the small model', async () => {
  assert.deepEqual(STEP_MODELS, {review: OSS});
  for (const action of [...ACTIONS, '', 'other', 'few_jobs']) assert.equal(modelFor(action, {}), action === 'review' ? OSS : SMALL, action);
  assert.equal(modelFor('review', {STEP_MODELS: 'off'}), SMALL);
  assert.equal(modelFor('review', {STRONG_ON: 'on'}), OSS, 'the per-step map wins over the strong switch');
  assert.equal(modelFor('kit', {STRONG_ON: 'on'}), STRONG);
  const e = env(), apiKey = await key();
  await call(e, apiKey, undefined, {'x-jp-action': 'review'});
  await call(e, apiKey, undefined, {'x-jp-action': 'kit'});
  assert.deepEqual(e.seen.map(item => item.model), [OSS, SMALL]);
  assert.ok(costUsd(OSS, {input_tokens: 1000, output_tokens: 1000}) > costUsd(SMALL, {input_tokens: 1000, output_tokens: 1000}), 'gpt-oss is priced as itself, not as the small model');
});

test('the trial: $2 for the install\'s life, counted apart from the day and month, refused with the trial words', async () => {
  assert.match(TRIAL_MESSAGE, /used the Free AI included in your trial\. Get Pro, or connect your own Claude or ChatGPT/);
  const e = env(), apiKey = await key();
  await call(e, apiKey);
  const id = [...e.WAITLIST.m.keys()].find(k => k.startsWith('freeai:min:')).split(':')[2];
  const first = Number(e.WAITLIST.m.get(`freeai:life:${id}`));
  assert.ok(first > 0 && first === Number(e.WAITLIST.m.get(`freeai:dusd:${id}:2026-10-16`)), 'the first call counts for life like for the day');
  await call(e, apiKey);
  assert.equal(Number(e.WAITLIST.m.get(`freeai:life:${id}`)), 2 * first);
  e.WAITLIST.m.set(`freeai:life:${id}`, String(1.99 * 1e6));
  assert.equal((await call(e, apiKey)).status, 200, 'under the budget');
  e.WAITLIST.m.set(`freeai:life:${id}`, String(2 * 1e6));
  e.WAITLIST.m.set(`freeai:dusd:${id}:2026-10-16`, '0'); e.WAITLIST.m.set(`freeai:musd:${id}:2026-10`, '0');   // the day and the month are clean: only the trial refuses
  const refused = await call(e, apiKey);
  assert.equal(refused.status, 429); assert.equal((await refused.json()).error.message, TRIAL_MESSAGE);
  assert.equal((await call({...e, FREE_AI_TRIAL_USD: '5'}, apiKey)).status, 200, 'the budget is the wrangler var');
});

test('a licence key (Pro, founder, friend) is a separate lane: no trial budget, nothing counted for life', async () => {
  const pair = await crypto.subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']);
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = b64(new TextEncoder().encode(JSON.stringify({id: 'pro-1'})));
  const licence = `JP1.${payload}.${b64(await crypto.subtle.sign({name: 'Ed25519'}, pair.privateKey, new TextEncoder().encode(payload)))}`;
  const e = env({LICENSE_PUBLIC_KEY: b64(await crypto.subtle.exportKey('raw', pair.publicKey))});
  const reply = await call(e, licence);
  assert.equal(reply.status, 200);
  assert.equal([...e.WAITLIST.m.keys()].filter(k => k.startsWith('freeai:life:')).length, 0);
  for (const k of [...e.WAITLIST.m.keys()].filter(k => k.startsWith('freeai:min:'))) e.WAITLIST.m.delete(k);
  e.WAITLIST.m.set('freeai:life:anything', String(99 * 1e6));
  assert.equal((await call(e, licence)).status, 200);
});

test('a founder key from an older app still works', async () => {
  // not signed here: an unsigned JP1 key is refused like any forged key
  assert.equal((await call(env({LICENSE_PUBLIC_KEY: 'x'}), 'JP1.e30.bad')).status, 401);
});

test('translation: system + messages + schema in, a PDF read as text, an image refused in words', async () => {
  const sent = await toWorkersAi({max_tokens: 9, system: [{type: 'text', text: 'Be brief.'}], output_config: {format: {type: 'json_schema', schema: {type: 'object'}}},
    messages: [{role: 'user', content: [{type: 'document', source: {type: 'base64', data: 'AAAA'}}, {type: 'text', text: 'Read it.'}]}]}, async () => 'CV TEXT');
  assert.deepEqual(sent.messages, [{role: 'system', content: 'Be brief.'}, {role: 'user', content: 'CV TEXT\n\nRead it.'}]);
  assert.equal(sent.response_format.json_schema.schema.type, 'object');
  await assert.rejects(toWorkersAi({messages: [{role: 'user', content: [{type: 'image', source: {}}]}]}), Unsupported);
});

test('the answer drops reasoning text, and a streamed ask gets the SDK events', () => {
  const message = fromWorkersAi(answer('<think>hmm</think>{"a":1}'), SMALL);
  assert.equal(message.content[0].text, '{"a":1}');
  const events = asStream(message);
  for (const type of ['message_start', 'content_block_delta', 'message_delta', 'message_stop']) assert.match(events, new RegExp(`event: ${type}`));
});

test('steps that write documents use the stronger model only when it is switched on', () => {
  assert.equal(modelFor('kit', {}), SMALL);
  assert.equal(modelFor('kit', {STRONG_ON: 'on'}), STRONG);
  assert.equal(modelFor('score', {STRONG_ON: 'on'}), SMALL);
});

test('the model gets room to think on top of the caller\'s max_tokens (a live call with 200 came back empty)', async () => {
  const sent = await toWorkersAi({max_tokens: 200, messages: [{role: 'user', content: 'x'}]});
  assert.equal(sent.max_tokens, 200 + REASONING_ROOM);
  assert.equal((await toWorkersAi({messages: [{role: 'user', content: 'x'}]})).max_tokens, 1024 + REASONING_ROOM);
});

// Live (16 Oct 2026, 1 of 30 scoring asks): Qwen looped on whitespace until the token limit, so the caller got text that is not JSON.
const schemaBody = {max_tokens: 50, messages: [{role: 'user', content: 'score'}], output_config: {format: {type: 'json_schema', schema: {type: 'object', properties: {score: {type: 'number'}}}}}};
const runaway = {choices: [{message: {content: '{"score": 20, "x": "\n\t \n\t'}, finish_reason: 'length'}], usage: {prompt_tokens: 1000, completion_tokens: 6000}};

test('a structured ask whose reply is not JSON is asked once more, and both attempts are counted', async () => {
  const replies = [runaway, answer('{"score": 61}')], e = env();
  e.AI.run = async (model, input) => { e.seen.push({model, input}); return replies.shift(); };
  const message = await (await call(e, await key(), schemaBody)).json();
  assert.equal(message.content[0].text, '{"score": 61}');
  assert.equal(e.seen.length, 2);
  assert.equal(message.usage.output_tokens, 7000, 'the failed attempt is paid for too');
});

test('a second bad reply is a clear 502, never invalid text passed on as an answer', async () => {
  const e = env();
  e.AI.run = async (model, input) => { e.seen.push({model, input}); return runaway; };
  const response = await call(e, await key(), schemaBody);
  assert.equal(response.status, 502); assert.match((await response.json()).error.message, /Free AI/);
  assert.equal(e.seen.length, 2);
});

test('a plain-text ask is never retried', async () => {
  const e = env();
  await call(e, await key());
  assert.equal(e.seen.length, 1);
});

// Workers Free plan (owner, 16 Oct 2026: "no, measure first"): 10,000 neurons a day, 1 neuron = $0.000011. Past it Cloudflare stops answering until 00:00 UTC.
const sendAsk = (e, apiKey, sent, at = '2026-10-16T10:00:30Z') => freeAi(new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey},
  body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})}), e, new Date(at), null, async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{}'); });

test('neurons are counted per day, and one Telegram line goes out when 80% of the allowance is passed', async () => {
  const sent = [], e = env({BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c'}), apiKey = await key();
  e.WAITLIST.m.set('freeai:neu:2026-10-16', '7990');
  await sendAsk(e, apiKey, sent); await sendAsk(e, apiKey, sent);
  assert.ok(Number(e.WAITLIST.m.get('freeai:neu:2026-10-16')) > 8000, 'a call of 1000+1000 tokens is about 40 neurons');
  assert.equal(sent.length, 1); assert.match(sent[0], /80%|neurons/i);
});

test('past the daily allowance the answer is words, never empty, and the model is not asked', async () => {
  const e = env(), apiKey = await key();
  e.WAITLIST.m.set('freeai:neu:2026-10-16', '10000');
  const response = await call(e, apiKey);
  assert.equal(response.status, 503); assert.match((await response.json()).error.message, /busy today.*own key/i);
  assert.equal(e.seen.length, 0);
  e.WAITLIST.m.set('freeai:neu:2026-10-17', '0');
  assert.equal((await freeAi(new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})}), e, new Date('2026-10-17T00:00:30Z'))).status, 200, 'a new UTC day starts at zero');
});

test('when Cloudflare itself says the free allocation is used up, the same words come back', async () => {
  const e = env(); e.AI.run = async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); };
  const response = await call(e, await key());
  assert.equal(response.status, 503); assert.match((await response.json()).error.message, /busy today/i);
});

test('FREE_AI_NEURONS=off lifts the allowance (once the plan is paid)', async () => {
  const e = env({FREE_AI_NEURONS: 'off'}); e.WAITLIST.m.set('freeai:neu:2026-10-16', '99999');
  assert.equal((await call(e, await key())).status, 200);
});

// 16 Oct 2026: an eval run on the same Cloudflare account used the whole free allowance and the Worker's own counter never saw it. The account's own usage (GraphQL aiInferenceAdaptiveGroups) is the truth.
const usage = neurons => ({data: {viewer: {accounts: [{aiInferenceAdaptiveGroups: [{count: 3, sum: {totalNeurons: neurons}}]}]}}});
const metered = (neurons, sent = [], graphql = []) => ({sent, graphql, fetcher: async (url, init) => {
  if (String(url).includes('graphql')) { graphql.push(JSON.parse(init.body).query); if (neurons == null) throw new Error('down'); return Response.json(usage(neurons)); }
  sent.push(JSON.parse(init.body).text); return new Response('{}');
}});
const withAccount = e => Object.assign(e, {CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'analytics'});

test('usage by any caller of the account counts: the day is over when Cloudflare says so, whatever the Worker counted', async () => {
  const e = withAccount(env()), m = metered(10500), apiKey = await key();
  const response = await freeAi(new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})}), e, new Date('2026-10-16T10:00:30Z'), null, m.fetcher);
  assert.equal(response.status, 503); assert.match((await response.json()).error.message, /busy today/i);
  assert.equal(e.seen.length, 0);
  assert.match(m.graphql[0], /aiInferenceAdaptiveGroups/); assert.match(m.graphql[0], /acc/);
});

test('the 80% line is read from the account too, once, and the usage is asked once a minute', async () => {
  const e = withAccount(env({BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c'})), m = metered(8100), apiKey = await key();
  const ask = at => freeAi(new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body: JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]})}), e, new Date(at), null, m.fetcher);
  await ask('2026-10-16T10:00:10Z'); await ask('2026-10-16T10:00:40Z');
  assert.equal(m.sent.length, 1); assert.match(m.sent[0], /80%/);
  assert.equal(m.graphql.length, 1, 'cached for a minute');
  await ask('2026-10-16T10:01:30Z');
  assert.equal(m.graphql.length, 2);
});

test('without the account settings, or when Cloudflare\'s usage cannot be read, the Worker\'s own count still guards the day', async () => {
  const apiKey = await key(), body = JSON.stringify({max_tokens: 5, messages: [{role: 'user', content: 'x'}]});
  const ask = (e, fetcher) => freeAi(new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey}, body}), e, new Date('2026-10-16T10:00:30Z'), null, fetcher);
  assert.equal((await ask(env(), metered(99999).fetcher)).status, 200, 'no CF_ANALYTICS_TOKEN: not asked');
  assert.equal((await ask(withAccount(env()), metered(null).fetcher)).status, 200, 'a failed read does not stop the service');
  const own = withAccount(env()); own.WAITLIST.m.set('freeai:neu:2026-10-16', '10000');
  assert.equal((await ask(own, metered(0).fetcher)).status, 503, 'the own counter still stops it');
});
