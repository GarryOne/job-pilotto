// The live ladder score asks the model the way the APP does (e2e/lib/ladder-score-path.mjs): the app's own Claude Code adapter, so the effort, the native JSON schema and the model alias are the
// app's, not the scorer's own CLI call. Why: 11 Oct 2026, one Datadog sketch got "posting + frame" 5 of 5 in the scorer and "form" 4 of 4 in the app; the two paths sent different requests.
// A FAKE `claude` (no model, no key, no network): it records the arguments it was started with.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {test} from 'node:test';
import {cliCall} from '../e2e/lib/model.mjs';
import {answerPathNote, scoringClient} from '../e2e/lib/ladder-score-path.mjs';

// A pageKind-shaped request: the small model, low effort, a JSON schema.
const body = {model: 'claude-haiku-5-5', max_tokens: 1000, system: 'You classify one page.', messages: [{role: 'user', content: 'Title: x'}],
  output_config: {format: {type: 'json_schema', schema: {type: 'object', properties: {kind: {type: 'string'}}, required: ['kind']}}, effort: 'low'}};

function fakeClaude() {
  const started = [];
  const run = (binary, args, options, done) => done(null, '--output-format --model --tools --permission-mode --json-schema --effort --no-session-persistence --strict-mcp-config --disable-slash-commands --setting-sources', '');
  const spawnFn = (binary, args) => {
    started.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    setImmediate(() => { child.stdout.end(JSON.stringify({type: 'result', subtype: 'success', result: '', structured_output: {kind: 'posting'}, usage: {input_tokens: 5, output_tokens: 2}})); child.emit('close', 0); });
    return child;
  };
  return {started, run, spawnFn};
}

test('the scorer\'s client sends what the app sends: the alias, the native schema, low effort', async () => {
  const fake = fakeClaude();
  const client = scoringClient({run: fake.run, spawnFn: fake.spawnFn});
  const answer = await client.messages.create(body);
  assert.equal(JSON.parse(answer.content[0].text).kind, 'posting');
  const args = fake.started.at(-1), after = flag => args[args.indexOf(flag) + 1];
  assert.equal(after('--model'), 'haiku', 'the alias, not the full model id');
  assert.ok(args.includes('--json-schema'), 'the schema is enforced natively');
  assert.equal(after('--effort'), 'low');
  assert.equal(after('--system-prompt'), 'You classify one page.', 'the system prompt is the request\'s own, the schema is not pasted into it');
});

test('what the scorer used to send differs from that, so a stored answer from it is marked', () => {
  const old = cliCall(body).args, after = flag => old[old.indexOf(flag) + 1];
  assert.equal(after('--model'), 'claude-haiku-5-5');
  assert.equal(old.includes('--effort'), false);
  assert.equal(old.includes('--json-schema'), false);
  assert.match(after('--system-prompt'), /Reply with ONE JSON object/);
});

test('the score says how many stored answers were recorded on another path than the app\'s', () => {
  const fixtures = [{id: 'a', answer: {kind: 'form'}, answer_path: 'app'}, {id: 'b', answer: {kind: 'posting'}}, {id: 'c', answer: {kind: 'other'}}, {id: 'd'}];
  assert.match(answerPathNote(fixtures), /2 of 3 stored answers were recorded on the old scorer path, not the app's/);
  assert.equal(answerPathNote(fixtures.slice(0, 1)), '');
  assert.equal(answerPathNote([]), '');
});
