// The Playwright report runner never hangs a CI job after the suite decided its code (lib/report.mjs closeOrStop; 6 Oct 2026: wander passed, then hung 10 min).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {closeOrStop, codeFrom} from '../lib/report.mjs';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-report-test-')), 'code');
const node = script => spawn(process.execPath, ['-e', script], {stdio: 'ignore'});

test('a runner that stays open after the suite wrote its code is stopped, and the suite\'s own code is kept', async () => {
  const file = tmpFile(), lines = [];
  const child = node(`require('fs').writeFileSync(${JSON.stringify(file)}, '0'); setInterval(() => {}, 1000);`);   // decides, then never exits
  const started = Date.now();
  const exitCode = await closeOrStop(child, file, {graceMs: 300, pollMs: 50, log: line => lines.push(line)});
  assert.equal(exitCode, null);
  assert.ok(Date.now() - started < 5000, 'stopped within the grace, not left to the hard stop');
  assert.match(lines.join('\n'), /still open .* stopped/);
  assert.equal(codeFrom(file, exitCode), 0, 'the suite passed: a pass, not a crash');
  await new Promise(done => (child.exitCode !== null || child.signalCode ? done() : child.on('exit', done)));
});

test('a runner that closes on its own is waited for, never stopped, and a suite that never decided is no pass', async () => {
  const file = tmpFile(), lines = [];
  const exitCode = await closeOrStop(node(`setTimeout(() => process.exit(3), 400);`), file, {graceMs: 100, pollMs: 50, log: line => lines.push(line)});
  assert.equal(exitCode, 3, 'no code file: the grace never starts, however long the runner takes');
  assert.deepEqual(lines, []);
  assert.equal(codeFrom(file, exitCode), 3);
});
