// The Worker's cron triggers start the nightly build and the three-a-day e2e runs on time (src/scheduler.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CRONS, jobsFor, runScheduled, zurichHour} from '../src/scheduler.js';

const at = iso => new Date(iso);

test('the nightly build starts at 04:00 in Zurich, in summer (02:00 UTC) and in winter (03:00 UTC), and only then', () => {
  assert.equal(zurichHour(at('2026-10-05T02:00:00Z')), 4);   // UTC+2
  assert.equal(zurichHour(at('2026-12-05T03:00:00Z')), 4);   // UTC+1
  assert.deepEqual(jobsFor('0 2 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}]);
  assert.deepEqual(jobsFor('0 3 * * *', at('2026-10-05T03:00:00Z')), []);   // 05:00 in summer: not its turn
  assert.deepEqual(jobsFor('0 3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}]);
  assert.deepEqual(jobsFor('0 2 * * *', at('2026-12-05T02:00:00Z')), []);   // 03:00 in winter
});

test('the three-a-day e2e runs start the scheduled plan; an unknown cron starts nothing', () => {
  assert.deepEqual(jobsFor('47 9,13,17 * * *', at('2026-10-05T09:47:00Z')), [{workflow: 'e2e.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('1 1 * * *', at('2026-10-05T01:01:00Z')), []);
  assert.deepEqual(jobsFor('40 */3 * * *', at('2026-10-05T09:40:00Z')), [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the one nightly trigger fires at 02:00 UTC in summer');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T03:00:00Z')), [], 'and at 03:00 UTC it is 05:00 in summer: not its turn');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'in winter 03:00 UTC is 04:00');
  assert.ok(CRONS.length <= 4, 'the account has room for at most 5 cron triggers across all Workers');
  assert.deepEqual(CRONS, ['0 2,3 * * *', '47 9,13,17 * * *', '40 */3 * * *']);
});

test('a scheduled start calls the dispatcher; a failed one tells the owner, lets the others start, then fails the cron', async () => {
  const calls = [], told = [];
  const dispatch = async (env, inputs, workflow) => { calls.push([workflow, inputs]); };
  const started = await runScheduled({cron: '0 2 * * *', scheduledTime: Date.parse('2026-10-05T02:00:00Z')}, {}, {dispatch, notify: async text => told.push(text)});
  assert.deepEqual(started, ['desktop.yml']);
  assert.deepEqual(calls, [['desktop.yml', {nightly: 'true'}]]);
  const failing = async () => { throw new Error('GitHub dispatch failed: 403 Resource not accessible'); };
  await assert.rejects(runScheduled({cron: '47 9,13,17 * * *', scheduledTime: Date.parse('2026-10-05T09:47:00Z')}, {}, {dispatch: failing, notify: async text => told.push(text)}),
    /scheduled start failed: e2e\.yml: GitHub dispatch failed: 403/, 'a cron that started nothing must not report success (6 Oct 2026: a day of 401s, every cron "success")');
  assert.match(told[0], /e2e\.yml failed.*403/);
});
