// The report alarm (extension/report-alarm.js): created once and then left alone.
//
// It used to be created at the top level of the service worker, which wakes far more often than the alarm's 30
// seconds — and creating an alarm that already exists resets its timer, so the report could be pushed out of reach
// indefinitely (1 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ensureAlarm} from '../../extension/report-alarm.js';

const fake = (existing = null) => {
  const made = [];
  return {made, get: async name => (name === 'report-tabs' ? existing : null),
    create: async (name, info) => made.push({name, info})};
};

test('a missing alarm is created, with the period the report needs', async () => {
  const alarms = fake(null);
  assert.equal(await ensureAlarm(alarms), true);
  assert.deepEqual(alarms.made, [{name: 'report-tabs', info: {periodInMinutes: 0.5}}]);
});

test('an alarm that is already there is left alone, timer and all', async () => {
  const alarms = fake({name: 'report-tabs', periodInMinutes: 0.5});
  assert.equal(await ensureAlarm(alarms), false);
  assert.deepEqual(alarms.made, [], 're-creating it would restart its 30 seconds from now');
});

test('a browser without the alarms API does not throw the worker out', async () => {
  assert.equal(await ensureAlarm({get: () => { throw new Error('no chrome.alarms'); }, create: () => {}}), false);
});
