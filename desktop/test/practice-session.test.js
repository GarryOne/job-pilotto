// Interviews → Insights → "Start practice session": a guided rehearsal, step by step with a countdown (renderer/practice-session.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {begin, tick, toggle, finishStep, current, summary, clock, minutes, STEP_SECONDS} from '../renderer/practice-session.js';

const STEPS = [{text: 'Prepare 2-3 STAR examples.', title: 'Prepare three STAR stories', detail: 'Team unblocking', done: false},
  {text: 'Draft a 90-second tenure answer.', title: 'Rehearse your tenure answer', detail: '', done: true},
  {text: 'Name IoT protocols.', title: 'Refresh robotics protocols', detail: 'MQTT • CoAP', done: false}];

test('a session covers the steps still to do, five minutes each ("About 15 minutes" for three)', () => {
  const state = begin(STEPS);
  assert.deepEqual(state.steps.map(s => s.title), ['Prepare three STAR stories', 'Refresh robotics protocols']);
  assert.equal(minutes(3), 15);
  assert.equal(minutes(1), 5);
  assert.equal(minutes(0), 5);
  assert.deepEqual([state.index, state.remaining, state.running, state.finished], [0, STEP_SECONDS, false, false]);
  assert.equal(current(state).title, 'Prepare three STAR stories');
});

test('the countdown runs only while started, stops at zero, and can be paused', () => {
  let state = begin(STEPS);
  assert.equal(tick(state).remaining, STEP_SECONDS);  // not started: nothing counts
  state = toggle(state);
  state = tick(tick(state));
  assert.equal(state.remaining, STEP_SECONDS - 2);
  state = toggle(state);
  assert.equal(tick(state).remaining, STEP_SECONDS - 2);  // paused
  const nearly = {...toggle(state), remaining: 1};
  const over = tick(nearly);
  assert.deepEqual([over.remaining, over.running], [0, false]);
  assert.equal(clock(STEP_SECONDS), '5:00');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(0), '0:00');
});

test('finishing a step moves on with a fresh clock; after the last one the session is over and says what was done', () => {
  let state = toggle(begin(STEPS));
  state = finishStep(state, 'done');
  assert.deepEqual([state.index, state.remaining, state.running, state.finished], [1, STEP_SECONDS, false, false]);
  assert.equal(current(state).title, 'Refresh robotics protocols');
  state = finishStep(state, 'skipped');
  assert.equal(state.finished, true);
  assert.equal(current(state), null);
  assert.deepEqual(summary(state), {done: 1, skipped: 1, total: 2, doneSteps: [STEPS[0].text]});
  assert.equal(finishStep(state, 'done'), state);  // nothing left to finish
});

test('nothing left to practise: the session is over at once', () => {
  const state = begin([{...STEPS[0], done: true}]);
  assert.equal(state.finished, true);
  assert.deepEqual(summary(state), {done: 0, skipped: 0, total: 0, doneSteps: []});
});
