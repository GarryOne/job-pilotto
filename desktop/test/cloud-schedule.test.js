// Always on: the next time GitHub runs each job, from the schedule the app wrote to the user's repo (lib/schedule.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cloudNextAt} from '../lib/schedule.js';

const at = (text) => new Date(text).getTime();
const hhmm = ms => new Date(ms).toTimeString().slice(0, 5);

test('with Always on, the next jobs check, Gmail check and new-employers find come from the cloud schedule', () => {
  const settings = {cloud: {repo: 'me/job-pilotto-private'}, schedule: {search: 4, mail: 3, scout: 'daily'}};
  const next = cloudNextAt(settings, at('2026-09-29T13:10:00'));  // local time
  assert.equal(hhmm(next.search), '15:30');   // 07:30, 11:30, 15:30, 19:30, 23:30, 03:30
  assert.equal(hhmm(next.mail), '18:00');     // 07:00, 12:00, 18:00
  assert.equal(hhmm(next.scout), '08:15');    // tomorrow
  assert.equal(new Date(next.scout).getDate(), 30);
});

test('off in the schedule, or no Always on: no time', () => {
  assert.deepEqual(cloudNextAt({schedule: {search: 4}}), {search: null, mail: null, scout: null});
  const next = cloudNextAt({cloud: {repo: 'r'}, schedule: {search: 0, mail: 0, scout: 'off'}});
  assert.deepEqual(next, {search: null, mail: null, scout: null});
});
