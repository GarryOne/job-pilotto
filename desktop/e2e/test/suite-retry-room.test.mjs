// A suite that runs near its 7-minute budget needs a job limit that holds two attempts: the first may use the whole budget and a failed suite is run once more
// ("to tell flaky from real"), up to another 7 minutes, plus the job's setup. With 12 minutes the retry was cut at minute 12 and the run read "cancelled"
// (applycv, E2E check 38242968527, 12 Oct 2026: 437 s on a slow runner, budget 420 s).
import assert from 'node:assert/strict';
import {test} from 'node:test';

const BUDGET = 7, SETUP = 3;

test('apply and applycv have a job limit that holds a full first attempt and a full retry', async () => {
  for (const suite of ['apply', 'applycv']) {
    const {minutes} = await import(`../suites/${suite}.mjs`);
    assert.ok(minutes >= 2 * BUDGET + SETUP, `${suite}: job limit ${minutes} min is under ${2 * BUDGET + SETUP} (two attempts of ${BUDGET} min and the setup)`);
  }
});
