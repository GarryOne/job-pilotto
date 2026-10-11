// Pre-started `claude -p` processes for the page's questions (apply-latency change 2, lib/ai/cli-spares.js and ClaudeCode.runCall): one process
// per question, never reused; at most `max` wait; an unused one is killed; side work never gets one. Fake processes only: no real Claude Code.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';

import {sparePool} from '../lib/ai/cli-spares.js';
import {ClaudeCode} from '../lib/ai/claude-code-cli.js';

// A fake child: records what it was asked, answers one stream-json (or plain json) result when its stdin ends.
function fakeSpawner() {
  const spawned = [];
  const spawnFn = (binary, args) => {
    const child = new EventEmitter();
    Object.assign(child, {args, input: null, exitCode: null, killed: false, stdout: new EventEmitter(), stderr: new EventEmitter()});
    child.kill = () => { child.killed = true; child.exitCode = 137; child.emit('exit', 137); child.emit('close', 137); };
    child.asked = 0;
    child.stdin = {on: () => {}, end: input => setImmediate(() => {
      child.asked += 1;
      child.input = input;
      const result = {type: 'result', subtype: 'success', is_error: false, result: '', structured_output: {kind: 'form'}, usage: {input_tokens: 1, output_tokens: 1}};
      child.stdout.emit('data', args.includes('--input-format') ? `${JSON.stringify({type: 'system'})}\n${JSON.stringify(result)}\n` : JSON.stringify(result));
      child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0);
    })};
    spawned.push(child);
    return child;
  };
  return {spawned, spawnFn};
}
const help = flags => (bin, args, opts, done) => done(null, flags, '');
const ALL = '--output-format --model --tools --permission-mode --json-schema --input-format --no-session-persistence';
const ask = {model: 'claude-haiku-4-5', max_tokens: 50, system: 'You classify a job page.', messages: [{role: 'user', content: 'sketch'}],
  output_config: {format: {type: 'json_schema', schema: {type: 'object', properties: {kind: {type: 'string'}}, required: ['kind']}}}};

test('the pool: one spare per kind of question, at most max, taken once, an unused one killed after idleMs', async () => {
  const {spawned, spawnFn} = fakeSpawner();
  const pool = sparePool({max: 2, idleMs: 20});
  pool.keep('a', () => spawnFn('c', ['a'])); pool.keep('a', () => spawnFn('c', ['a'])); pool.keep('b', () => spawnFn('c', ['b'])); pool.keep('c', () => spawnFn('c', ['c']));
  assert.equal(spawned.length, 2, 'one per kind, and never more than max');
  const first = pool.take('a');
  assert.equal(first, spawned[0]);
  assert.equal(pool.take('a'), null, 'a spare answers one question only');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(spawned[1].killed, true, 'the unused spare was killed');
  assert.equal(pool.size(), 0);
  pool.keep('d', () => { const child = spawnFn('c', ['d']); child.kill(); return child; });
  assert.equal(pool.take('d'), null, 'a spare that died is not handed out');
  pool.clear();
});

test('a page ask goes through a pre-started process with its prompt as one stream-json message; the next page ask finds one waiting', async () => {
  const {spawned, spawnFn} = fakeSpawner();
  class Page extends ClaudeCode { static spares = sparePool({idleMs: 5000}); }
  const make = () => new Page({binary: '/fake/claude', spawnFn, run: help(ALL), lane: 'page', log: () => {}});
  const first = await make().messages.create(ask);
  assert.equal(JSON.parse(first.content[0].text).kind, 'form');
  assert.equal(spawned.length, 2, 'the first ask starts cold and starts the spare for the next one');
  assert.ok(spawned[0].args.includes('--input-format'));
  assert.deepEqual(JSON.parse(spawned[0].input), {type: 'user', message: {role: 'user', content: 'sketch'}});
  assert.equal(spawned[1].input, null, 'the spare waits for its question');
  const second = await make().messages.create(ask);
  assert.equal(JSON.parse(second.content[0].text).kind, 'form');
  assert.notEqual(spawned[1].input, null, 'the second ask was answered by the spare');
  assert.equal(spawned.length, 3, 'and a fresh spare waits for the third: a process is never asked twice');
  await make().messages.create(ask); await make().messages.create(ask);
  assert.ok(spawned.every(child => child.asked <= 1), 'every process got at most ONE question (no process sees an earlier page)');
  assert.equal(spawned.filter(child => child.asked === 1).length, 4);
  Page.spares.clear();
});

test('side work and a Claude Code without stream input keep the one plain call, no spare', async () => {
  for (const [lane, flags] of [[undefined, ALL], ['page', ALL.replace(' --input-format', '')]]) {
    const {spawned, spawnFn} = fakeSpawner();
    class Side extends ClaudeCode { static spares = sparePool(); }
    const answer = await new Side({binary: `/fake/claude-${lane || 'side'}-${flags.length}`, spawnFn, run: help(flags), lane, log: () => {}}).messages.create(ask);
    assert.equal(JSON.parse(answer.content[0].text).kind, 'form');
    assert.equal(spawned.length, 1, `${lane || 'side'}: one process`);
    assert.equal(spawned[0].args.includes('--input-format'), false);
    assert.equal(spawned[0].input.startsWith('sketch'), true, 'the prompt as text, as before');
    assert.equal(Side.spares.size(), 0);
  }
});
