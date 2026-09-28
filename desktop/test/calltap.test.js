import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as calltap from '../lib/calltap.js';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => setImmediate(() => child.emit('close', 0));
  return child;
}

test('peak of 16-bit PCM', () => {
  const chunk = Buffer.alloc(6);
  chunk.writeInt16LE(100, 0); chunk.writeInt16LE(-16384, 2); chunk.writeInt16LE(50, 4);
  assert.equal(calltap.peak(chunk), 0.5);
});

test('the app finds AudioTee in the package or the dev build', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-'));
  assert.equal(calltap.binary(root), null);
  fs.mkdirSync(path.join(root, 'desktop', 'build', 'bin'), {recursive: true});
  fs.writeFileSync(path.join(root, 'desktop', 'build', 'bin', 'audiotee'), '');
  assert.equal(calltap.binary(root), path.join(root, 'desktop', 'build', 'bin', 'audiotee'));
});

test('audio flows to the file with levels; stop waits for the file', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tap-')), 'call.pcm');
  const child = fakeChild(), levels = [];
  let args;
  const started = calltap.start('a', file, level => levels.push(level), (exe, a) => { args = a; return child; }, '/bin/audiotee');
  const chunk = Buffer.alloc(4); chunk.writeInt16LE(8192, 0);
  child.stdout.emit('data', chunk);
  assert.ok((await started).startedAt > 0);
  assert.deepEqual(args, ['--sample-rate', '16000', '--chunk-duration', '0.2']);
  assert.deepEqual(levels, [0.25]);
  await calltap.stop('a');
  assert.equal(fs.statSync(file).size, 4);
  assert.equal(await calltap.stop('a'), null);
});

test('a tap that fails to start says why; no binary is refused', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tap-')), 'call.pcm');
  const child = fakeChild();
  const started = calltap.start('b', file, () => {}, () => child, '/bin/audiotee');
  child.stderr.emit('data', '{"message_type":"error","data":{"message":"Tap creation failed"}}\n');
  child.emit('close', 1);
  await assert.rejects(started, /Tap creation failed/);
  await assert.rejects(calltap.start('c', file, () => {}, () => child, null), /not built/);
});
