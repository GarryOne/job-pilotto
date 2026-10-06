// Every finished run that did not fully work explains itself in the same box with one way out, and the technical log is folded
// (the owner's fixes #6, #7, #10 and the log rules, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {failureHead, notConnectedHead, runStatus, waitedHead} from '../renderer/run-status.js';

test('Gmail not connected: Not checked, a box that connects it', () => {
  const head = notConnectedHead({kind: 'mail', ok: true, off: true});
  assert.equal(head.title, 'Gmail is not connected');
  assert.deepEqual(head.fix, {label: 'Connect Gmail', view: 'settings'});
  assert.deepEqual(runStatus({kind: 'mail', ok: true, off: true}, false), ['Not checked', 'warn']);
  assert.equal(notConnectedHead({kind: 'mail', ok: true}), null);
});

test('ended while waiting for another run: Couldn’t start, Try again', () => {
  const run = {kind: 'tailor', ok: false, log: ['Another Job Pilotto search is running (app or terminal): waiting for it…']};
  const head = waitedHead(run);
  assert.equal(head.title, 'Couldn’t start tailoring');
  assert.match(head.summary, /waiting for another Job Pilotto run/);
  assert.deepEqual(head.fix, {label: 'Try again', rerun: true});
  assert.equal(waitedHead({...run, problem: 'x'}), null);
});

test('no reason recognised: stopped unexpectedly, Run again, View technical log', () => {
  const head = failureHead({kind: 'search', ok: false, log: ['KeyError']}, 'Jobs check');
  assert.equal(head.title, 'The job search stopped unexpectedly');
  assert.ok(head.viewLog);
  assert.equal(failureHead({kind: 'weekly', ok: false}, 'Search analysis').title, 'Search analysis stopped unexpectedly');
});

test('the log opens by itself only while a run streams here', () => {
  const js = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/pages/activity.js'), 'utf8');
  assert.match(js, /\$\('activity-log'\)\.open = streamLocal;/);
});
