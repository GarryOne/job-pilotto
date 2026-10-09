// The AI engine contract (lib/ai/): every adapter answers the same request with the same response shape, refuses what the contract does
// not carry, and turns its provider's failures into the contract's errors. Recorded answers only: fake SDKs and a fake process spawner,
// no network, no key, no real Claude Code or Codex. Also: no `new Anthropic` outside lib/ai/anthropic-api.js, and the price table the
// Worker keeps (worker/src/ai.js) equals the app's.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {AiError, AiLimit, AiUnavailable, requestFrom} from '../lib/ai/contract.js';
import {AnthropicApi} from '../lib/ai/anthropic-api.js';
import {ClaudeCode} from '../lib/ai/claude-code-cli.js';
import {Codex, OFF, SHELL} from '../lib/ai/codex-cli.js';
import {OpenAiApi, body} from '../lib/ai/openai-api.js';
import * as ai from '../lib/ai/index.js';
import {OPENAI_PRICES, model, openaiModel, priceOf} from '../lib/ai/models.js';
import {dropNulls, strict} from '../lib/ai/schema.js';
import * as claudeCode from '../lib/claude-code.js';
import * as worker from '../../worker/src/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = {type: 'object', required: ['summary'], properties: {summary: {type: 'string'}, note: {type: 'string'}}};
const PDF = {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF fake').toString('base64')}};
const PNG = {type: 'image', source: {type: 'base64', media_type: 'image/png', data: Buffer.from('png').toString('base64')}};
const params = (extra = {}) => ({model: 'claude-sonnet-5-5', max_tokens: 500, system: [{type: 'text', text: 'Be brief.', cache_control: {type: 'ephemeral'}}],
  messages: [{role: 'user', content: [PDF, PNG, {type: 'text', text: 'Summarise.'}]}], output_config: {format: {type: 'json_schema', schema: SCHEMA}}, ...extra});

// A spawned process that answers from respond({args, prompt, cwd, files}) -> {stdout, stderr, code}; every call is kept.
function fakeSpawn(respond) {
  const calls = [];
  const spawnFn = (binary, args, {cwd}) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    child.stdin = {on: () => {}, end: prompt => setImmediate(() => {
      const call = {binary, args, prompt, cwd, files: fs.readdirSync(cwd).sort(),
        schema: args.includes('--output-schema') ? JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8')) : null};
      calls.push(call);
      const {stdout = '', stderr = '', code = 0} = respond(call, calls.length);
      child.stdout.emit('data', stdout); child.stderr.emit('data', stderr); child.emit('close', code);
    })};
    return child;
  };
  return {spawnFn, calls};
}
const claudeFlags = (binary, args, options, callback) => callback(null, '--output-format --model --tools --allowedTools --permission-mode --json-schema --no-session-persistence');
const codexFeatures = (binary, args, options, callback) => callback(null, `${SHELL}  stable  true\nplugins  stable  true\nhooks  beta  false\nsomething_new  beta  false\n`);
const codexEvents = (text, usage = {input_tokens: 120, cached_input_tokens: 20, output_tokens: 8}) =>
  [{type: 'thread.started'}, {type: 'turn.started'}, {type: 'item.completed', item: {type: 'agent_message', text}}, {type: 'turn.completed', usage}]
    .map(event => JSON.stringify(event)).join('\n');

// The four engines, each answering {"summary":"done"} the way its provider does.
function engines() {
  const anthropicSdk = {messages: {create: async sent => ({id: 'm', type: 'message', model: sent.model, stop_reason: 'end_turn',
    content: [{type: 'text', text: '{"summary":"done"}'}], usage: {input_tokens: 100, output_tokens: 8}, sent})}};
  const openaiSdk = {sent: [], responses: {create: async sent => { openaiSdk.sent.push(sent); return {model: sent.model, status: 'completed',
    output: [{type: 'message', content: [{type: 'output_text', text: '{"summary":"done","note":null}'}]}], output_text: '{"summary":"done","note":null}',
    usage: {input_tokens: 120, input_tokens_details: {cached_tokens: 20}, output_tokens: 8}}; }}};
  const claude = fakeSpawn(() => ({stdout: JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: '',
    structured_output: {summary: 'done'}, usage: {input_tokens: 100, output_tokens: 8}})}));
  const codex = fakeSpawn(() => ({stdout: codexEvents('{"summary":"done","note":null}')}));
  return {
    api: {adapter: new AnthropicApi({sdk: anthropicSdk}), billing: 'api', provider: 'anthropic'},
    cli: {adapter: new ClaudeCode({binary: '/fake/claude', spawnFn: claude.spawnFn, run: claudeFlags}), billing: 'subscription', provider: 'anthropic', calls: claude.calls},
    openai: {adapter: new OpenAiApi({sdk: openaiSdk, env: {}, action: 'cv'}), billing: 'api', provider: 'openai', sent: openaiSdk.sent},
    codex: {adapter: new Codex({binary: '/fake/codex', spawnFn: codex.spawnFn, run: codexFeatures, env: {}}), billing: 'subscription', provider: 'openai', calls: codex.calls},
  };
}

test('every engine: the same request, the same response shape, structured answer in the caller\'s shape, usage billed right', async () => {
  const all = engines();
  assert.deepEqual(Object.keys(all).sort(), [...ai.NAMES].sort());   // a new engine must be added here
  for (const [name, {adapter, billing, provider}] of Object.entries(all)) {
    assert.equal(adapter.engine, name);
    assert.equal(adapter.family, ai.ENGINES[name].family);
    const answer = await adapter.messages.create(params());
    assert.equal(answer.content[0].type, 'text', name);
    assert.deepEqual(JSON.parse(answer.content[0].text), {summary: 'done'}, `${name}: the null for "note" is dropped`);
    assert.equal(answer.stop_reason, 'end_turn', name);
    assert.equal(answer.usage.billing, billing, name);
    assert.equal(answer.usage.provider, provider, name);
    assert.ok(Number.isInteger(answer.usage.input_tokens) && Number.isInteger(answer.usage.output_tokens), name);
    await assert.rejects(adapter.messages.create({...params(), temperature: 0.2}), /not part of the AI contract.*temperature/, `${name}: unknown params throw`);
    await assert.rejects(adapter.messages.create({...params(), tools: [{type: 'bash'}]}), /only the web search tool/, name);
  }
});

test('OpenAI API: the Responses body, cached tokens, refusal, cut-off, and errors as the contract\'s', async () => {
  const {openai} = engines();
  await openai.adapter.messages.create(params());
  const [sent] = openai.sent;
  assert.equal(sent.model, 'gpt-6.1-sol');   // sonnet -> main tier
  assert.equal(sent.instructions, 'Be brief.');
  assert.equal(sent.store, false);
  assert.equal(sent.prompt_cache_key, 'job-pilotto-cv');
  assert.deepEqual(sent.input[0].content.map(part => part.type), ['input_file', 'input_image', 'input_text']);
  assert.match(sent.input[0].content[0].file_data, /^data:application\/pdf;base64,/);
  assert.deepEqual(sent.text.format.schema, strict(SCHEMA));
  assert.deepEqual(sent.text.format.schema.required, ['summary', 'note']);
  assert.equal(sent.text.format.schema.additionalProperties, false);
  assert.ok(sent.max_output_tokens > 500);   // headroom for reasoning
  const big = body(requestFrom({model: 'claude-opus-5-5', max_tokens: 10, messages: [{role: 'user', content: 'x'}], tools: [{type: 'web_search_20250305', max_uses: 3}]}), {env: {}});
  assert.deepEqual(big.reasoning, {effort: 'high'});
  assert.deepEqual(big.tools, [{type: 'web_search'}]);
  assert.equal(big.max_tool_calls, 3);
  const answering = output => new OpenAiApi({env: {}, sdk: {responses: {create: async () => output}}});
  const ask = {model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]};
  const refused = await answering({status: 'completed', output: [{type: 'message', content: [{type: 'refusal', refusal: 'No.'}]}]}).messages.create(ask);
  assert.equal(refused.stop_reason, 'refusal');
  const cut = await answering({status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}, output_text: 'par'}).messages.create(ask);
  assert.equal(cut.stop_reason, 'max_tokens');
  const used = await answering({status: 'completed', model: 'gpt-6-luna', output_text: 'ok', usage: {input_tokens: 100, input_tokens_details: {cached_tokens: 40}, output_tokens: 5}}).messages.create(ask);
  assert.deepEqual([used.usage.input_tokens, used.usage.cache_read_input_tokens, used.usage.model], [60, 40, 'gpt-6-luna']);
  const failing = error => new OpenAiApi({env: {}, sdk: {responses: {create: async () => { throw error; }}}}).messages.create(ask);
  await assert.rejects(failing(Object.assign(new Error('bad key'), {status: 401})), error => error instanceof AiLimit && error.final);
  await assert.rejects(failing(Object.assign(new Error('quota'), {status: 429, code: 'insufficient_quota'})), error => error instanceof AiLimit && /spend limit/.test(error.message));
  await assert.rejects(failing(Object.assign(new Error('slow down'), {status: 429})), AiUnavailable);
  await assert.rejects(failing(Object.assign(new Error('boom'), {status: 503})), AiUnavailable);
  await assert.rejects(failing(new Error('socket hang up')), AiUnavailable);
  await assert.rejects(failing(Object.assign(new Error('bad request'), {status: 400})), error => error instanceof AiError && !(error instanceof AiLimit));
  await assert.rejects(new OpenAiApi({env: {}}).messages.create(ask), error => error instanceof AiLimit && /OpenAI API key/.test(error.message));
});

test('Codex: its own folder, read-only, user config off, unneeded tools off, strict schema file, images by -i, PDFs read from the folder', async () => {
  const {codex} = engines();
  await codex.adapter.messages.create(params());
  const [call] = codex.calls;
  const flag = name => call.args[call.args.indexOf(name) + 1];
  assert.deepEqual(call.args.slice(0, 5), ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s']);
  assert.equal(flag('-s'), 'read-only');
  assert.equal(flag('-C'), call.cwd);
  assert.ok(call.args.includes('--ignore-user-config') && call.args.includes('--ignore-rules'));
  assert.equal(flag('-m'), 'gpt-6.1-sol');
  assert.ok(call.args.includes('plugins') && !call.args.includes('something_new'));   // only features this Codex lists, only from OFF
  assert.ok(OFF.includes('plugins'));
  assert.ok(!call.args.some((arg, i) => arg === SHELL && call.args[i - 1] === '--disable'), 'the shell stays on to read the PDF');
  assert.ok(call.args.includes('web_search="disabled"'));
  assert.deepEqual(call.schema, strict(SCHEMA));
  assert.ok(call.files.includes('document-1.pdf') && call.files.includes('image-2.png'));
  assert.equal(flag('-i'), path.join(call.cwd, 'image-2.png'));
  assert.equal(call.args.at(-1), '-');
  assert.match(call.prompt, /^Be brief\.\n\n---\n\nFirst read each attached PDF file in this folder: \.\/document-1\.pdf/);
  assert.ok(!fs.existsSync(call.cwd), 'the call folder is removed');
  // Text only: the shell is off too.
  const text = engines().codex;
  await text.adapter.messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]});
  const [plain] = text.calls;
  assert.ok(plain.args.some((arg, i) => arg === SHELL && plain.args[i - 1] === '--disable'));
  assert.equal(plain.args[plain.args.indexOf('-m') + 1], 'gpt-6-luna');
});

test('the CLI engines: signed out and plan limit are AiLimit; a bad structured answer is repaired once; codex env drops the keys', async () => {
  const failing = stdout => new Codex({binary: '/fake/codex', run: codexFeatures, env: {},
    spawnFn: fakeSpawn(() => ({stdout, code: 1})).spawnFn}).messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]});
  await assert.rejects(failing(JSON.stringify({type: 'error', message: 'Not logged in. Run codex login'})), error => error instanceof AiLimit && error.kind === 'signed-out' && error.final);
  await assert.rejects(failing(JSON.stringify({type: 'turn.failed', error: {message: 'You\'ve hit your usage limit'}})), error => error instanceof AiLimit && error.kind === 'limit' && !error.final);
  await assert.rejects(failing('garbage'), error => error instanceof AiError && error.kind === 'failed');
  await assert.rejects(new Codex({binary: ''}).messages.create({model: 'm', messages: []}), error => error instanceof AiLimit && error.kind === 'missing');
  const repair = fakeSpawn((call, n) => ({stdout: codexEvents(n === 1 ? 'not json' : '{"summary":"fixed","note":null}')}));
  const fixed = await new Codex({binary: '/fake/codex', run: codexFeatures, env: {}, spawnFn: repair.spawnFn, log: () => {}})
    .messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}], output_config: {format: {type: 'json_schema', schema: SCHEMA}}});
  assert.deepEqual(JSON.parse(fixed.content[0].text), {summary: 'fixed'});
  assert.equal(repair.calls.length, 2);
  assert.equal(fixed.usage.input_tokens, 200);   // both calls counted
  const env = new Codex({env: {PATH: '/bin', OPENAI_API_KEY: 'sk', CODEX_API_KEY: 'c', ANTHROPIC_API_KEY: 'a'}}).env();
  assert.deepEqual(Object.keys(env), ['PATH']);
});

test('fallback: only on the user\'s tick, only within the family, after a plan limit', async () => {
  const limited = fakeSpawn(() => ({stdout: JSON.stringify({type: 'turn.failed', error: {message: 'usage limit reached'}}), code: 1}));
  let fellTo = null;
  const fallback = () => (fellTo = {messages: {create: async () => ({content: [{type: 'text', text: 'from the API'}], usage: {billing: 'api'}})}});
  const codex = new Codex({binary: '/fake/codex', run: codexFeatures, env: {}, spawnFn: limited.spawnFn, fallback, log: () => {}});
  const ask = {model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]};
  assert.equal((await codex.messages.create(ask)).content[0].text, 'from the API');
  assert.ok(codex.fellBack && fellTo);
  await codex.messages.create(ask);
  assert.equal(limited.calls.length, 1, 'the rest of the run goes to the fallback');
  const store = (settings, secrets = {}) => ({settings: () => settings, secret: name => secrets[name] || ''});
  assert.equal(ai.client(store({aiEngine: 'codex'}, {OPENAI_API_KEY: 'sk', ANTHROPIC_API_KEY: 'a'})).fallback, null, 'no tick, no fallback');
  const ticked = ai.client(store({aiEngine: 'codex', aiFallback: true}, {OPENAI_API_KEY: 'sk', ANTHROPIC_API_KEY: 'a'}));
  assert.equal(ticked.fallback().engine, 'openai');
  assert.equal(ai.client(store({aiEngine: 'cli', aiFallback: true}, {ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'sk'})).fallback().engine, 'api');
  assert.equal(ai.client(store({aiEngine: 'codex', aiFallback: true}, {ANTHROPIC_API_KEY: 'a'})).fallback, null, 'never Claude for an OpenAI engine');
});

test('the registry: the choice, readiness, family, Always on, and the factory never switching families', () => {
  const store = (settings, secrets = {}) => ({settings: () => settings, secret: name => secrets[name] || ''});
  assert.equal(ai.chosen({}, {}), null);
  assert.equal(ai.chosen({}, {ANTHROPIC_API_KEY: 'a'}), 'api');
  assert.equal(ai.chosen({aiEngine: 'codex'}, {}), 'codex');
  assert.equal(ai.ready({aiEngine: 'openai'}, {ANTHROPIC_API_KEY: 'a'}), false);
  assert.equal(ai.ready({aiEngine: 'openai'}, {OPENAI_API_KEY: 'sk'}), true);
  assert.equal(ai.ready({aiEngine: 'codex'}, {}), true);
  assert.equal(ai.family({aiEngine: 'codex'}, {}), 'openai');
  assert.equal(ai.family({aiEngine: 'cli'}, {}), 'claude');
  assert.equal(ai.alwaysOnEngine({aiEngine: 'codex'}, {}), 'openai');
  assert.equal(ai.alwaysOnEngine({aiEngine: 'cli'}, {}), 'api');
  assert.equal(ai.client(store({aiEngine: 'openai'}, {ANTHROPIC_API_KEY: 'a'})).engine, 'openai', 'OpenAI chosen without its key: never the Anthropic key');
  assert.equal(ai.client(store({aiEngine: 'api'}, {})), null);
  assert.equal(ai.client(store({aiEngine: 'api'}, {ANTHROPIC_API_KEY: 'a'})).engine, 'api');
  assert.equal(claudeCode.client(store({aiEngine: 'api'}, {ANTHROPIC_API_KEY: 'a'})), null, 'the old callers keep using their key for the API');
  assert.equal(claudeCode.client(store({aiEngine: 'openai'}, {OPENAI_API_KEY: 'sk'})).engine, 'openai');
  assert.equal(claudeCode.aiReady({aiEngine: 'openai'}, true, false), false);
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'openai'}, false, true), {JOB_PILOTTO_AI_ENGINE: 'openai'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'codex', codex: {path: '/x/codex'}, aiFallback: true}, true, true),
    {JOB_PILOTTO_AI_ENGINE: 'codex', JOB_PILOTTO_CODEX_BIN: '/x/codex', JOB_PILOTTO_AI_FALLBACK: 'openai'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'codex', aiFallback: true}, true, false), {JOB_PILOTTO_AI_ENGINE: 'codex'});
});

test('models by tier, env overrides, and one price table in the app and the Worker', () => {
  assert.equal(model('small'), 'claude-haiku-5-5');
  assert.equal(model('small', 'openai', {}), 'gpt-6-luna');
  assert.equal(model('main', 'openai', {JOB_PILOTTO_OPENAI_MAIN_MODEL: 'gpt-x'}), 'gpt-x');
  assert.deepEqual(openaiModel('claude-opus-5-5', null, {}), {model: 'gpt-6.1-sol', effort: 'high'});
  assert.deepEqual(openaiModel('gpt-6-luna', 'low', {}), {model: 'gpt-6-luna', effort: 'low'});
  assert.deepEqual(worker.OPENAI_PRICES, OPENAI_PRICES);
  const claudePrice = {input: 3, output: 15};
  for (const usage of [{provider: 'openai', model: 'gpt-6-luna'}, {provider: 'openai', model: 'unknown'}, {provider: 'anthropic'}, {}]) {
    assert.deepEqual(worker.priceOf(usage, claudePrice), priceOf(usage, claudePrice));
  }
  assert.deepEqual(priceOf({provider: 'openai', model: 'gpt-6-luna'}, claudePrice), OPENAI_PRICES['gpt-6-luna']);
  assert.deepEqual(priceOf({provider: 'anthropic'}, claudePrice), claudePrice);
  assert.deepEqual(dropNulls({summary: 'a', note: null}, SCHEMA), {summary: 'a'});
});

test('no `new Anthropic` outside lib/ai/anthropic-api.js: every app AI call goes through the one factory', () => {
  const roots = ['lib', 'renderer', 'main.js'].map(name => path.join(here, '..', name));
  const files = roots.flatMap(function walk(file) {
    if (fs.statSync(file).isDirectory()) return fs.readdirSync(file).flatMap(name => walk(path.join(file, name)));
    return /\.(m?js|cjs)$/.test(file) ? [file] : [];
  });
  const found = files.filter(file => !file.endsWith(path.join('lib', 'ai', 'anthropic-api.js')) && /new Anthropic\s*\(/.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(path.join(here, '..'), file));
  assert.deepEqual(found, []);
});

test('Always on: the OpenAI family runs on GitHub as the OpenAI API engine with its key; Claude stays the default (variable removed)', async () => {
  const github = await import('../lib/github.js');
  const payload = (settings, secrets) => github.payload({settings: () => settings, saveSettings: () => {}, readText: () => '', secret: name => secrets[name] || ''});
  const codex = payload({aiEngine: 'codex', codex: {path: '/x/codex'}}, {OPENAI_API_KEY: 'sk-o', NOTION_TOKEN: 'ntn'});
  assert.equal(codex.variables.JOB_PILOTTO_AI_ENGINE, 'openai');
  assert.equal(codex.secrets.OPENAI_API_KEY, 'sk-o');
  assert.ok(!('JOB_PILOTTO_CODEX_BIN' in codex.variables));
  assert.ok(codex.variables.JOB_PILOTTO_SCORE_MODEL, 'the AI steps run: the OpenAI key is there');
  const claude = payload({aiEngine: 'cli'}, {ANTHROPIC_API_KEY: 'sk-a'});
  assert.ok(!('JOB_PILOTTO_AI_ENGINE' in claude.variables));
  assert.ok(claude.removed.includes('JOB_PILOTTO_AI_ENGINE'));
});
