// A queued task taken out of the queue (Recent activity's "Remove", ⌘K) never starts, leaves queue.json, and the next one still runs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

test('a removed queued task never starts; the one after it still runs', async () => {
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', path: name => `/tmp/${name}`, readText: name => files[name] || '',
    writeText: (name, text) => { files[name] = text; }};
  let release;
  pipeline.serial(() => new Promise(resolve => { release = resolve; }));   // something is running
  const started = [];
  const tailor = pipeline.work(storage, 'tailor', () => {}, async () => { started.push('tailor'); return true; });
  const visits = pipeline.work(storage, 'visits', () => {}, async () => { started.push('visits'); return true; });
  const id = pipeline.queued().find(item => item.kind === 'tailor').id;
  assert.deepEqual(pipeline.unqueue(storage, id), {ok: true, kind: 'tailor'});
  assert.deepEqual(pipeline.queued().map(item => item.kind), ['visits'], 'gone from the list at once');
  assert.deepEqual(JSON.parse(files['queue.json']).map(job => job.kind), ['visits'], 'and from what a restart would start again');
  assert.equal(pipeline.unqueue(storage, id).ok, false, 'a second remove says it is no longer waiting');
  await new Promise(resolve => setImmediate(resolve));   // the lane starts its first task on a later tick
  release();
  assert.deepEqual(await tailor, {ok: false, removed: true, run: null});
  assert.equal((await visits).ok, true);
  assert.deepEqual(started, ['visits'], 'the removed task never ran');
});
