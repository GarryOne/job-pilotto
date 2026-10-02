// One word for how a run ended, the same on the Actions page and in Recent activity (2 Oct 2026, found by the activity e2e suite: the panel said "Completed with
// warnings" and "Failed" while the Actions page said plain "Completed" for a run with warnings).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runStatus, runWarned} from '../renderer/run-status.js';

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
