// Errors over a whole suite become findings: an uncaught exception, a console.error, one of the app's files failing to load. Expected AI refusals in a
// suite that breaks the AI on purpose, and outside noise, do not.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {journeyFindings} from '../lib/journey.mjs';
import {normalize, issueTitle} from '../lib/triage.mjs';

test('distinct window errors become findings, each once, at most a few per kind', () => {
  const store = {pageErrors: ['TypeError: Cannot read properties of undefined (reading \'id\')', 'TypeError: Cannot read properties of undefined (reading \'id\')'],
    consoleErrors: ['Uncaught (in promise) Error: notion 502', 'DevTools failed to load source map', 'RateLimitError: 429'], failedLoads: ['desktop/renderer/icons/missing.svg']};
  const plain = journeyFindings(store, {suite: 'jobs'});
  assert.deepEqual(plain.map(item => [item.view, item.kind, item.detail.split(':')[0]]), [
    ['jobs-journey', 'console-error', 'window threw TypeError'], ['jobs-journey', 'console-error', 'console Uncaught-in-promise'],
    ['jobs-journey', 'console-error', 'console RateLimitError'], ['jobs-journey', 'broken-resource', 'failed to load']]);
  const expecting = journeyFindings(store, {suite: 'activityfailures', expectsFailures: true});
  assert.ok(!expecting.some(item => /RateLimitError/.test(item.detail)), 'an AI refusal is expected where the suite causes it');
  assert.ok(expecting.some(item => /TypeError/.test(item.detail)), 'an exception is still a bug there');
});

test('a journey error is filed with a title that names the error', () => {
  const [finding] = normalize({ui: journeyFindings({pageErrors: ['TypeError: x is undefined'], consoleErrors: [], failedLoads: []}, {suite: 'focus'})});
  assert.equal(issueTitle(finding), '[auto-ui] focus-journey: console error on focus-journey: window: "TypeError: x is undefined"');
});

test('a journey error is marked not seen when its suite ran again without it', async () => {
  const {triage} = await import('../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-focus')); fs.writeFileSync(path.join(dir, 'e2e-artifacts-focus', 'ui-findings.json'), '[]');
  const issue = {number: 3, state: 'OPEN', title: '[auto-ui] focus-journey: console error on focus-journey: window', body: '**MEDIUM** · console-error · found by the layout check', labels: [{name: 'auto-ui'}, {name: 'fp:x'}], comments: []};
  const gh = args => (args[0] === 'issue' && args[1] === 'list' ? JSON.stringify([issue]) : args[0] === 'pr' ? '[]' : '');
  assert.equal(triage({artifacts: dir, runUrl: 'https://x/runs/5', gh}).gone.length, 1);
});
