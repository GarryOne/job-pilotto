// A real run, end to end: the child is spawned, its output is written to logs/engine.log, and the run's two markers
// go to logs/app.log. The suite had no test for this path, which is how "engineLog is not defined" — a ReferenceError
// that broke *every* run from the app — shipped with 536 tests passing (1 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as engineLog from '../lib/engine-log.js';
import {log, logTo} from '../lib/log.js';
import * as pipeline from '../lib/pipeline.js';

test('a run is written down: engine.log takes its output, app.log its two markers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-run-'));
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  logTo(dir);
  engineLog.setFile(path.join(dir, 'engine.log'));
  // A module that cannot exist: python fails at once (no stdin to wait on), so the failure path is what is logged.
  const {code} = await pipeline.run(storage, ['no_such_module_for_this_test']);
  assert.notEqual(code, 0);
  const engine = fs.readFileSync(path.join(dir, 'engine.log'), 'utf8');
  assert.match(engine, /---- python -m no_such_module_for_this_test\n/);          // the header, before the output
  assert.match(engine, /No module named no_such_module_for_this_test/);           // the engine's own words
  assert.match(engine, /---- exit \d+ after \d+s/);                               // and the exit line
  assert.ok(engine.indexOf('---- python -m') < engine.indexOf('No module named'));
  const app = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.match(app, /\[run\] start: python -m no_such_module_for_this_test/);
  assert.match(app, /\[run\] end: python -m no_such_module_for_this_test -> exit \d+ in \d+s/);
  logTo(null);
  engineLog.setFile(null);
});
