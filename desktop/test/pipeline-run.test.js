// A real run, end to end: the child is spawned, its output is written to logs/engine.log, and the run's two markers
// go to logs/app.log. The suite had no test for this path, which is how "engineLog is not defined" — a ReferenceError
// that broke *every* run from the app — shipped with 536 tests passing (1 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as engineLog from '../lib/engine-log.js';
import {logTo} from '../lib/log.js';
import * as pipeline from '../lib/pipeline.js';

test('a run is written down: engine.log takes its output, app.log its two markers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-run-'));
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  logTo(dir);
  engineLog.setFile(path.join(dir, 'engine.log'));
  // A module that cannot exist: python fails at once (no stdin to wait on), so the failure path is what is logged.
  const {code, runId} = await pipeline.run(storage, ['no_such_module_for_this_test']);
  assert.notEqual(code, 0);
  assert.match(runId, /^[0-9a-f]+$/);
  const engine = fs.readFileSync(path.join(dir, 'engine.log'), 'utf8');
  assert.match(engine, new RegExp(`---- python -m no_such_module_for_this_test run_id=${runId}\\n`));  // the header, before the output
  assert.match(engine, /No module named no_such_module_for_this_test/);           // the engine's own words
  assert.match(engine, new RegExp(`---- exit \\d+ after \\d+s run_id=${runId}`));  // and the exit line, same id
  assert.ok(engine.indexOf('---- python -m') < engine.indexOf('No module named'));
  const app = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.match(app, new RegExp(`\\[run\\] start: python -m no_such_module_for_this_test \\{"run_id":"${runId}"\\}`));
  assert.match(app, new RegExp(`\\[run\\] end: python -m no_such_module_for_this_test -> exit \\d+ in \\d+s \\{"run_id":"${runId}"`));
  logTo(null);
  engineLog.setFile(null);
});

test('a run that stops talking is stopped, says so, and is reported as a failed run with the reason', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-watchdog-'));
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  logTo(dir);
  engineLog.setFile(path.join(dir, 'engine.log'));
  const saved = {...pipeline.LIMITS};
  Object.assign(pipeline.LIMITS, {idleMs: 600, totalMs: 60000, checkMs: 100, killAfterMs: 500, watchAll: true});
  const ended = [];
  pipeline.onRunEnd(item => ended.push(item));
  const lines = [];
  // `http.server` prints one line and then waits for connections forever: a run that goes quiet.
  const started = Date.now();
  const {code, timedOut} = await pipeline.run(storage, ['http.server', '0', '--bind', '127.0.0.1'], line => lines.push(line));
  Object.assign(pipeline.LIMITS, saved);
  assert.ok(Date.now() - started < 8000, 'stopped within seconds, not left running');
  assert.notEqual(code, 0);
  assert.match(timedOut, /no output for/);
  assert.ok(lines.some(line => /Stopped by Job Pilotto: no output for/.test(line)), 'the log says why');
  assert.match(ended.at(-1).timedOut, /no output for/);                                    // the technical report gets the reason
  assert.match(fs.readFileSync(path.join(dir, 'app.log'), 'utf8'), /\[run\] watchdog: python -m http\.server/);
  logTo(null);
  engineLog.setFile(null);
});

test('a stopped run says what to do next, and keeps the prefix the log and tests match (#185)', async () => {
  const {stoppedReason} = await import('../lib/pipeline.js');
  const text = stoppedReason('no output for 10 s');
  assert.match(text, /^Stopped by Job Pilotto: no output for 10 s\./);
  assert.match(text, /Run it again/);
  assert.match(text, /check your AI key or plan in Settings/);
});
