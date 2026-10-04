// The Windows e2e follows each Mac run: the same suites, the AI review only where the Mac had it, never a canary or a soak of an old tag.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fromMacJobs, follows, plan} from '../plan-windows.mjs';

const job = (name, conclusion = 'success', review = 'success') => ({name, conclusion, steps: [{name: 'Run the suite', conclusion}, {name: 'AI review of the screenshots', conclusion: review}]});

test('the suites that ran on the Mac run on Windows; skipped ones and the plan or promote jobs do not', () => {
  const jobs = [{name: 'plan', conclusion: 'success'}, job('jobs'), job('quality', 'failure'), job('apply', 'skipped', 'skipped'), {name: 'promote', conclusion: 'skipped'}];
  assert.deepEqual(fromMacJobs(jobs), {suites: ['jobs', 'quality'], review: true});
  assert.equal(fromMacJobs([job('jobs', 'success', 'skipped')]).review, false, 'no AI review on the Mac: none on Windows');
});

test('a stable canary, an RC soak, or a cancelled Mac run is not followed; a run by hand takes the named suites', () => {
  assert.equal(follows({title: 'Stable canary desktop-v0.5.0', conclusion: 'success'}), false);
  assert.equal(follows({title: 'RC soak desktop-v0.5.1', conclusion: 'failure'}), false);
  assert.equal(follows({title: 'CI · End-to-end journey', conclusion: 'cancelled'}), false);
  assert.equal(follows({title: 'CI · End-to-end journey', conclusion: 'failure'}), true);
  assert.deepEqual(plan({only: 'jobs, focus', all: ['a']}).suites, ['jobs', 'focus']);
  assert.deepEqual(plan({all: ['a', 'b']}).suites, ['a', 'b'], 'by hand with no names: every suite');
  assert.deepEqual(plan({all: ['a'], mac: {title: 'RC soak x', conclusion: 'success', jobs: [job('jobs')]}}).suites, []);
});
