// lib/live-still.mjs: a live run ends 20 s after the page last changed (limit unchanged), never early on a slow page, and apply-live.mjs uses it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {STILL_SECONDS, signature, stillClock, stillSeconds} from '../lib/live-still.mjs';

// The run's loop in miniature: one reading a second, `at` seconds after the start; -> the second the run ends (or the limit).
const watch = (readingAt, {limit = 90, seconds = STILL_SECONDS, opened = () => true} = {}) => {
  const clock = stillClock({seconds, startedAt: 0});
  for (let at = 0; at <= limit; at++) {
    clock.see(readingAt(at), at * 1000);
    if (clock.over(at * 1000, {opened: opened(at)})) return at;
  }
  return limit;
};

test('the default is 20 s, LIVE_STILL_SECONDS changes it, 0 turns it off', () => {
  assert.equal(stillSeconds({}), 20);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: '30'}), 30);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: '0'}), 0);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: 'x'}), 0, 'a value that is not a number is off, said by the log, never a silent default');
});

test('a page that loaded at 10 s and then stays still ends 20 s after its last change', () => {
  assert.equal(watch(at => signature({shape: at < 10 ? 'blank' : 'form:6'})), 30);
});

test('a LATE form (drawn after a spinner, at 35 s) is not cut off: the wait before it changes nothing, but every change moves the clock', () => {
  // 0-15 s: the posting; 15 s: the Apply tab opens on a spinner; 35 s: the spinner is replaced by the form (the LATE fixture's shape); the fill goes on until 50 s.
  const reading = at => signature({states: at < 15 ? ['posting'] : ['posting', 'tab'], shape: at < 15 ? 'posting' : at < 35 ? 'spinner' : 'form:9', logLines: at < 50 ? Math.floor(at / 2) : 25});
  assert.equal(watch(reading), 70, 'ended 20 s after the LAST change (the fill at 49 s), not at 20 s or 35 s');
  assert.ok(watch(reading) > 35, 'never before the late form appeared');
});

test('a quiet page that never changes ends at 20 s once the posting is open; before it is open the run goes on to its limit', () => {
  assert.equal(watch(() => signature({shape: 'posting'})), 20);
  assert.equal(watch(() => signature({shape: 'blank'}), {opened: () => false}), 90, 'Apply never opened: the limit and its own error decide');
});

test('the limit still holds, and off means off', () => {
  assert.equal(watch(at => signature({logLines: at}), {limit: 90}), 90, 'a page that keeps changing runs to the limit');
  assert.equal(watch(() => signature({}), {seconds: 0}), 90);
});

test('apply-live.mjs ends the watch by this clock and says why', () => {
  const source = fs.readFileSync(new URL('../lib/apply-live.mjs', import.meta.url), 'utf8');
  assert.match(source, /stillClock\(/);
  assert.match(source, /clock\.over\(Date\.now\(\)/);
  assert.match(source, /watched \$\{Math\.round\(\(Date\.now\(\) - started\) \/ 1000\)\}s; frames in/, 'the end-of-watch line keeps the shape runFinished reads');
});
