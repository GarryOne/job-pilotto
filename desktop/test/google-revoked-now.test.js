// A Gmail check whose Google sign-in failed: while it is still failing, the box's Reconnect Google is the one action (no header
// button beside it); once Gmail works again, the run says what happened then and that it is connected now, with no button (owner, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {activitySource} from './activity-source.js';

const js = activitySource();

test('disconnected now: the header button hides beside the box’s Reconnect Google', () => {
  assert.match(js, /gmailOff && \(selected\.off \|\| GOOGLE_SIGNIN\.test\(selected\.problem \|\| ''\)\)/);
});

test('connected now: the past failure without its obsolete button', () => {
  assert.match(js, /title: 'Google sign-in failed during this run', summary: 'Gmail is connected now\. You can run another check\.', hint: '', fix: null/);
  assert.match(js, /signedInSince\(failureHead\(/);
});
