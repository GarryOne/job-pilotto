import assert from 'node:assert/strict';
import {test} from 'node:test';
import {crons, withSchedule} from '../lib/cadence.js';
import {due} from '../lib/schedule.js';

const TEMPLATE = "on:\n  schedule:\n    - cron: '30 */4 * * *'\n  workflow_dispatch:\n";

test('the chosen times, in the user\'s time zone, become UTC schedules', () => {
  const zurichSummer = 120;  // UTC+2
  assert.deepEqual(crons({schedule: {scout: 'daily'}}, zurichSummer), {
    'daily.yml': '30 1,5,9,13,17,21 * * *',  // every 4 h from 07:30 local
    'scout.yml': '15 6 * * *',               // 08:15 local
    'mail.yml': '0 5,10,16 * * *',           // 07, 12, 18 local
  });
  assert.deepEqual(crons({schedule: {search: 24, scout: 'weekly', mail: 1}}, 0),
    {'daily.yml': '30 7 * * *', 'scout.yml': '15 8 * * 1', 'mail.yml': '0 8 * * *'});
  assert.deepEqual(crons({schedule: {search: 0, scout: 'off', mail: 0}}, 0), {'daily.yml': null, 'scout.yml': null, 'mail.yml': null});
});

test('a schedule is rewritten or removed; manual runs stay', () => {
  assert.equal(withSchedule(TEMPLATE, '0 8 * * *'), "on:\n  schedule:\n    - cron: '0 8 * * *'\n  workflow_dispatch:\n");
  assert.equal(withSchedule(TEMPLATE, null), 'on:\n  workflow_dispatch:\n');
});

test('the app\'s own timer uses the same search interval', () => {
  const hour = 3600 * 1000, now = Date.parse('2026-09-27T12:00:00Z');
  const lastSearchAt = new Date(now - 3 * hour).toISOString();
  assert.equal(due({setupDone: true, lastSearchAt}, now), false);                       // default 4 h
  assert.equal(due({setupDone: true, lastSearchAt, schedule: {search: 2}}, now), true);
  assert.equal(due({setupDone: true, lastSearchAt, schedule: {search: 0}}, now), false); // only when asked
});

test('a new install has no scout of its own (the central index replaces it)', () => {
  assert.equal(crons({}, 0)['scout.yml'], null);
});
