// The watchdogs measure on the awake clock: a Mac asleep is not a run gone quiet (7 Oct 2026: a scheduled refresh was stopped twice for
// "no output for 15 min", the moment the Mac woke up).
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchSleep, sleptMs, awakeNow, resetSleepForTests} from '../lib/awake.js';
import {stale, ORPHAN} from '../lib/orphans.js';

test('the time asleep is left out of the awake clock', () => {
  resetSleepForTests();
  const power = new EventEmitter(), logged = [];
  let clock = 1_000_000;
  watchSleep(power, (...args) => logged.push(args), () => clock);
  power.emit('suspend');
  clock += 20 * 60_000;   // 20 min with the lid closed
  assert.equal(sleptMs(clock), 20 * 60_000, 'while asleep, the sleep so far');
  power.emit('resume');
  assert.equal(sleptMs(clock + 5000), 20 * 60_000);
  assert.equal(awakeNow(clock + 5000), clock + 5000 - 20 * 60_000);
  assert.equal(logged[0][2].slept_s, 1200);
  resetSleepForTests();
});

test('the orphan watchdog does not count sleep as running or as quiet', () => {
  const seen = new Map(), run = pid => ({pid, elapsed: 10 * 60, cpu: 5, command: 'python -m src daily'});
  assert.deepEqual(stale([run(1)], seen, 0, ORPHAN, 0), []);
  // An hour later by the wall clock, of which the computer slept 59 min: ps says 70 min, CPU unchanged; awake, one minute passed.
  const later = {...run(1), elapsed: 70 * 60};
  assert.deepEqual(stale([later], seen, 60_000, ORPHAN, 59 * 60_000), []);
});
