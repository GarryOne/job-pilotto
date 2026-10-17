// The e2e cause rules (site/src/e2e-causes.js): facts only, checked against the real reds of 17-18 Oct 2026 (runs 909 and 910, per the Beta loop's own notes).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CAUSES, CAUSE_IDS, causeOf, suiteOfJob} from '../src/e2e-causes.js';

const red = (extra = {}) => ({jobConclusion: 'failure', rerun: 'failure', log: '', fixFiles: null, ...extra});

test('a suite and platform come from the job name', () => {
  assert.deepEqual(suiteOfJob('E2E · Windows · apply'), {suite: 'apply', platform: 'windows'});
  assert.deepEqual(suiteOfJob('E2E · Mac + Linux · strategy'), {suite: 'strategy', platform: 'mac'});
  assert.equal(suiteOfJob('Release · Mac beta'), null);
  assert.equal(suiteOfJob('Build · Mac'), null);
});

test('an empty AI credit is "credit", whatever the fix was (run 909: OpenAI 429, run 910: Anthropic 400)', () => {
  assert.equal(causeOf(red({log: 'OpenAI HTTP 429 {"error":{"code":"insufficient_quota"}}'})), 'credit');
  assert.equal(causeOf(red({log: 'Anthropic 400: Your credit balance is too low to access the API'})), 'credit');
  assert.equal(causeOf(red({log: 'credit balance is too low', fixFiles: ['site/src/a.js']})), 'credit');
});

test('a runner that never ran the suite, or was cancelled, is "infra"', () => {
  assert.equal(causeOf(red({jobConclusion: 'cancelled'})), 'infra');
  assert.equal(causeOf(red({failedStep: 'Set up job'})), 'infra');
  assert.equal(causeOf(red({log: 'The runner has received a shutdown signal'})), 'infra');
});

test('the second try green is a "flake"; red twice goes by the files of the fix', () => {
  assert.equal(causeOf(red({rerun: 'success'})), 'flake');
  assert.equal(causeOf(red({fixFiles: ['desktop/e2e/suites/apply.mjs']})), 'test');
  assert.equal(causeOf(red({fixFiles: ['desktop/e2e/lib/apply-journeys.mjs', 'desktop/test/a.test.js']})), 'test');
  assert.equal(causeOf(red({fixFiles: ['extension/content.js', 'desktop/e2e/suites/apply.mjs']})), 'product');
  assert.equal(causeOf(red({fixFiles: ['.github/workflows/e2e.yml']})), 'infra');
  assert.equal(causeOf(red({fixFiles: ['tools/ship.sh']})), 'infra');
});

test('a range of more than 30 files cannot name the fix: "unknown"', () => {
  assert.equal(causeOf(red({fixFiles: Array.from({length: 31}, (_, i) => `site/src/f${i}.js`)})), 'unknown');
  assert.equal(causeOf(red({fixFiles: Array.from({length: 31}, (_, i) => `desktop/e2e/f${i}.mjs`)})), 'unknown');
});

test('a log that was not read (null) is never guessed: "unknown"; a flake and a cancelled job still are what they are', () => {
  assert.equal(causeOf(red({log: null, fixFiles: ['site/src/a.js']})), 'unknown');
  assert.equal(causeOf(red({log: null, rerun: 'success'})), 'flake');
  assert.equal(causeOf(red({log: null, jobConclusion: 'cancelled'})), 'infra');
});

test('no fix yet is "open", a fix we cannot read is "unknown", and the ids are the ones the page draws', () => {
  assert.equal(causeOf(red({fixFiles: []})), 'open');
  assert.equal(causeOf(red({fixFiles: null})), 'unknown');
  for (const id of ['credit', 'infra', 'flake', 'test', 'product', 'open', 'unknown']) assert.ok(CAUSE_IDS.includes(id), id);
  assert.ok(CAUSES.every(cause => cause.label && cause.color && cause.hint));
});
