// Guards test/log-text.mjs: a run across midnight is read whole, and no test reads today's app.log or engine.log alone (main red at 00:00 UTC, 13 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {logText} from './log-text.mjs';

test('a run that crossed midnight is read from yesterday\'s file and today\'s', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-log-text-'));
  fs.writeFileSync(path.join(dir, 'engine-2026-10-11.log'), 'older\n');
  fs.writeFileSync(path.join(dir, 'engine-2026-10-12.log'), '---- python -m x run_id=1\n');
  fs.writeFileSync(path.join(dir, 'engine.log'), '---- exit 0 run_id=1\n');
  fs.writeFileSync(path.join(dir, 'app-2026-10-12.log'), 'not this log\n');
  assert.equal(logText(path.join(dir, 'engine.log')), 'older\n---- python -m x run_id=1\n---- exit 0 run_id=1\n');
  assert.equal(logText(path.join(dir, 'nothing.log')), '');
});

test('no test reads today\'s app.log or engine.log alone', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const direct = /readFileSync\([^)]*'(?:app|engine)\.log'/;
  const found = fs.readdirSync(here).filter(name => name.endsWith('.test.js'))
    .flatMap(name => fs.readFileSync(path.join(here, name), 'utf8').split('\n').map((line, i) => [name, i + 1, line]))
    .filter(([, , line]) => direct.test(line)).map(([name, n]) => `${name}:${n}`);
  assert.deepEqual(found, [], 'read it with logText (test/log-text.mjs): a run across midnight splits it over two day files');
});
