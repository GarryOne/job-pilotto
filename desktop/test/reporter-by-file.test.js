// test/reporter-by-file.mjs: a line per test file (OK / FAILED), the error only for what failed, and a non-zero exit. (Run in a scratch folder: a failing test file of its own.)
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';

const reporter = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reporter-by-file.mjs');
const run = body => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reporter-'));
  fs.writeFileSync(path.join(dir, 'a.test.js'), `import test from 'node:test'; import assert from 'node:assert/strict';\n${body}`);
  const result = spawnSync(process.execPath, ['--test', `--test-reporter=${pathToFileURL(reporter).href}`, 'a.test.js'], {cwd: dir, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT'))});   // inside a test run this variable makes a nested `node --test` run nothing
  fs.rmSync(dir, {recursive: true, force: true});
  return result;
};

test('passing tests print one OK line for the file and a summary, with no per-test noise', () => {
  const result = run("test('adds', () => assert.equal(1 + 1, 2)); test('subtracts', () => assert.equal(3 - 1, 2));");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK {6}a\.test\.js {2}\(2 tests, \d+ ms\)$/m);
  assert.match(result.stdout, /OK: 1 files, 2 tests, 2 passed, 0 failed/);
  assert.ok(result.stdout.split('\n').length < 8, result.stdout);
});

test('a failing test prints FAILED, its name and its error; a failing subtest is listed once, not with its parent', () => {
  const result = run("test('the total', () => assert.equal(2 + 2, 5, 'two and two make four')); test('group', async t => { await t.test('inner bad', () => { throw new Error('boom'); }); });");
  assert.notEqual(result.status, 0, 'a failure fails the run');
  assert.match(result.stdout, /^FAILED {2}a\.test\.js/m);
  assert.match(result.stdout, /✖ the total[\s\S]*two and two make four/);
  assert.match(result.stdout, /✖ inner bad[\s\S]*boom/);
  assert.doesNotMatch(result.stdout, /✖ group/, 'the parent only says "1 subtest failed"');
  assert.doesNotMatch(result.stdout, /node:internal/, 'no runner frames');
  assert.match(result.stdout, /FAILED: 1 files, 2 tests, 0 passed, 2 failed/);
});
