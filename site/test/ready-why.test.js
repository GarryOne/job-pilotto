// Ready to send, why a night's forms wait (src/ready-why.js, 19 Oct 2026): every way a queued night can fail to start has its own fixed word on /state, and Fill now's night starts within one tick.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SILENT_MIN, whyOf} from '../src/ready-why.js';

const now = new Date('2026-10-19T12:36:00Z'), minutes = n => new Date(now.getTime() + n * 60000).toISOString();
const queued = [{state: 'queued'}, {state: 'queued'}, {state: 'queued'}];
const CASES = [   // [name, env, batch row, jobs, expected kind]
  ['fill time ahead', {READY_QUEUE: {}}, {state: 'queued', fill_at: minutes(800)}, queued, 'later'],
  ['due, the next check starts it', {READY_QUEUE: {}}, {state: 'queued', fill_at: minutes(-1)}, queued, 'soon'],
  ['no fill time: the next check starts it', {READY_QUEUE: {}}, {state: 'queued', fill_at: null}, queued, 'soon'],
  ['the Queue is not set up', {}, {state: 'queued', fill_at: null}, queued, 'no-queue'],
  ['told a moment ago', {READY_QUEUE: {}}, {state: 'running', expires_at: minutes(180 - 1)}, queued, 'starting'],
  ['told long ago, no form ever reported (the container failed to boot)', {READY_QUEUE: {}}, {state: 'running', expires_at: minutes(180 - SILENT_MIN - 1)}, queued, 'silent'],
  ['the night hit its cost cap', {READY_QUEUE: {}}, {state: 'capped', expires_at: minutes(60)}, queued, 'capped'],
];

test('every way a queued night cannot start has its own word', () => {
  for (const [name, env, row, jobs, kind] of CASES) assert.equal(whyOf(env, row, jobs, now)?.kind, kind, name);
  assert.equal(new Set(CASES.map(item => item[4])).size, CASES.length - 1, 'two due cases share "soon"');
});

test('a night whose first form reports, or with nothing left to fill, says nothing: the forms simply take turns', () => {
  const running = {state: 'running', expires_at: minutes(60)};
  assert.equal(whyOf({READY_QUEUE: {}}, running, [{state: 'filling', step: 'form', started_at: minutes(-5)}, {state: 'queued'}], now), null);
  assert.equal(whyOf({READY_QUEUE: {}}, {state: 'finished'}, [{state: 'prepared'}], now), null);
  assert.equal(whyOf({READY_QUEUE: {}}, {state: 'queued', fill_at: minutes(800)}, [{state: 'prepared'}], now), null);
});
