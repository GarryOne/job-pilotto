// The Windows e2e is started by the Mac run when it tested something: the same suites, the AI review as on the Mac, and a commit Windows already tested is not run again.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {macSuites, plan, testedBefore} from '../plan-windows.mjs';

const job = (name, conclusion = 'success') => ({name, conclusion});

test('the suites that ran on the Mac run on Windows; skipped ones and the plan, promote and Windows jobs do not', () => {
  const jobs = [job('plan'), job('jobs'), job('quality', 'failure'), job('apply', 'skipped'), job('promote', 'skipped'), job('Windows follows', 'in_progress')];
  assert.deepEqual(macSuites(jobs), ['jobs', 'quality']);
  assert.deepEqual(plan({mac: {jobs}, sha: 'abc', review: true}), {suites: ['jobs', 'quality'], review: true});
});

test('a commit Windows already tested is not run again; a cancelled or empty earlier run does not count', () => {
  const runs = [{id: 1, title: 'Windows abc', conclusion: 'success', suitesRan: 13}, {id: 2, title: 'Windows abc', conclusion: 'cancelled', suitesRan: 5},
    {id: 3, title: 'Windows abc', conclusion: 'success', suitesRan: 0}, {id: 4, title: 'Windows def', conclusion: 'success', suitesRan: 13}];
  assert.deepEqual(testedBefore(runs, 'abc', 9).map(run => run.id), [1]);
  assert.deepEqual(testedBefore(runs, 'xyz', 9), []);
  const skipped = plan({mac: {jobs: [job('jobs')]}, sha: 'abcdef123', previous: [{id: 1}]});
  assert.deepEqual(skipped.suites, []);
  assert.match(skipped.why, /already tested on Windows \(run 1\)/);
});

test('a run by hand takes the named suites, or every suite', () => {
  assert.deepEqual(plan({only: 'jobs, focus', all: ['a']}).suites, ['jobs', 'focus']);
  assert.equal(plan({only: 'jobs'}).review, false, 'by hand: no review unless asked');
  assert.equal(plan({only: 'jobs', review: true}).review, true, "the release run's Windows gate: the Mac + Linux gate's review");
  assert.deepEqual(plan({all: ['a', 'b']}).suites, ['a', 'b']);
});
