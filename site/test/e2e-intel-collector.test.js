// tools/e2e-intel.mjs: from the jobs of release runs to the red suites and their causes (the shapes of runs 909/910, 17 Oct 2026), with no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {passedFirst, redJobs, rowsOf} from '../../tools/e2e-intel.mjs';

const step = (name, conclusion) => ({name, conclusion});
const job = (name, conclusion, steps = [], id = 1) => ({id, name, conclusion, steps, started_at: '2026-10-17T20:00:00Z', completed_at: '2026-10-17T20:12:00Z'});
const once = conclusion => step('The apply suite once more, to tell flaky from real', conclusion);
const run = (databaseId, createdAt, headSha, jobs, conclusion = 'failure') => ({databaseId, createdAt, updatedAt: createdAt.replace(':01:', ':27:'), headSha, conclusion, displayTitle: 'Beta by hand', jobs});

test('red jobs: a red Mac job after its second try, a Windows red, and a flake that the second try saved; green and other jobs are left out', () => {
  const jobs = [job('E2E · Mac + Linux · apply', 'failure', [step('Run the apply suite', 'success'), once('failure')], 10), job('E2E · Windows · apply', 'failure', [step('Run the apply suite on Windows', 'failure')], 11),
    job('E2E · Mac + Linux · quality', 'success', [once('success')], 12), job('E2E · Mac + Linux · jobs', 'success', [{name: 'The jobs suite once more, to tell flaky from real', conclusion: 'skipped'}], 13), job('Release · Mac beta', 'failure')];
  const reds = redJobs(jobs);
  assert.deepEqual(reds.map(red => [red.suite, red.platform, red.rerun, red.minutes]), [['apply', 'mac', 'failure', 12], ['apply', 'windows', undefined, 12], ['quality', 'mac', 'success', 12]]);
  assert.equal(reds[1].failedStep, 'Run the apply suite on Windows');
});

test('passedFirst is true only for a green job whose second try did not run', () => {
  const jobs = [job('E2E · Mac + Linux · apply', 'success', [once('success')]), job('E2E · Mac + Linux · jobs', 'success', [{name: 'The jobs suite once more, to tell flaky from real', conclusion: 'skipped'}])];
  assert.equal(passedFirst(jobs, 'apply', 'mac'), false);
  assert.equal(passedFirst(jobs, 'jobs', 'mac'), true);
  assert.equal(passedFirst(jobs, 'jobs', 'windows'), false);
});

test('causes: the fix is the files between the red run and the next run where the suite passed', () => {
  const red = job('E2E · Mac + Linux · apply', 'failure', [once('failure')], 10), redWin = job('E2E · Windows · strategy', 'failure', [], 20);
  const green = job('E2E · Mac + Linux · apply', 'success', [{name: 'The apply suite once more, to tell flaky from real', conclusion: 'skipped'}]);
  const runs = [run(1, '2026-10-17T20:01:00Z', 'aaa', [red, redWin]), run(2, '2026-10-17T21:01:00Z', 'bbb', [green], 'success')];
  const logs = {20: 'OpenAI HTTP 429 insufficient_quota'};
  const rows = rowsOf(runs, {logOf: id => logs[id] || '', filesBetween: (from, to) => (from === 'aaa' && to === 'bbb' ? ['desktop/e2e/suites/apply.mjs'] : null)});
  assert.deepEqual(rows.runs.map(row => [row.runId, row.conclusion, row.minutes]), [[1, 'failure', 26], [2, 'success', 26]]);
  assert.deepEqual(rows.fails.map(fail => [fail.suite, fail.platform, fail.cause, fail.day]), [['apply', 'mac', 'test', '2026-10-17'], ['strategy', 'windows', 'credit', '2026-10-17']]);
});

test('a suite that has not passed since is "open"; a flake never reads the log or the files', () => {
  const flaky = job('E2E · Mac + Linux · apply', 'success', [once('success')], 10), stuck = job('E2E · Mac + Linux · quality', 'failure', [], 11);
  const rows = rowsOf([run(1, '2026-10-17T20:01:00Z', 'aaa', [flaky, stuck])], {logOf: id => { if (id === 10) throw new Error('flake read the log'); return ''; }, filesBetween: () => { throw new Error('read the files of a suite that has no fix'); }});
  assert.deepEqual(rows.fails.map(fail => [fail.suite, fail.cause]), [['apply', 'flake'], ['quality', 'open']]);
});
