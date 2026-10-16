// The Claude backend of the Free AI quality tool (tools/free-ai-eval-claude.mjs): the user's own subscription through `claude -p`, never an API key, with no tools, MCP servers or skills loaded.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claudeArgs, claudeRun, isClaude} from '../../tools/free-ai-eval-claude.mjs';

const schema = {type: 'object', properties: {score: {type: 'number'}}, required: ['score']};
const input = {messages: [{role: 'system', content: 'SYSTEM TEXT'}, {role: 'user', content: 'POSTING TEXT'}], response_format: {type: 'json_schema', json_schema: {name: 'answer', schema}}, max_tokens: 4000};
const reply = {structured_output: {score: 61}, result: '{"score":61}', is_error: false, usage: {input_tokens: 2, cache_creation_input_tokens: 1150, cache_read_input_tokens: 0, output_tokens: 90}, modelUsage: {'claude-haiku-5-5': {}}};

test('the arguments strip everything but the answer: no tools, no MCP servers, no skills, no saved session, the case\'s own schema and system text', () => {
  const args = claudeArgs('haiku', input);
  for (const flag of ['-p', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands']) assert.ok(args.includes(flag), flag);
  assert.deepEqual([args[args.indexOf('--model') + 1], args[args.indexOf('--tools') + 1], args[args.indexOf('--system-prompt') + 1]], ['haiku', '', 'SYSTEM TEXT']);
  assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]), schema);
  assert.ok(!args.includes('POSTING TEXT'), 'the posting goes in on stdin, not in the arguments');
});

test('a call runs from an empty folder with the API key removed, and answers in the shape the tool reads', async () => {
  const seen = [];
  const run = claudeRun({exec: async (file, args, options) => { seen.push({file, args, options}); return JSON.stringify(reply); }, env: {ANTHROPIC_API_KEY: 'sk-secret', PATH: '/bin'}, cwd: '/empty'});
  const answer = await run('claude:haiku', input);
  assert.equal(seen[0].file, 'claude'); assert.equal(seen[0].options.cwd, '/empty'); assert.equal(seen[0].options.stdin, 'POSTING TEXT');
  assert.ok(!('ANTHROPIC_API_KEY' in seen[0].options.env) && seen[0].options.env.PATH === '/bin');
  assert.equal(answer.choices[0].message.content, '{"score":61}'); assert.equal(answer.choices[0].finish_reason, 'stop');
  assert.deepEqual(answer.usage, {prompt_tokens: 1152, completion_tokens: 90}); assert.equal(answer.model, 'claude-haiku-5-5');
});

test('an error reply or a process failure is an error for that case, not an empty answer; only claude: names are Claude', async () => {
  const bad = claudeRun({exec: async () => JSON.stringify({...reply, structured_output: undefined, is_error: true, result: 'rate limited'}), env: {}, cwd: '/e'});
  await assert.rejects(bad('claude:opus', input), /rate limited/);
  const dead = claudeRun({exec: async () => { throw new Error('claude exited 1'); }, env: {}, cwd: '/e'});
  await assert.rejects(dead('claude:opus', input), /exited 1/);
  assert.ok(isClaude('claude:sonnet') && !isClaude('@cf/qwen/qwen3-30b-a3b-fp8'));
});
