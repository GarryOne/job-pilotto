// "Ready to submit" reads the same everywhere (owner, 19 Oct 2026: "how can we mark the jobs that are already ready to submit, filled on the server?"): one rule
// (ready-rows.js readyToSubmit) feeds the card's count, the Jobs list's chip, its filter and its markings. Each place below fails when it stops reading that rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from './tiny-dom.js';

install();
const {READY_LABEL, readyToSubmit} = await import('../renderer/pages/ready-rows.js');
const {statusPill} = await import('../renderer/jobs-view.js');
const {VIEWS, inView} = await import('../renderer/jobs-board-rules.js');
const {markReady, refreshReady} = await import('../renderer/pages/jobs-ready.js');

test('the rule: filled completely, not submitted, not deleted', () => {
  assert.equal(readyToSubmit({state: 'prepared'}), true);
  for (const row of [{state: 'partial'}, {state: 'wall'}, {state: 'failed'}, {state: 'queued'}, {state: 'prepared', submitted_at: 'x'}, {state: 'prepared', cleared_at: 'x'}, null]) assert.equal(readyToSubmit(row), false, JSON.stringify(row));
});

test('every place that shows it uses the same words and the same jobs', async () => {
  const jobs = [{code: 'a', status: 'unreviewed'}, {code: 'b', status: 'saved'}, {code: 'c', status: 'unreviewed'}, {code: 'd', status: 'applied'}];
  globalThis.window.pilot = {readyCodes: async () => ({ok: true, codes: ['a', 'b', 'd']})};
  let rerendered = 0;
  await refreshReady(jobs, () => { rerendered++; });
  assert.equal(rerendered, 1, 'the list is drawn again when the set changed');
  assert.deepEqual(jobs.map(job => job.ready), [true, true, false, true]);
  await refreshReady(jobs, () => { rerendered++; });
  assert.equal(rerendered, 1, 'the same set draws nothing again');
  const view = VIEWS.find(each => each.label === READY_LABEL);
  assert.ok(view, 'a filter chip carries the same words');
  assert.deepEqual(jobs.filter(job => inView(job, view.id)).map(job => job.code), ['a', 'b'], 'the filter counts what the chip marks; an applied job is not ready to submit any more');
  for (const job of jobs.filter(each => each.ready && each.status !== 'applied')) assert.deepEqual(statusPill(job), {label: READY_LABEL, tone: 'good'}, job.code);
  assert.notEqual(statusPill(jobs[2]).label, READY_LABEL);
  assert.notEqual(statusPill(jobs[3]).label, READY_LABEL, 'applied stays Applied');
  const fresh = [{code: 'a'}, {code: 'z'}];
  markReady(fresh);
  assert.deepEqual(fresh.map(job => job.ready), [true, false], 'a reloaded list is marked at once from the codes known');
});
