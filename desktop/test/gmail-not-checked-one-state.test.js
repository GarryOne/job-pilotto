// A Gmail check that read nothing (Gmail not connected, or the Google sign-in revoked) is ONE state, "Not checked", on every card:
// pill, result card, Actions top card, notification and footer (#605 P1, #540, #1661, #541).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {doneTitle, failureHead, noResultHead, runPill, runStatus} from '../renderer/run-status.js';
import {mailCardShown} from '../renderer/mail-report.js';
import {notice} from '../lib/run-history.js';
import {notCheckedNotice} from '../lib/not-checked-notice.js';
import {nextMailAt} from '../lib/schedule.js';
import {activitySource} from './activity-source.js';

const REVOKED = 'not checked: the Google sign-in expired (Settings → Connections)';
const zero = 'Gmail check: 0 new email(s) read, 0 update(s) recorded';
// Every way a Gmail check can end without reading the inbox.
const CASES = {
  'not connected': {kind: 'mail', ok: true, off: true},
  'sign-in revoked': {kind: 'mail', ok: false, problem: REVOKED, result: zero, report: [zero]},
  'Claude not ready': {kind: 'mail', ok: false, problem: 'not checked: Claude Code is not ready (Settings → Connections → AI)', report: [zero]},
};

test('every not-checked Gmail run: a "Not checked" pill, never "Failed"', () => {
  for (const [name, run] of Object.entries(CASES)) {
    assert.deepEqual(runPill(run).slice(0, 2), ['Not checked', 'warn'], name);
    assert.deepEqual(runStatus(run, false).slice(0, 2), ['Not checked', 'warn'], name);
  }
});

test('every not-checked Gmail run: no green "No new job emails" card', () => {
  for (const [name, run] of Object.entries(CASES)) assert.equal(mailCardShown(run), false, name);
});

test('every not-checked Gmail run: its box says "Not checked", with a way out, never "stopped unexpectedly"', () => {
  for (const [name, run] of Object.entries(CASES)) {
    for (const head of [failureHead(run, 'Gmail check'), noResultHead(run, {name: 'Gmail check'})]) {
      assert.match(head.title, /not checked|not connected/i, name);
      assert.doesNotMatch(`${head.title} ${head.summary}`, /unexpected/i, name);
      assert.ok(head.fix, `${name}: a way out`);
    }
    assert.equal(noResultHead(run, {name: 'Gmail check'}).tone, 'warn', name);
  }
});

test('every not-checked Gmail run: the notification says it was not checked', () => {
  for (const [name, run] of Object.entries(CASES)) assert.match(notCheckedNotice(run).title, /not checked/i, name);
  for (const [name, run] of Object.entries(CASES)) assert.match(doneTitle('Gmail check', run), /not checked/i, `${name}: toast`);
  assert.equal(notCheckedNotice({kind: 'search', ok: false}), null);
  assert.match(notice({kind: 'search', ok: false}).title, /had problems/);   // other kinds keep theirs
});

test('the footer does not promise a first Gmail check while Gmail is not connected', () => {
  assert.match(activitySource(), /gmailConnected\(\) === false \? 'Gmail not checked · not connected'/);
});

test('the schedule is unchanged for a connected Gmail (nextMailAt)', () => {
  assert.equal(typeof nextMailAt({setupDone: true, mailCadence: 'daily'}), 'number');
});
