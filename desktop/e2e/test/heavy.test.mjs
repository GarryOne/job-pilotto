// lib/heavy.mjs: an e2e entry point re-runs itself under the heavy-run lock, and only when it is the main script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {heavy} from '../lib/heavy.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const script = here + 'suite.mjs';
const calls = [];
const fake = {run: (...call) => { calls.push(call); return {status: 7}; }, exit: code => calls.push(['exit', code])};

test('the main script re-runs itself under the lock and exits with the run\'s code', () => {
  calls.length = 0;
  assert.equal(heavy('e2e-jobs', pathToFileURL(script).href, {argv: ['node', script, 'jobs'], env: {}, ...fake}), true);
  assert.equal(calls[0][0], 'bash');
  assert.match(calls[0][1][0], /tools\/heavy-lock\.sh$/);
  assert.equal(calls[0][1][1], 'e2e-jobs');
  assert.deepEqual(calls[0][1].slice(-2), [script, 'jobs']);
  assert.deepEqual(calls[1], ['exit', 7]);
});

test('an import, a held lock, the off switch and --list do nothing', () => {
  for (const [argv, env] of [[['node', here + 'other.mjs'], {}], [['node', script], {JP_HEAVY_HELD: '1'}], [['node', script], {JOB_PILOTTO_HEAVY: '0'}], [['node', script, '--list'], {}]]) {
    calls.length = 0;
    assert.equal(heavy('x', pathToFileURL(script).href, {argv, env, ...fake}), false);
    assert.equal(calls.length, 0);
  }
});

test('every heavy entry point calls it (a new browser suite entry must too)', () => {
  for (const file of ['suite.mjs', 'run-all.mjs', 'smoke.mjs']) assert.match(fs.readFileSync(here + file, 'utf8'), /heavy\(['`][$\w{}.\[\]-]+['`], import\.meta\.url\)/, file);
});
