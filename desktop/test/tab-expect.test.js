// The app opened a form tab and the extension must take it: the expectation resolves, misses name the failed step, and cancelled or slept-through windows never report.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTabExpect, WINDOW_MS} from '../lib/tab-expect.js';

function setup(over = {}) {
  const state = {t: 1_000_000, bound: new Set(), live: new Set(['s1']), seen: {at: 1_000_000 - 5000, version: '0.9.240'}, records: []};
  const tracker = createTabExpect({now: () => state.t, record: fields => state.records.push(fields), isBound: id => state.bound.has(id),
    isLive: id => state.live.has(id), extensionSeen: () => state.seen, ...over});
  const advance = ms => { for (let spent = 0; spent < ms; spent += 5000) { state.t += Math.min(5000, ms - spent); tracker.tick(); } };
  return {state, tracker, advance};
}

test('a tab the extension binds in time is confirmed, once, with how long it took', () => {
  const {state, tracker, advance} = setup();
  tracker.expect('s1'); advance(5000); state.bound.add('s1'); advance(5000); advance(60000);
  assert.deepEqual(state.records.map(r => r.outcome), ['taken']);
  assert.equal(state.records[0].ms, 10000);
});

test('no tab bound after the window, the extension checked in: tab_not_taken', () => {
  const {state, tracker, advance} = setup();
  tracker.expect('s1'); advance(WINDOW_MS + 5000);
  assert.deepEqual(state.records.map(r => r.outcome), ['tab_not_taken']);
});

test('no tab bound and the extension never checked in (or went quiet): extension_silent', () => {
  for (const seen of [null, {at: 1_000_000 - 200_000, version: '0.9.240'}]) {
    const {state, tracker, advance} = setup({extensionSeen: () => seen});
    tracker.expect('s1'); advance(WINDOW_MS + 5000);
    assert.deepEqual(state.records.map(r => r.outcome), ['extension_silent']);
  }
});

test('a cancelled or ended session is never reported', () => {
  const {state, tracker, advance} = setup();
  tracker.expect('s1'); advance(5000); state.live.delete('s1'); advance(WINDOW_MS * 2);
  assert.deepEqual(state.records, []);
});

test('a tab nobody expected is never reported (one the person opened)', () => {
  const {state, advance} = setup();
  advance(WINDOW_MS * 3);
  assert.deepEqual(state.records, []);
});

test('an app that slept through the window is not blamed on the extension', () => {
  const {state, tracker, advance} = setup();
  tracker.expect('s1'); state.t += 10 * 60 * 1000; tracker.tick();   // one tick after ten minutes asleep
  assert.deepEqual(state.records, []);
  advance(WINDOW_MS + 5000);   // a fresh window passed awake: now it may report
  assert.equal(state.records.length, 1);
});

test('a miss in Review in form is reported with the step that failed', () => {
  const {state, tracker} = setup();
  tracker.miss('wake_failed'); tracker.miss('join_empty');
  assert.deepEqual(state.records.map(r => r.outcome), ['wake_failed', 'join_empty']);
});

test('opening the same session again restarts its window, never two reports', () => {
  const {state, tracker, advance} = setup();
  tracker.expect('s1'); advance(15000); tracker.expect('s1'); advance(15000);
  assert.deepEqual(state.records, []);
  advance(10000);
  assert.deepEqual(state.records.map(r => r.outcome), ['tab_not_taken']);
});
