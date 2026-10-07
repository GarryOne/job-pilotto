import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
    'Scored 1 of 1 job(s) with claude-sonnet-5-5; 0 failed; tokens in 2645 (+0 cached), out 737',
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
  // The counted line comes first, said once ("12 jobs left unscored"), then the refusals with their ids.
  assert.deepEqual(groupWarnings(warnings), [
    '12 jobs left unscored: the Anthropic API spending limit was reached',
    'Skipped 4 jobs (7, 6, 14, 8): the Anthropic API spending limit was reached',
    'Skipped 1 job (99): Expecting value']);
  assert.equal(limitedJobs(warnings), 16);  // 4 failed on it (one line cut short) + 12 the run stopped before
  assert.equal(limitedJobs(['Skipped job 1: JSONDecodeError: x']), 0);
});

test('a 429 from the AI service is said as "rate-limited", not "refused the call"', async () => {
  const {humanError, groupWarnings} = await import('../renderer/run-warnings.js');
  assert.equal(humanError('RateLimitError: Error code: 429'), 'the AI service is rate-limited right now');
  assert.deepEqual(groupWarnings(['Skipped job 5: Error code: 429']), ['Skipped 1 job (5): the AI service is rate-limited right now']);
  assert.match(readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8'), /AI_BUSY\.test\(text\)/);
});

test('the API\'s own JSON never reaches the owner: it becomes the sentence it means', async () => {
  const {groupWarnings, humanError} = await import('../renderer/run-warnings.js');
  const dump = "BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC'}}";
  assert.equal(humanError(dump), 'the Anthropic API spending limit was reached (back on 2026-10-01)');
  assert.equal(humanError('Error code: 400'), 'the AI service refused the call');           // nothing readable inside
  assert.equal(humanError('JSONDecodeError: Expecting value'), 'Expecting value');          // not a provider error
  assert.equal(humanError('plain sentence'), 'plain sentence');
  // A Gmail check's own failing call: the card says what happened, not the dump.
  const mail = ['Warning: check failed: ' + dump];
  assert.deepEqual(groupWarnings(mail), ['check failed: the Anthropic API spending limit was reached (back on 2026-10-01)']);
});

test('the three wordings of "jobs the limit left" are one line, counted once each', async () => {
  const {groupWarnings} = await import('../renderer/run-warnings.js');
  // The real 30 Sep jobs check: seven and two jobs, said twice (what happened and what is left), plus a skipped insight.
  const warnings = [
    'Warning: 7 job(s) not read by AI: the Anthropic API spending limit was reached',
    'Warning: 2 job(s) not scored: the Anthropic API spending limit was reached',
    'Warning: insight skipped: BadRequestError',
    'AI limit reached: Anthropic API spending limit, 7 job(s) left for the next check',
    'AI limit reached: Anthropic API spending limit, 2 job(s) left for the next check',
    "Warning: insight skipped: BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'You have reached your specified API usage limits'}}",
  ];
  assert.deepEqual(groupWarnings(warnings), [
    '9 jobs left unscored: the Anthropic API spending limit was reached',
    'insight skipped: the Anthropic API spending limit was reached']);
  // Nothing about the limit: a counted line on another reason is left as it is, never folded into a limit sentence.
  assert.deepEqual(groupWarnings(['Warning: 3 job(s) not scored: the model answered with no JSON']),
    ['3 job(s) not scored: the model answered with no JSON']);
});

// #94: the JavaScript SDK's dump ("400 {"type":"error",…}") reached the CV card as it was; it is said in words now.
test('the JavaScript SDK error body is said in words, with the day the limit resets', async () => {
  const {humanError} = await import('../renderer/run-warnings.js');
  const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."},"request_id":"req_011"}';
  assert.equal(humanError(raw), 'the Anthropic API spending limit was reached (back on 2026-11-01)');
  assert.equal(humanError('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), 'invalid x-api-key');
  assert.equal(humanError('No CV PDF yet'), 'No CV PDF yet', 'a sentence stays as it is');
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  assert.equal((page.match(/\$\('cv-message'\)\.textContent = [^;]*result\.error/g) || []).filter(line => !/cvError\(result\.error/.test(line)).length, 0, 'the CV message never shows result.error as it is');
});

test('a Find jobs using your browser run\'s site rows are not repeated as warnings above its card; another task\'s skipped line still is', () => {
  const log = ['Reading 2 sites in your browser, 2 at a time', '⏳ IWC Schaffhausen is not responding: skipped, the next site opens',
    '  ✗ IWC Schaffhausen: it stopped answering (nothing for 30 s): skipped, you can close its tab',
    '  ▸ stopped · IWC Schaffhausen · it stopped answering (nothing for 30 s): skipped, you can close its tab', 'Warning: Notion is busy (429)'];
  assert.deepEqual(runWarningLines({kind: 'visits', log}), ['Notion is busy (429)']);
  assert.equal(runWarningLines({kind: 'tailor', log}).length, 4);
});
