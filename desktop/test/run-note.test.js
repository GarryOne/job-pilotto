// A run says what it is for beyond its kind (7 Oct 2026: Re-score started a refresh that showed only as "Refresh jobs"): the note is on the queued
// row, on the running run (also when a click joins it) and on the finished record in runs.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

test('a note follows the run: queued, joined while running, finished', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-note-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  try {
    const first = pipeline.task(storage, 'insight', ['http.server', '0', '--bind', '127.0.0.1'], () => {});
    for (let waited = 0; !pipeline.running() && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(pipeline.running()?.note, undefined, 'no note asked for: none shown');
    const joined = pipeline.task(storage, 'insight', ['http.server', '0', '--bind', '127.0.0.1'], () => {}, 'you', {note: 'Re-scoring 75 older scores'});
    assert.equal(joined, first, 'the click joined the running task');
    assert.equal(pipeline.running()?.note, 'Re-scoring 75 older scores', 'the running run now says it');
    const waiting = pipeline.task(storage, 'weekly', ['no_such_module_for_this_test'], () => {}, 'you', {note: 'Asked from Strategy'});
    assert.deepEqual(pipeline.queued().map(item => [item.kind, item.note]), [['weekly', 'Asked from Strategy']], 'the queued row says it');
    pipeline.stopRunning();
    await Promise.all([first, waiting]);
    assert.equal(pipeline.runs(storage).find(run => run.kind === 'insight')?.note, 'Re-scoring 75 older scores', 'kept on the finished run');
  } finally {
    const reaper = setInterval(() => pipeline.stopRunning(), 200);
    await pipeline.whenIdle(100);
    clearInterval(reaper);
  }
});
