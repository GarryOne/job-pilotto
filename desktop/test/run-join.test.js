// Run pressed for a task that is already RUNNING joins it: no second run queued behind it (2 Oct 2026, found by the activity e2e suite: a second request seconds
// after the first ran the whole search again). Only the same kind joins; another task still waits its turn.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

test('a task asked for while it is running joins the running one; another task queues', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-join-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  try {
  // `http.server` prints one line and then waits for connections forever: a task that is running.
  const first = pipeline.task(storage, 'insight', ['http.server', '0', '--bind', '127.0.0.1'], () => {});
  for (let waited = 0; !pipeline.running() && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(pipeline.running()?.kind, 'insight', 'the first task is running');
  const second = pipeline.task(storage, 'insight', ['http.server', '0', '--bind', '127.0.0.1'], () => {});
  const other = pipeline.task(storage, 'weekly', ['no_such_module_for_this_test'], () => {});
  assert.equal(second, first, 'the second request joined the running task');
  assert.deepEqual(pipeline.queued().map(item => item.kind), ['weekly'], 'only the other task waits');
  pipeline.stopRunning();
  await Promise.all([first, other]);
  assert.equal(pipeline.runs(storage).filter(run => run.kind === 'insight').length, 1, 'one run, not two');
  } finally {   // whatever happened, nothing may be left running (a queued copy would start its own server)
    const reaper = setInterval(() => pipeline.stopRunning(), 200);
    await pipeline.whenIdle(100);
    clearInterval(reaper);
  }
});
