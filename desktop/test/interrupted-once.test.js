// A run that ends after the quit froze it is listed once, as Interrupted (own file: the queue's frozen flag is module state).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

// One run is one row (21 Oct 2026: "Find jobs · Interrupted" and "Find jobs · Failed" with the same id, both drawn selected in Recent activity).
test('a run that ends after the quit froze it is listed once, as Interrupted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-interrupted-once-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  let finish;
  const done = pipeline.work(storage, 'visits', () => {}, async tee => {
    tee('Reading LinkedIn in your browser…');
    await new Promise(resolve => { finish = resolve; });
    return false;
  });
  for (let waited = 0; !finish && waited < 2000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  pipeline.freezeQueue(storage);
  pipeline.takeQueue(storage);
  finish();
  await done;
  const ids = pipeline.runs(storage).map(run => run.id);
  assert.equal(new Set(ids).size, ids.length, 'no two records share an id');
  assert.equal(pipeline.runs(storage).length, 1);
  assert.equal(pipeline.runs(storage)[0].interrupted, true);
});
