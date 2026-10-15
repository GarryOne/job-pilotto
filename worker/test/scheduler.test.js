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
  assert.deepEqual(jobsFor('47 21,23,1 * * *', at('2026-10-05T09:47:00Z')), [{workflow: 'e2e.yml', inputs: {scheduled: 'true'}}, {workflow: 'site-replays.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T00:00:00Z')), [{workflow: 'site-replays.yml', inputs: {scheduled: 'true'}}], 'the replay gate: 02:00 Zurich in summer');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T01:00:00Z')), [], '03:00 in summer: nothing');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the nightly: 04:00 Zurich in summer');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-12-05T01:00:00Z')), [{workflow: 'site-replays.yml', inputs: {scheduled: 'true'}}], 'in winter 01:00 UTC is 02:00');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'and 03:00 UTC is 04:00');
  assert.deepEqual(jobsFor('1 1 * * *', at('2026-10-05T01:01:00Z')), []);
  assert.deepEqual(jobsFor('40 */3 * * *', at('2026-10-05T09:40:00Z')), [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the one nightly trigger fires at 02:00 UTC in summer');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T03:00:00Z')), [], 'and at 03:00 UTC it is 05:00 in summer: not its turn');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'in winter 03:00 UTC is 04:00');
  assert.ok(CRONS.length <= 3, 'the account has 5 cron triggers across ALL Workers and the others hold 2: a 4th here was refused (14 Oct 2026)');
  assert.deepEqual(CRONS, ['0 0,1,2,3 * * *', '47 21,23,1 * * *', '40 */3 * * *']);
});

test('a scheduled start calls the dispatcher; a failed one tells the owner, lets the others start, then fails the cron', async () => {
  const calls = [], told = [];
  const dispatch = async (env, inputs, workflow) => { calls.push([workflow, inputs]); };
  const started = await runScheduled({cron: '0 2 * * *', scheduledTime: Date.parse('2026-10-05T02:00:00Z')}, {}, {dispatch, notify: async text => told.push(text)});
  assert.deepEqual(started, ['desktop.yml']);
  assert.deepEqual(calls, [['desktop.yml', {nightly: 'true'}]]);
  const failing = async () => { throw new Error('GitHub dispatch failed: 403 Resource not accessible'); };
  await assert.rejects(runScheduled({cron: '47 21,23,1 * * *', scheduledTime: Date.parse('2026-10-05T09:47:00Z')}, {}, {dispatch: failing, notify: async text => told.push(text)}),
    /scheduled start failed: e2e\.yml: GitHub dispatch failed: 403/, 'a cron that started nothing must not report success (6 Oct 2026: a day of 401s, every cron "success")');
  assert.match(told[0], /e2e\.yml failed.*403/);
});

test('a renamed workflow is started under its other name when one is missing (until 21 Oct 2026)', async () => {
  const run = async missing => {
    const calls = [];
    const dispatch = async (env, inputs, workflow) => { calls.push(workflow); if (workflow === missing) throw new Error('GitHub dispatch failed: 404 Not Found'); };
    await runScheduled({cron: '0 0,1,2,3 * * *', scheduledTime: Date.parse('2026-10-05T00:00:00Z')}, {}, {dispatch});
    return calls;
  };
  assert.deepEqual(await run('site-replays.yml'), ['site-replays.yml', 'replay-offline.yml'], 'new name missing: the old one starts');
  assert.deepEqual(await run('replay-offline.yml'), ['site-replays.yml'], 'old name missing: the new one starts, no second try');
  const refused = async () => { throw new Error('GitHub dispatch failed: 403 nope'); };
  await assert.rejects(runScheduled({cron: '0 0,1,2,3 * * *', scheduledTime: Date.parse('2026-10-05T00:00:00Z')}, {}, {dispatch: refused}), /403/, 'only a 404 falls back');
});
