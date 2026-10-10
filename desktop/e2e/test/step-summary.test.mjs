// The suite's steps as a table on the GitHub run's Summary page: every status, a failure in plain words with its screenshot and trace, and a table that cannot break.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shotName} from '../lib/runner.mjs';
import {stepSummary} from '../lib/step-summary.mjs';

const results = [
  {name: 'setup finishes', status: 'passed', seconds: '12.4'},
  {name: 'the digest shows | two jobs', status: 'failed', note: 'expected 2 rows,\nthe page shows 1'},
  {name: 'Telegram card', status: 'skipped'},
  {name: 'Notion saves', status: 'passed', seconds: '3.0', retried: 'HTTP 502'},
  {name: 'late step', status: 'failed', note: 'not run: the suite was over its 7-minute budget', budget: true},
];

test('every step is a row with its status, time and what happened', () => {
  const text = stepSummary('jobs', results, {traces: ['trace-jobs.zip'], artifact: 'e2e-artifacts-jobs', runUrl: 'https://github.com/o/r/actions/runs/1'});
  assert.match(text, /^### ❌ jobs: 2 passed, 2 failed, 1 skipped, 15 s/);
  assert.match(text, /\| ✅ \| setup finishes \| 12 s \|/);
  assert.match(text, /\| ⏭️ \| Telegram card \|/);
  assert.match(text, /passed after one retry \(the environment failed: HTTP 502\)/);
  // A pipe or a newline in a name or a note would split the row: escaped and flattened.
  assert.match(text, /the digest shows \\\| two jobs \| {2}\| expected 2 rows, the page shows 1 · screenshot `failed-the-digest-shows-two-jobs\.png`/);
  assert.equal(shotName('the digest shows | two jobs'), 'failed-the-digest-shows-two-jobs');
  // A step cut by the budget never ran: no screenshot to name.
  assert.match(text, /over its 7-minute budget \|$/m);
  assert.match(text, /\*\*e2e-artifacts-jobs\*\* artifact \(\[download\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1#artifacts\)\)/);
  assert.match(text, /`trace-jobs\.zip`.*trace\.playwright\.dev/);
});

test('the suite links to the run\'s HTML report, except on the second try', () => {
  const url = 'https://www.jobpilotto.top/admin/e2e/run/9/report?suite=jobs';
  assert.match(stepSummary('jobs', results, {reportUrl: url}), /📊 \[Open the HTML report\]\(https:\/\/www\.jobpilotto\.top\/admin\/e2e\/run\/9\/report\?suite=jobs\)/);
  assert.doesNotMatch(stepSummary('jobs', results, {reportUrl: url, rerun: true}), /HTML report/);
});

test('a passing suite says so in one line and points at no trace', () => {
  const text = stepSummary('wizard', [results[0]], {os: 'Windows'});
  assert.match(text, /^### ✅ wizard \(Windows\): 1 passed, 0 failed, 0 skipped, 12 s/);
  assert.doesNotMatch(text, /trace|artifact/);
});

test('the second try says its files are the first try\'s', () => {
  const text = stepSummary('jobs', [results[1]], {rerun: true, traces: ['trace-jobs.zip']});
  assert.match(text, /jobs, second try/);
  assert.match(text, /first try's artifact has the screenshots and the trace/);
});

test('a suite that stopped before any step says so', () => {
  assert.match(stepSummary('jobs', []), /No step ran/);
});
