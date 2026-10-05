// One word for how a run ended, the same on the Actions page and in Recent activity (2 Oct 2026, found by the activity e2e suite: the panel said "Completed with
// warnings" and "Failed" while the Actions page said plain "Completed" for a run with warnings).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {barState, doneTitle, failureHead, phaseStatus, runStatus, runWarned} from '../renderer/run-status.js';

test('a finished run is Completed, With warnings or Failed, a running one Running, a waiting one Queued', () => {
  assert.deepEqual(runStatus({ok: true}, false).slice(0, 2), ['Completed', 'good']);
  assert.deepEqual(runStatus({ok: true}, true).slice(0, 2), ['With warnings', 'warn']);
  assert.deepEqual(runStatus({ok: false}, false).slice(0, 2), ['Failed', 'bad']);
  assert.deepEqual(runStatus({ok: true, off: true}, false).slice(0, 2), ['Failed', 'bad']);
  assert.equal(runStatus({live: true}, false)[0], 'Running');
  assert.equal(runStatus({waiting: true}, false)[0], 'Queued');
});

test('a run is warned when its row says so or its log or report carries a warning line', () => {
  assert.equal(runWarned({ok: true, warned: true}), true);
  assert.equal(runWarned({ok: true, log: ['Checking feeds', 'Warning: API unavailable (RateLimitError), 3 job(s) left for the next check']}), true);
  assert.equal(runWarned({ok: true, log: ['Enriched 1 of 1 job(s); 0 failed']}), false);
  assert.equal(runWarned({ok: false, log: ['Warning: x']}), false);   // a failed run is Failed, not warned
  assert.equal(runWarned({live: true, ok: true, warned: true}), false);
});

test('the status bar dot describes the run the words beside it describe: a failed Gmail check no longer turns "Last jobs check · nothing new" red', () => {
  const search = {ok: true, kind: 'search'}, mail = {ok: true, off: true, kind: 'mail'};
  assert.equal(barState(null, search), 'ok');
  assert.equal(barState(null, mail), 'error', 'a Gmail check that did not run is shown for itself ...');
  assert.equal(barState(null, search || mail), 'ok', '... but beside the jobs check the dot follows the jobs check');
  assert.equal(barState({live: true}, mail), 'busy');
  assert.equal(barState(null, null), 'idle');
  assert.equal(barState(null, {ok: false}), 'error');
  assert.equal(barState(null, {ok: true, warned: true}), 'warn', 'a run that worked but warned is amber, not green');
});

test('a failed run does not tick the step it stopped at, and its later steps stay pending', () => {
  const failed = {ok: false, log: ['Searching job boards', 'Checking employer career pages']};
  assert.deepEqual([0, 1].map(i => phaseStatus(failed, i, 1)), ['done', 'fail']);
  assert.deepEqual([0, 1].map(i => phaseStatus(failed, i, 0)), ['fail', 'todo']);
  assert.equal(phaseStatus({ok: true}, 1, 1), 'done');
  assert.equal(phaseStatus({ok: true, warned: true}, 1, 1), 'warn');
  assert.equal(phaseStatus({live: true, ok: false}, 1, 1), 'now');
});

test('the checklist marks the step a warned run stopped at with a warning, not a tick', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8');
  assert.match(source, /phaseStatus\(run, i, at\)/);
  assert.match(fs.readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8'), /\.activity-phases li\.warn::before/);
});

test('the toast of a finished run agrees with its status: done, done with warnings, had problems (#276)', () => {
  assert.equal(doneTitle('Jobs check', {ok: true}), '✅ Jobs check done');
  assert.equal(doneTitle('Jobs check', {ok: true, warned: true}), '⚠️ Jobs check done with warnings', 'no green check for a run that detail pane calls "Completed with warnings"');
  assert.equal(doneTitle('Jobs check', {ok: false}), '⚠️ Jobs check had problems');
  assert.equal(doneTitle('Jobs check', {ok: true, off: true}), '⚠️ Jobs check had problems');
});

test('a failed run says so in its own box, with its reason and the fix the app can open, never "Completed with warnings" (#290)', () => {
  const google = failureHead({ok: false, problem: 'not checked: the Google sign-in expired (Settings → Gmail and Calendar)'});
  assert.deepEqual([google.title, google.summary, google.fix], ['Not checked', 'Not checked: the Google sign-in expired (Settings → Gmail and Calendar).', {label: 'Connect Google again', view: 'settings'}]);
  assert.equal(failureHead({ok: false, problem: 'not checked: Claude Code is not ready (Settings → AI)'}).fix.label, 'Open AI settings');
  assert.equal(failureHead({ok: false, problem: 'not checked: the Anthropic API spend limit was reached'}).fix, null, 'a limit has its own link on the page');
  assert.deepEqual([failureHead({ok: false}).title, failureHead({ok: false}).fix], ['Had problems', null]);
  assert.equal(failureHead({ok: true}), null, 'a run that worked has no failure head');
  assert.equal(failureHead({ok: true, warned: true}), null, 'nor one that only warned');
  assert.equal(failureHead({ok: false, live: true}), null, 'nor one still running');
  assert.equal(failureHead({ok: true, off: true}).title, 'Had problems', 'a check that is switched off counts as not done');
});
