import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {SKIPPED, skipExitCode, skipMessage, summarize} from '../lib/skip.mjs';

test('a skipped suite exits 0 by default, 3 under run-all, 1 when secrets are required', () => {
  assert.equal(skipExitCode({}), 0);
  assert.equal(skipExitCode({E2E_SKIP_EXIT: '3'}), SKIPPED);
  assert.equal(skipExitCode({E2E_REQUIRE_SECRETS: '1', E2E_SKIP_EXIT: '3'}), 1);   // required wins
});

test('the message says nothing ran and that it is not a pass', () => {
  const text = skipMessage('wizard', ['E2E_ANTHROPIC_KEY', 'E2E_NOTION_TOKEN']);
  assert.match(text, /SKIPPED, nothing ran/);
  assert.match(text, /E2E_ANTHROPIC_KEY and E2E_NOTION_TOKEN/);
  assert.match(text, /not a pass/);
});

test('the table marks a skipped suite, and only fails the run when secrets are required', () => {
  const results = [{suite: 'settings', code: 0, seconds: 30}, {suite: 'wizard', code: SKIPPED, seconds: 1}];
  const lenient = summarize(results);
  assert.match(lenient.text, /– wizard +1 s +\(skipped: secrets not set\)/);
  assert.match(lenient.text, /1 passed, 0 failed, 1 skipped \(not run\)/);
  assert.equal(lenient.exit, 0);
  assert.equal(summarize(results, {requireSecrets: true}).exit, 1);
  assert.equal(summarize([{suite: 'a', code: 1, seconds: 5}]).exit, 1);
  assert.equal(summarize([{suite: 'a', code: 0, seconds: 5}]).exit, 0);
  assert.doesNotMatch(summarize([{suite: 'a', code: 0, seconds: 5}]).text, /skipped/);
});

test('suite.mjs itself: no secrets means a loud SKIPPED line, and the exit code follows the environment', () => {
  // As CI with no test key: since every suite runs without a Notion token (lib/store.mjs), the AI key is the secret a suite can lack. On a Mac nothing is missing.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^E2E_/.test(key)));
  // Nothing heavy runs here (the suite skips at once), so it must not queue behind another session's browser suite for the heavy-run lock (JOB_PILOTTO_HEAVY=0).
  const run = env => spawnSync('node', ['suite.mjs', 'settings'], {cwd: new URL('..', import.meta.url).pathname, env: {...clean, CI: 'true', JOB_PILOTTO_HEAVY: '0', ...env}, encoding: 'utf8', timeout: 60000});
  const plain = run({}), inRun = run({E2E_SKIP_EXIT: '3'}), required = run({E2E_REQUIRE_SECRETS: '1'});
  for (const result of [plain, inRun, required]) assert.match(result.stdout, /SKIPPED, nothing ran/);
  assert.deepEqual([plain.status, inRun.status, required.status], [0, SKIPPED, 1]);
});
