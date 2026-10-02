import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watch} from '../lib/notify-watch.js';

function run(emit) {
  const note = new EventEmitter(), seen = [];
  let fire = null;
  watch(note, {onShown: () => seen.push('shown'), onFailed: () => seen.push('failed'), onMissing: () => seen.push('missing'),
    timer: fn => { fire = fn; return 1; }, clear: () => { fire = null; }});
  if (emit) note.emit(emit);
  fire?.();
  return seen;
}

test('a notification macOS shows is delivered, and nothing else happens', () => assert.deepEqual(run('show'), ['shown']));
test('a notification macOS refuses is reported as failed', () => assert.deepEqual(run('failed'), ['failed']));
test('a notification macOS never confirms (not allowed for this app) falls back after the wait', () => assert.deepEqual(run(null), ['missing']));
