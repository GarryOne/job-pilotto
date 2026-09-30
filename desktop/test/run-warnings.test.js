import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWarningLines, runWarnings} from '../renderer/run-warnings.js';

test('a GitHub run\'s warning is in its report, not its one-line log (the list and the card must agree)', () => {
  // A Notion row: Status Warnings, its Summary only the report's first line, its log one line pointing at its page.
  const mail = {result: 'Gmail check: 0 new email(s) read, 0 update(s) recorded',
    log: ['Cronjob run logged: https://app.notion.com/p/2026-09-30-22-39-Gmail-check-abc'],
    report: ['Gmail check: 0 new email(s) read, 0 update(s) recorded', 'Warning: Gmail read failed (the token expired)']};
  assert.deepEqual(runWarningLines(mail), ['Gmail read failed (the token expired)']);
  assert.deepEqual(runWarnings(mail.log), []);  // the log alone says nothing: what the app showed before
  assert.deepEqual(runWarningLines({result: 'Quiet run: nothing new from 29 feed(s)'}), []);
  assert.deepEqual(runWarningLines({result: 'failed', log: []}), []);  // a failed run's summary is not a warning line
});

test('a run\'s warnings: real problems only, never a "0 failed" report line', () => {
  assert.deepEqual(runWarnings([
    'Enriched 1 of 1 job(s) with claude-haiku-4-5; 0 failed; tokens in 3401, out 185',
    'Scored 1 of 1 job(s) with claude-sonnet-5; 0 failed; tokens in 2645 (+0 cached), out 737',
  ]), []);
  assert.deepEqual(runWarnings([
    'Scored 3 of 5 job(s); 2 failed',
    'Warning: Notion 429 on Job Matches sync',
    'Job Matches sync skipped',
    'Notion failed to answer',
    '0 skipped, 0 failed',
  ]), ['Scored 3 of 5 job(s); 2 failed', 'Notion 429 on Job Matches sync', 'Job Matches sync skipped', 'Notion failed to answer']);
});

test('the same API error on many jobs reads as one line, and the spend limit counts every job it left', async () => {
  const {groupWarnings, limitedJobs} = await import('../renderer/run-warnings.js');
  const limit = id => `Skipped job ${id}: BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'You have reached your specified API usage limits. You wil`;
  const warnings = [limit(7), limit(6), 'Skipped job 14: BadRequestError: Er', limit(8), 'Skipped job 99: JSONDecodeError: Expecting value',
    'AI limit reached: Anthropic API spending limit, 12 job(s) left for the next check'];
  assert.deepEqual(groupWarnings(warnings), [
    'Skipped 4 jobs (7, 6, 14, 8): the Anthropic API spending limit was reached',
    'Skipped 1 job (99): Expecting value',
    'AI limit reached: Anthropic API spending limit, 12 job(s) left for the next check']);
  assert.equal(limitedJobs(warnings), 16);  // 4 failed on it (one line cut short) + 12 the run stopped before
  assert.equal(limitedJobs(['Skipped job 1: JSONDecodeError: x']), 0);
});
