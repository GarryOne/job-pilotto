// The session log's wheel: it scrolls the log, except for a live Claude on its own full screen.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {passWheel, wheelLines} from '../renderer/wheel.js';

test('the wheel goes to a running Claude that asked for the mouse; otherwise it scrolls the log', () => {
  assert.equal(passWheel({live: true, mouse: true}), true);
  assert.equal(passWheel({live: false, mouse: true}), false);  // ended or restored: nothing reads it
  assert.equal(passWheel({live: true, mouse: false}), false);
});

test('wheel deltas become whole lines, the rest carried to the next event', () => {
  assert.deepEqual(wheelLines({deltaY: 3, deltaMode: 1}, 30, 16), {lines: 3, carry: 0});
  assert.equal(wheelLines({deltaY: 1, deltaMode: 2}, 30, 16).lines, 30);
  let step = wheelLines({deltaY: 10}, 30, 16);
  assert.equal(step.lines, 0);
  step = wheelLines({deltaY: 10}, 30, 16, step.carry);
  assert.equal(step.lines, 1);
  assert.equal(wheelLines({deltaY: -48}, 30, 16).lines, -3);
});
