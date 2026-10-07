// Stop on a running task (owner, 7 Oct 2026: a search ran for an hour with no way to stop it): its command ends, the run is kept as
// "Stopped by you" (not a failure), and a task that runs the app's own code offers no Stop.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

function storage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stop-'));
  const files = {};
  return {files, settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
}
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 50)); };

test('Stop ends the running command at once and keeps the run as stopped by you', async () => {
  const s = storage(), started = Date.now();
  const done = pipeline.task(s, 'scout', ['timeit', '-n', '1', '-r', '1', 'import time; time.sleep(30)'], () => {});
  await until(() => pipeline.running()?.stoppable && Date.now() - started > 300);
  assert.equal(pipeline.running()?.stoppable, true);
  assert.deepEqual(pipeline.stopTask(), {ok: true, kind: 'scout'});
  const {ok, run} = await done;
  assert.equal(ok, false);
  assert.equal(run.stopped, 'you');
  assert.match(run.summary, /^Stopped by you/);
  assert.ok(Date.now() - started < 10000, 'it did not wait for the 30 s command');
  assert.ok(run.log.some(line => line.startsWith('⏹ Stopped by you')));
  assert.equal(pipeline.stopTask().ok, false, 'nothing runs any more');
});

test("the app's own work (Tailor CVs, Find employers in Chrome) offers no Stop", async () => {
  let seen = null;
  await pipeline.work(storage(), 'tailor', () => {}, async () => { seen = pipeline.running(); assert.equal(pipeline.stopTask().ok, false); return true; });
  assert.equal(seen.stoppable, false);
});
