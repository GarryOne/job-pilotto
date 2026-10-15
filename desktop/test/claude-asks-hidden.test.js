// While Claude's takeover is off, the frozen asks of a session that is not running reach no screen (owner, 15 Oct 2026, "I told you a million times": the Adnovum card kept
// "Click 'Please sign in'…", "reply continue" and Tell Claude buttons, #950 gated only the buttons). Every screen, the list row, the log header, the tray and the notices read the
// session list, so the class is tested at that one place: no field of any session view carries the ask, from each producer. The renderer's own Claude entries: test/resume-hidden.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';

const ASK = 'Click "Please sign in" in the open Chrome tab, sign in with your email, then reply "ok".\n\n- **Needs you:**\n  - Or allow clicks on this site\'s sign-in pages and reply "continue", and I\'ll sign in myself';
const now = new Date().toISOString();
const producers = {
  'waiting for you, closed with the app': {status: 'input', question: ASK, note: 'Claude closed with the app'},
  'finished with a list of what is left': {status: 'done', question: ASK, note: ''},
  'ended with its last message': {status: 'ended', question: ASK, note: ''},
  'a failed run that said what it needed': {status: 'failed', question: ASK, note: 'exit 1'},
};

function restored(extra = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-asks-')), 'sessions.json');
  const rows = Object.entries(producers).map(([name, row], index) => ({id: `c${index}`, url: `https://jobs.example.test/${index}`, startedAt: now, output: '', claudeId: 'abc', ...row, ...extra, name}));
  rows.push({id: 'f1', kind: 'form', url: 'https://jobs.example.test/form', status: 'done', startedAt: now, output: '', question: '', note: 'Form open in Chrome'});
  fs.writeFileSync(file, JSON.stringify(rows));
  terminals._reset();
  terminals.persist(file);
  terminals.restore(Date.now());
}

test('flag off: no field of a stopped Claude session carries its frozen ask, whatever produced it', () => {
  terminals.hideAsks(true);
  restored();
  const views = terminals.list().filter(view => view.kind === 'claude');
  assert.equal(views.length, Object.keys(producers).length);
  for (const view of views) {
    const text = JSON.stringify(view);
    assert.doesNotMatch(text, /sign in|reply|Please sign|allow clicks|Needs you/i, `${view.id}: ${text.slice(0, 120)}`);
    assert.equal(view.question, '');
    assert.notEqual(view.status, 'input', `${view.id} is not "waiting for you": nothing asks`);
  }
  assert.equal(terminals.list().find(view => view.id === 'f1').note, 'Form open in Chrome', 'a form session is untouched');
  terminals.hideAsks(false); terminals._reset();
});

test('flag on, or the session is running: the ask is shown as before', () => {
  terminals.hideAsks(false);
  restored();
  assert.equal(terminals.list().find(view => view.id === 'c0').question, ASK);
  assert.equal(terminals.list().find(view => view.id === 'c0').status, 'input');
  terminals._reset();
});

test('main.js sets it from the one flag, so the window and the app agree', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{SHOW_RESUME_CLAUDE\} from '\.\/renderer\/claude-help\.js'/);
  assert.match(main, /terminals\.hideAsks\(!SHOW_RESUME_CLAUDE\)/);
});
