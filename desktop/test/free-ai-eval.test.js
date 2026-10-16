// The Free AI quality tool (tools/free-ai-eval.mjs): validity, rank metrics, the table, and a run against the mock backend.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountOf, evaluate, mock, rest} from '../../tools/free-ai-eval.mjs';
import {schemaProblems, spearman, summarize, table, topOverlap} from '../../tools/free-ai-eval-metrics.mjs';
import {SMALL, STRONG} from '../../site/src/free-ai-models.js';

const schema = {type: 'object', required: ['score', 'tier'], properties: {score: {type: 'integer'}, tier: {type: 'string', enum: ['A', 'B', 'C']}, tags: {type: 'array', items: {type: 'string'}}}};
const cases = Array.from({length: 8}, (_, i) => ({id: `job-${i}`, baseline: 10 + i * 10, params: {max_tokens: 100, output_config: {format: {type: 'json_schema', schema}},
  messages: [{role: 'user', content: `Posting [case job-${i}]`}]}}));

test('schemaProblems names what is wrong: a missing key, a wrong type, a value outside the enum, a bad list item', () => {
  assert.deepEqual(schemaProblems({score: 80, tier: 'B', tags: ['a']}, schema), []);
  assert.deepEqual(schemaProblems({score: '80', tier: 'Z', tags: [1]}, schema).length, 3);
  assert.deepEqual(schemaProblems({score: 80}, schema), ['$.tier: missing']);
});

test('spearman and top overlap: the same order is 1, the reverse is -1, a different top set shows', () => {
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-9);
  assert.equal(spearman([1, 2], [1, 2]), null);   // too few pairs to say
  assert.equal(topOverlap({a: 9, b: 8, c: 1}, {a: 9, c: 8, b: 1}, 2), 0.5);
});

test('a run on the mock backend gives a full row: valid, in schema, ranked like the baseline, costed', async () => {
  const results = await evaluate(cases, SMALL, mock(cases));
  const row = summarize(SMALL, results, {k: 3});
  assert.deepEqual([row.cases, row.validJsonPct], [8, 100]);
  assert.equal(row.schemaPct, 100);
  assert.ok(row.spearman >= 0.99 && row.topOverlap === 100, `the mock follows the baseline: ${row.spearman} ${row.topOverlap}`);
  assert.ok(row.tokensIn === 8 * 1500 && row.tokensOut === 8 * 200);
});

test('an answer that is not JSON, or an error from the backend, is a failed row, not a crash', async () => {
  const broken = async () => ({choices: [{message: {content: 'Sorry, here is some text'}}], usage: {prompt_tokens: 10, completion_tokens: 5}});
  const [row] = await evaluate(cases.slice(0, 1), SMALL, broken);
  assert.deepEqual([row.valid, row.schemaOk], [false, false]);
  const [down] = await evaluate(cases.slice(0, 1), SMALL, async () => { throw new Error('Workers AI 503'); });
  assert.match(down.error, /503/);
});

test('the table has one row per model with the rank columns, and says n/a without a baseline', () => {
  const rows = [summarize(SMALL, await0(), {k: 3}), summarize(STRONG, [], {k: 3})];
  const text = table(rows, {[SMALL]: 0.0123});
  assert.match(text, /\| @cf\/qwen\/qwen3-30b-a3b-fp8 \| 1 \|/);
  assert.match(text, /\$0\.0123/);
  assert.match(text, /n\/a/);
  function await0() { return [{id: 'x', valid: true, schemaOk: true, score: 50, baseline: undefined, usage: {}, ms: 5}]; }
});

test('the REST backend posts the model and the Anthropic-translated input to the account\'s chat route with the bearer token', async () => {
  const seen = [];
  const run = rest({account: 'acc1', token: 'tok', fetcher: async (url, init) => { seen.push({url, init}); return Response.json({choices: []}); }});
  await run(SMALL, {messages: [{role: 'user', content: 'hi'}]});
  assert.equal(seen[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc1/ai/v1/chat/completions');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  assert.equal(JSON.parse(seen[0].init.body).model, SMALL);
  const failing = rest({account: 'a', token: 't', fetcher: async () => new Response('no', {status: 401})});
  await assert.rejects(failing(SMALL, {}), /401/);
});

test('the account id is found from the token when it sees exactly one account', async () => {
  const one = async () => Response.json({result: [{id: 'acc9'}]}), two = async () => Response.json({result: [{id: 'a'}, {id: 'b'}]}), bad = async () => new Response('x', {status: 403});
  assert.equal(await accountOf('t', one), 'acc9');
  assert.equal(await accountOf('t', two), '', 'two accounts: ask for CF_ACCOUNT_ID, never guess');
  assert.equal(await accountOf('t', bad), '');
});
