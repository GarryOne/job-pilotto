// What Recent activity offers about Gmail follows its connection now, not the selected run (owner, 6 Oct 2026): a disconnected
// Gmail check keeps its box but drops "Connect Gmail" once Gmail is connected; the header and the schedule read the current state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {failureHead, notConnectedHead} from '../renderer/run-status.js';
import {activitySource} from './activity-source.js';

const run = {kind: 'mail', ok: true, off: true};

test('not connected now: Connect Gmail; connected since: the same run, no button', () => {
  assert.deepEqual(notConnectedHead(run, false).fix, {label: 'Connect Gmail', view: 'settings'});
  assert.deepEqual(notConnectedHead(run, null).fix, {label: 'Connect Gmail', view: 'settings'});
  const since = notConnectedHead(run, true);
  assert.equal(since.fix, null);
  assert.match(since.hint, /connected now/);
});

test('a revoked Google sign-in says Reconnect Google', () => {
  assert.equal(failureHead({ok: false, problem: 'not checked: the Google sign-in expired'}).fix.label, 'Reconnect Google');
});

test('the header button and the schedule read the current connection', () => {
  const js = activitySource();
  assert.match(js, /\$\('check-mail'\)\.textContent = gmailOff \? 'Connect Gmail' : 'Check Gmail now'/);
  assert.match(js, /pill\('Connection required', 'warn'\)/);
});
