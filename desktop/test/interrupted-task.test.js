// A task the app can't start again (Find employers in Chrome, Tailor CVs) that was running when the app quit stays in Recent activity as Interrupted, with its
// log (7 Oct 2026: Find employers in Chrome vanished from the list after a restart). A search, which is started again, is still handed back to resume.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import {runStatus} from '../renderer/run-status.js';

test('quit during a task that is not resumed: listed as Interrupted with what it said', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-interrupted-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  let finish;
  const done = pipeline.work(storage, 'visits', () => {}, async tee => {
    tee('Reading 3 sites in your browser, 2 at a time');
    tee('Reading LinkedIn in your browser…');
    await new Promise(resolve => { finish = resolve; });
    return true;
  });
  for (let waited = 0; !finish && waited < 2000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  pipeline.freezeQueue(storage);                       // the app quits now (lib/lifecycle.js)
  const resumable = pipeline.takeQueue(storage);       // the next start (lib/resume-queue.js)
  assert.deepEqual(resumable, [], 'nothing to start again');
  const row = pipeline.runs(storage)[0];
  assert.equal(row.kind, 'visits');
  assert.equal(row.interrupted, true);
  assert.deepEqual(row.log.slice(0, 2), ['Reading 3 sites in your browser, 2 at a time', 'Reading LinkedIn in your browser…']);
  assert.match(row.log.at(-1), /^Interrupted: Job Pilotto was closed while this ran/);
  assert.deepEqual(runStatus(row, false), ['Interrupted', 'warn']);
  finish();
  await done;
});
