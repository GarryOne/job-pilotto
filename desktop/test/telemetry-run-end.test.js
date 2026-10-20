// A run that ends badly is reported as failed only when it failed: one stopped from outside is not (desktop/lib/telemetry-handlers.js runFailure).
// Why: 20 Oct 2026, private issues #28 and #34 were runs the person stopped, filed as failures with their last ordinary line as the error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runFailure} from '../lib/telemetry-handlers.js';

test('a run stopped from outside (no exit code, not the watchdog) is not a failed run', () => {
  assert.equal(runFailure({code: null, timedOut: false, tail: ['Enriched 100 of 100 job(s); 0 failed']}), null);
});

test('the watchdog and a non-zero exit are failed runs, with their error line', () => {
  assert.deepEqual(runFailure({code: 124, timedOut: 'no output for 16 min', tail: ['AI budget: $0.00']}),
    {error: 'stopped by the app: no output for 16 min', timedOut: 'no output for 16 min', cutOff: false});
  assert.equal(runFailure({code: 1, timedOut: false, tail: ['Traceback (most recent call last):', 'TypeError: x', 'done']}).error, 'TypeError: x');
  assert.equal(runFailure({code: null, timedOut: 'no output for 31 min', tail: []}).error, 'stopped by the app: no output for 31 min');
});
