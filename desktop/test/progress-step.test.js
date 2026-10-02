// The "what it is doing now" words of a running task (Actions banner, Recent activity) come from the engine's output lines. A Python crash prints a traceback and an
// exception line while the run's row is still being closed: those are not a step (2 Oct 2026: "Insight is running · ModuleNotFoundError: No module named 'anthropic'").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isProgressStep} from '../lib/pipeline.js';

test('an engine progress line is a step', () => {
  for (const line of ['Searching job boards (jobs.ch, TechTree)…', 'Checking employer career pages, then reading and scoring new jobs…', 'Scoring 12 jobs', 'Errors found: 0 feeds failed'])
    assert.equal(isProgressStep(line), true, line);
});
test('a traceback line, an exception line, an indented line or a warning is not', () => {
  for (const line of ['Traceback (most recent call last):', "ModuleNotFoundError: No module named 'anthropic'", 'anthropic.AuthenticationError: Error code: 401',
    'KeyError: 3', 'SystemExit: 1', '  File "x.py", line 3, in <module>', 'Warning: Notion was busy', 'Cronjob run logged: https://app.notion.com/p/abc', 'x'.repeat(130)])
    assert.equal(isProgressStep(line), false, line);
});

// The watchdog says how long a run was silent: minutes for a real run (15 min limit), seconds for the end-to-end journey's shortened limit ("no output for 0 min" said nothing).
import {quietText} from '../lib/pipeline.js';
test('the silence is told in seconds when short and in minutes when long', () => {
  assert.equal(quietText(12000), '12 s');
  assert.equal(quietText(89000), '89 s');
  assert.equal(quietText(15 * 60 * 1000 + 4000), '15 min');
  assert.equal(quietText(90 * 1000), '2 min');
});
