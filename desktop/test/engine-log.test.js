// What a run printed is kept: <data folder>/logs/engine.log, one rolling file, a header per run and its exit. Before
// this, a local run's output only existed in the window and was lost on reload (1 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as engineLog from '../lib/engine-log.js';

test('a run is written down between its two markers, and nothing is written without a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-engine-'));
  const file = path.join(dir, 'engine.log');
  engineLog.setFile(null);
  engineLog.start(['src.daily', '--mode', 'run']);
  engineLog.line('this line has no file to go to');       // no file set: silently dropped, never a crash
  engineLog.setFile(file);
  engineLog.start(['src.daily', '--mode', 'run'], new Date('2026-10-01T08:00:00Z'));
  engineLog.line('crawled 12 feeds, 3 new jobs');
  engineLog.line('scored 3 jobs');
  engineLog.end({code: 0, seconds: 42}, new Date('2026-10-01T08:00:42Z'));
  const written = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(written.length, 4);
  assert.equal(written[0], '2026-10-01T08:00:00.000Z ---- python -m src.daily --mode run');
  assert.equal(written[1], 'crawled 12 feeds, 3 new jobs');
  assert.equal(written[3], '2026-10-01T08:00:42.000Z ---- exit 0 after 42s');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('no file to go to'));
  assert.equal(engineLog.logPath(), file);
  engineLog.setFile(null);
});
