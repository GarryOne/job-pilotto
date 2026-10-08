// A session's form tab closed in Chrome: every button that looks for it reopens the form (asking first whether to start again).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import {registerSessionHandlers} from '../lib/session-handlers.js';
import {tabClosed} from '../lib/quit-dialog.js';

const URL = 'https://jobs.example.test/engineer';
const here = path.resolve(import.meta.dirname, '..');

function setup({choice = null} = {}) {
  terminals._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {}})}));
  const handles = new Map(), calls = [], logs = [], dialogs = [];
  registerSessionHandlers({ipcMain: {handle: (name, fn) => handles.set(name, fn)}, appLog: (area, message) => logs.push(`${area}: ${message}`),
    storage: {}, getWindow: () => null, here, DEMO: false, nativeImage: {createFromPath: () => ({})},
    dialog: {showMessageBox: async (_window, options) => { dialogs.push(options); return {response: choice}; }},
    apply: {openOne: url => { calls.push(`open ${url}`); return {ok: true}; },
      applyOne: async (_storage, url) => { calls.push(`chrome ${url}`); return {ok: true}; },
      claudeOne: async (_storage, url) => { calls.push(`claude ${url}`); return {ok: true}; }},
    review: {forget: id => calls.push(`forget ${id}`)}, pipeline: {}, server: {}, notion: {}, claudeConsent: async () => true});
  const reopen = (id, stale) => handles.get('sessionReopen')({}, id, stale);
  return {reopen, calls, logs, dialogs};
}

test('nothing from the closed tab on the page: the form reopens without a question', async () => {
  const s = setup();
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  assert.deepEqual(await s.reopen(id, false), {ok: true, reset: false});
  assert.deepEqual(s.calls, [`open ${URL}`]);
  assert.equal(s.dialogs.length, 0);
  assert.ok(s.logs.some(line => line.startsWith('review: tab gone f1: nothing to clear')));
});

test('start again: the form session forgets the closed tab and its stuck flag, then the form reopens', async () => {
  const s = setup({choice: 0});
  const {id} = terminals.startForm({id: 'f1', url: URL, company: 'Acme'});
  terminals.noteStuck(id, 'account');
  assert.deepEqual(await s.reopen(id, true), {ok: true, reset: true});
  assert.deepEqual(s.calls, ['forget f1', `open ${URL}`]);
  assert.equal(terminals.get(id).stuck, '');
  assert.equal(s.dialogs[0].message, tabClosed('Acme', false).message);
  assert.ok(s.logs.includes('review: tab gone f1: start again yes'));
});

test('keep and reopen: everything stays, the form reopens', async () => {
  const s = setup({choice: 1});
  const {id} = terminals.startForm({id: 'f1', url: URL});
  terminals.noteStuck(id, 'account');
  assert.deepEqual(await s.reopen(id, true), {ok: true, reset: false});
  assert.deepEqual(s.calls, [`open ${URL}`]);
  assert.equal(terminals.get(id).stuck, 'account');
  assert.ok(s.logs.includes('review: tab gone f1: start again no'));
});

test('cancel: nothing opens and nothing changes', async () => {
  const s = setup({choice: 2});
  const {id} = terminals.startForm({id: 'f1', url: URL});
  assert.equal((await s.reopen(id, true)).cancelled, true);
  assert.deepEqual(s.calls, []);
});

test('a Claude session started again: in Chrome or with Claude, as chosen (never Claude by itself); kept, the tab reopens with the mark', async () => {
  for (const [choice, expected] of [[0, `chrome ${URL}`], [1, `claude ${URL}`]]) {
    const s = setup({choice});
    await terminals.start({id: 'c1', url: URL, kind: 'claude', file: 'claude'});
    assert.equal((await s.reopen('c1', true)).reset, true);
    assert.deepEqual(s.calls, [expected]);
    assert.equal(terminals.get('c1'), null);
    assert.equal(s.dialogs[0].detail, tabClosed('', true).detail);
    assert.deepEqual(s.dialogs[0].buttons, ['Start again in Chrome', 'Start again with Claude', 'Keep and reopen', 'Cancel']);
    assert.equal(s.dialogs[0].defaultId, 2);
  }
  const no = setup({choice: 2});
  await terminals.start({id: 'c2', url: URL, kind: 'claude', file: 'claude'});
  assert.deepEqual(await no.reopen('c2', true), {ok: true, reset: false});
  assert.deepEqual(no.calls, [`open ${URL}`]);
  const cancel = setup({choice: 3});
  await terminals.start({id: 'c3', url: URL, kind: 'claude', file: 'claude'});
  assert.equal((await cancel.reopen('c3', true)).cancelled, true);
  assert.deepEqual(cancel.calls, []);
});

// The class: every place in the session pages that looks for the form's tab hands a closed one to reopenClosedTab, and no
// button opens a fresh tab or tells you to open it yourself.
test('every caller of the form-tab lookup reopens a closed tab through reopenClosedTab', () => {
  const pages = ['session-needs.js', 'sessions.js', 'session-log.js'].map(name => [name, fs.readFileSync(path.join(here, 'renderer', 'pages', name), 'utf8')]);
  let callers = 0;
  for (const [name, source] of pages) {
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (!/window\.pilot\.(showBrowser|reviewFocus)\(/.test(line)) return;
      callers++;
      assert.match(lines.slice(index, index + 12).join('\n'), /reopenClosedTab\(item/, `${name}:${index + 1} looks for the form tab without reopening a closed one`);
    });
    assert.doesNotMatch(source, /No open Chrome tab (is|matches) this job/, `${name} still asks you to open the form yourself`);
    assert.doesNotMatch(source, /window\.pilot\.applyOne\(item\.url\)/, `${name} reopens a session's form without asking about the closed tab's state`);
  }
  assert.ok(callers >= 3, `expected Open in Chrome, Open filled form and Review in form, found ${callers}`);
});
