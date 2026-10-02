// The numbers the product learns from a job search: score bands, job states and the dismiss reasons. Counts only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {REASONS, jobState, scoreBucket, snapshot} from '../renderer/intel.js';

test('a fit score falls in one of four bands, or is unscored', () => {
  assert.deepEqual([0, 39, 40, 59, 60, 79, 80, 100].map(scoreBucket), ['0-39', '0-39', '40-59', '40-59', '60-79', '60-79', '80-100', '80-100']);
  for (const none of [null, undefined, '', 'high', NaN]) assert.equal(scoreBucket(none), 'unscored', String(none));
});

test('a job is new, saved, dismissed or at the stage its application reached', () => {
  assert.equal(jobState({status: 'unreviewed'}), 'new');
  assert.equal(jobState({}), 'new');
  assert.equal(jobState({status: 'saved'}), 'saved');
  assert.equal(jobState({status: 'dismissed'}), 'dismissed');
  assert.equal(jobState({status: 'applied', stage: 'Applying'}), 'applying');
  assert.equal(jobState({status: 'applied', stage: 'Confirmation received'}), 'applied');
  assert.equal(jobState({status: 'applied', stage: 'Interview scheduled'}), 'screening');
  assert.equal(jobState({status: 'applied', stage: 'Interviewing'}), 'interviewing');
  assert.equal(jobState({status: 'applied', stage: 'Offer'}), 'offer');
  assert.equal(jobState({status: 'applied', stage: 'No response'}), 'no_response');
  assert.equal(jobState({status: 'applied'}), 'applied');
});

test('the snapshot is counts per band and state, and carries nothing that identifies a job', () => {
  const jobs = [{fit: 85, status: 'applied', stage: 'Applied', title: 'Secret role', company: 'Secret Co', url: 'https://x.test/1'}, {fit: 82, status: 'applied', stage: 'Applied', title: 'Another', company: 'Co', url: 'u'},
    {fit: 45, status: 'dismissed'}, {fit: null, status: 'unreviewed'}, {fit: 62, stage: 'Interviewing', status: 'applied'}];
  const shot = snapshot(jobs);
  assert.deepEqual(shot.sort((a, b) => (a.bucket + a.state).localeCompare(b.bucket + b.state)), [
    {bucket: '40-59', state: 'dismissed', n: 1}, {bucket: '60-79', state: 'interviewing', n: 1}, {bucket: '80-100', state: 'applied', n: 2}, {bucket: 'unscored', state: 'new', n: 1}]);
  assert.doesNotMatch(JSON.stringify(shot), /Secret|Another|x\.test/);
  assert.deepEqual(snapshot(undefined), []);
  assert.deepEqual(REASONS.map(reason => reason.id), ['seniority', 'location', 'tech', 'company', 'role', 'other']);   // the site's fixed list
});
