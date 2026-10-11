// The fast format first, the strict one on doubt (apply-latency B, lib/ai/fast-first.js): only the page-kind question goes fast; a confident valid answer is
// kept, an unsure, invalid or failed one is asked again strictly; other engines and every other question ask strictly once. The fast client drops
// --json-schema, and the e2e model-call cache keys the two formats apart without changing any existing key. Fake clients only.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ACCEPT, fastFirst, isPageKind} from '../lib/ai/fast-first.js';
import {memoKey} from '../lib/ai/model-memo.js';
import {ClaudeCode} from '../lib/ai/claude-code-cli.js';
import {SCHEMA as PAGE_KIND} from '../lib/ladder/rung2-sketch.js';

const asks = schema => ({model: 'claude-haiku-5-5', max_tokens: 10, messages: [{role: 'user', content: 'sketch'}], output_config: {format: {type: 'json_schema', schema}}});
const reply = value => ({content: [{type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value)}], stop_reason: 'end_turn'});
function clients(fastValue, {engine = 'cli', fails = false} = {}) {
  const calls = [];
  const fast = {engine, messages: {create: async () => { calls.push('fast'); if (fails) throw new Error('down'); return reply(fastValue); }}};
  const strict = {engine, messages: {create: async () => { calls.push('strict'); return reply({kind: 'form', confidence: 0.95}); }}};
  return {calls, client: fastFirst({fast, strict})};
}

test('page kind: a confident valid fast answer is kept; unsure, invalid or failed is asked again strictly', async () => {
  for (const [value, options, want] of [[{kind: 'posting', confidence: ACCEPT}, {}, ['fast']], [{kind: 'posting', confidence: 0.6}, {}, ['fast', 'strict']],
    ['not json', {}, ['fast', 'strict']], [{}, {fails: true}, ['fast', 'strict']],
    [{kind: 'other', confidence: 0.95, bot_check: true}, {}, ['fast', 'strict']]]) {   // a bot check is always confirmed strictly
    const {calls, client} = clients(value, options);
    await client.messages.create(asks(PAGE_KIND));
    assert.deepEqual(calls, want, JSON.stringify(value));
  }
});

test('every other question, and every engine but Claude Code, asks strictly once', async () => {
  const judge = {type: 'object', properties: {answer: {type: 'string'}, confidence: {type: 'number'}}};
  const {calls, client} = clients({answer: 'ready', confidence: 0.99});
  await client.messages.create(asks(judge));
  assert.deepEqual(calls, ['strict']);
  assert.equal(isPageKind(asks(PAGE_KIND)), true);
  const api = clients({kind: 'form', confidence: 0.99}, {engine: 'api'});
  await api.client.messages.create(asks(PAGE_KIND));
  assert.deepEqual(api.calls, ['strict']);
});

test('the fast client states the schema in the prompt (no --json-schema) and is cached apart; the strict keys are unchanged', async () => {
  const run = (bin, args, opts, done) => done(null, '--output-format --model --tools --json-schema --permission-mode', '');
  let seen = null;
  const spawnFn = (bin, args) => { seen = args; const ev = {on: (e, f) => e === 'close' && setImmediate(() => f(0))}; return {...ev, stdout: {on: (e, f) => e === 'data' && f(JSON.stringify({type: 'result', result: '{"kind":"form","confidence":0.9}', usage: {}}))}, stderr: {on: () => {}}, stdin: {on: () => {}, end: () => {}}, kill: () => {}}; };
  await new ClaudeCode({binary: '/fake/claude-fast', run, spawnFn, schemaInPrompt: true, log: () => {}}).messages.create(asks({type: 'object', properties: {kind: {type: 'string'}, confidence: {type: 'number'}}, required: ['kind']}));
  assert.equal(seen.includes('--json-schema'), false);
  assert.equal(new ClaudeCode({schemaInPrompt: true}).memoTag, 'schema-in-prompt');
  assert.equal(new ClaudeCode({}).memoTag, '');
  const params = asks(PAGE_KIND);
  assert.equal(memoKey(params, ''), memoKey(params), 'no tag: the key every recorded answer already has');
  assert.notEqual(memoKey(params, 'schema-in-prompt'), memoKey(params));
});
