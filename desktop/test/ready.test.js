// Ready to send: the night's pick and the prepared state (desktop/lib/ready.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {complete, openAnswers, pickToPrepare, preparedState, settingsOf, DEFAULT_MIN_FIT, DEFAULT_PER_NIGHT} from '../lib/ready.js';

const job = (code, fit, extra = {}) => ({code, fit, status: 'unreviewed', url: `https://x.test/${code}`, kit: false, tailored: false, letter: false, ...extra});

test('the pick: open jobs from fit 60, best first, saved first, at most 10, nothing already complete', () => {
  const jobs = [job('a', 59), job('b', 60), job('c', 90), job('d', 70, {status: 'saved'}), job('e', 95, {status: 'applied'}), job('f', 80, {kit: true, tailored: true, letter: true}),
    job('g', 85, {kit: true}), job('h', 99, {url: ''}), job('i', 88, {ineligible: 'needs German'})];
  assert.deepEqual(pickToPrepare(jobs).map(j => j.code), ['d', 'c', 'g', 'b']);
  assert.deepEqual(pickToPrepare(Array.from({length: 30}, (_, n) => job(`j${n}`, 70 + (n % 20)))).length, DEFAULT_PER_NIGHT);
  assert.equal(pickToPrepare([job('a', 59)], {minFit: 50}).length, 1);
});

test('settings stay in range', () => {
  assert.deepEqual(settingsOf({}), {on: false, minFit: DEFAULT_MIN_FIT, perNight: DEFAULT_PER_NIGHT});
  assert.deepEqual(settingsOf({on: true, minFit: 500, perNight: 99}), {on: true, minFit: 100, perNight: 15});
  assert.equal(settingsOf({minFit: 'x', perNight: 0}).perNight, DEFAULT_PER_NIGHT);
});

test('prepared needs kit, tailored CV and letter, and no open answer; it never says verified', () => {
  const done = job('a', 80, {kit: true, tailored: true, letter: true});
  assert.ok(complete(done) && !complete({...done, letter: false}));
  assert.equal(preparedState(done, {answers: []}).state, 'prepared');
  assert.equal(preparedState({...done, letter: false}).state, 'todo');
  const waiting = preparedState(done, {answers: [{field: 'q1', answer: '', needs_review: false}, {field: 'q2', answer: 'Yes', needs_review: true}, {field: 'email', answer: '', needs_review: false}, {field: 'q3', answer: 'ok', needs_review: false}]});
  assert.deepEqual([waiting.state, waiting.open], ['waiting', 2]);
  assert.equal(preparedState(job('z', 80, {status: 'applied'})).state, 'none');
  assert.equal(preparedState({...done, ineligible: 'needs German'}).state, 'waiting');
  assert.equal(openAnswers(null).length, 0);
});
