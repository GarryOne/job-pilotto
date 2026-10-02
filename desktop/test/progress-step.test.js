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
