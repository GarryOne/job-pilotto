// A session's form tab closed in Chrome: every button that looks for it reopens the form, no question, and never starts Claude.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import {registerSessionHandlers} from '../lib/session-handlers.js';

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

// Owner, 8 Oct 2026: the card already says Reopen fills the form again from your kit, so no dialog; the closed tab's state goes.
for (const kind of ['form', 'claude']) {
  test(`a ${kind} session with the closed tab's state: no question, the state is cleared, the form reopens, Claude is not started`, async () => {
    const s = setup();
    const {id} = kind === 'form' ? terminals.startForm({id: 'f1', url: URL, company: 'Acme'})
      : await terminals.start({id: 'f1', url: URL, kind: 'claude', file: 'claude'});
    terminals.noteStuck(id, 'account');
    assert.deepEqual(await s.reopen(id, true), {ok: true, reset: true});
    assert.deepEqual(s.calls, ['forget f1', `open ${URL}`]);
    assert.equal(s.dialogs.length, 0);
    assert.equal(terminals.get(id).stuck, '');
    assert.ok(terminals.get(id), 'the session stays');
  });
}

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
