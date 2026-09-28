// Apply with Claude inside the app: sessions in a (fake) pseudo-terminal, their status from hooks and notify.sh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';

function fakePty() {
  const spawned = [];
  return {spawned, loader: async () => ({spawn: (file, args, options) => {
    const handlers = {};
    const term = {file, args, options, written: [], killed: false,
      onData: fn => { handlers.data = fn; }, onExit: fn => { handlers.exit = fn; },
      write: data => term.written.push(data), resize: (cols, rows) => { term.size = [cols, rows]; },
      kill: () => { term.killed = true; handlers.exit?.({exitCode: 0}); }, emit: data => handlers.data(data)};
    spawned.push(term);
    return term;
  }})};
}

test('a session runs in a pseudo-terminal, keeps its output and takes your typing', async () => {
  const pty = fakePty();
  terminals.usePty(pty.loader);
  const events = [];
  terminals.onChange((event, payload) => events.push([event, payload.id]));
  const started = await terminals.start({id: 's1', url: 'https://jobs.test/1', title: 'SRE', company: 'Acme', file: '/bin/claude', args: ['--chrome'], cwd: '/tmp', env: {}});
  assert.equal(started.status, 'running');
  pty.spawned[0].emit('hello ');
  pty.spawned[0].emit('world');
  assert.equal(terminals.output('s1'), 'hello world');
  terminals.write('s1', 'yes\r');
  terminals.resize('s1', 100, 30);
  assert.deepEqual([pty.spawned[0].written, pty.spawned[0].size], [['yes\r'], [100, 30]]);
  assert.equal(pty.spawned[0].options.env.TERM, 'xterm-256color');
  assert.deepEqual(events.slice(0, 2), [['update', 's1'], ['data', 's1']]);
  terminals.remove('s1');
});

test('hooks and notify.sh move a session between working, needs you and form filled', async () => {
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 's2', url: 'https://jobs.test/2', file: 'claude', env: {}});
  const transcript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-t-')), 't.jsonl');
  fs.writeFileSync(transcript, [JSON.stringify({type: 'user', message: {content: 'go'}}),
    JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: 'The role is on-site in SF. Continue anyway?'}]}})].join('\n'));
  let result = terminals.report('s2', {event: 'stop', transcript});
  assert.deepEqual([result.needsYou, result.session.status, result.session.question], [true, 'input', 'The role is on-site in SF. Continue anyway?']);
  assert.equal(terminals.report('s2', {event: 'stop', transcript}).needsYou, false);  // told once, not at every turn
  result = terminals.report('s2', {event: 'prompt'});
  assert.deepEqual([result.session.status, result.session.question], ['running', '']);
  terminals.report('s2', {event: 'note', message: 'Filling started'});
  assert.equal(terminals.get('s2').note, 'Filling started');
  result = terminals.report('s2', {event: 'note', message: 'Form filled — review and Submit'});
  assert.equal(result.session.status, 'done');
  assert.equal(terminals.report('s2', {event: 'stop'}).session.status, 'done');  // the hand-over turn ends: still done
  assert.equal(terminals.report('nope', {event: 'stop'}).session, null);
  terminals.remove('s2');
});

test('the hooks report to the app on this computer only, for this session', () => {
  const settings = JSON.parse(terminals.hookSettings('ab12', 47111));
  const command = settings.hooks.Stop[0].hooks[0].command;
  assert.match(command, /http:\/\/127\.0\.0\.1:47111\/claude\/session\?id=ab12&event=stop/);
  assert.match(command, /X-Job-Pilotto: launcher/);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['Notification', 'Stop', 'UserPromptSubmit']);
});
