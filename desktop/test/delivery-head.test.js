// A search that did its work but whose Telegram message did not arrive: Completed with warnings, its steps ticked, then a
// box about the message (paper plane, the engine's own reason, Telegram settings), not a failed search (owner's fix #5, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryHead, phaseStatus, runStatus, runWarned} from '../renderer/run-status.js';

const warning = 'Warning: Telegram refused the digest: the bot token is not valid. Connect Telegram again in Settings.';

test("the engine's warning line: a delivery head, the run warned, its steps done", () => {
  const run = {kind: 'search', ok: true, log: ['Checking employer career pages…', warning]};
  const head = deliveryHead(run);
  assert.equal(head.title, 'Telegram message not delivered');
  assert.equal(head.summary, 'The search completed, but its Telegram message was not sent.');
  assert.equal(head.hint, 'Telegram refused the digest: the bot token is not valid. Connect Telegram again in Settings.');
  assert.deepEqual(head.fix, {label: 'Open Telegram settings', view: 'settings'});
  assert.equal(head.icon, 'send');
  assert.ok(runWarned(run));
  assert.deepEqual(runStatus(run, true), ['With warnings', 'warn']);
  assert.equal(phaseStatus(run, 1, 1), 'done');
});

test('the app\'s own "not delivered:" problem, and runs it does not touch', () => {
  assert.match(deliveryHead({kind: 'search', ok: true, problem: 'not delivered: Telegram refused the bot token (Settings → Telegram)'}).hint, /^Telegram refused the bot token/);
  assert.equal(deliveryHead({kind: 'search', ok: false, log: [warning]}), null);
  assert.equal(deliveryHead({kind: 'search', ok: true, log: ['Sent 1 Telegram message(s)']}), null);
  assert.equal(phaseStatus({kind: 'search', ok: true, log: ['Warning: 3 jobs not read by AI']}, 1, 1), 'warn');
});
