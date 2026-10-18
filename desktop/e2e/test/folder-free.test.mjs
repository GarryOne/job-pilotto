// The wait for a folder a leftover process may still hold: a lock is waited for, anything else is thrown at once, a holder that never leaves is said.
import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForFolderFree} from '../lib/folder-free.mjs';

const refusing = (times, code = 'EPERM') => { let left = times; const calls = []; return {calls, rename: (from, to) => { calls.push([from, to]); if (left > 0) { left -= 1; throw Object.assign(new Error(`${code}: rename ${from}`), {code}); } }}; };

test('a folder held for a while is waited for, then probed free and put back', async () => {
  const held = refusing(3);
  const waited = await waitForFolderFree('/p/data', {every: 1, rename: held.rename, exists: () => true});
  assert.equal(waited, 3);
  assert.deepEqual(held.calls.slice(-2), [['/p/data', '/p/data.probe'], ['/p/data.probe', '/p/data']]);
});

test('a folder that is not there needs no wait; an error that is not a lock is thrown at once', async () => {
  assert.equal(await waitForFolderFree('/p/none', {exists: () => false}), 0);
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, rename: refusing(1, 'ENOENT').rename, exists: () => true}), /ENOENT/);
});

test('a holder that never leaves is said after the timeout', async () => {
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, timeout: 5, rename: refusing(99).rename, exists: () => true}), /stayed held by a process after the app exited/);
});

test('holders: off Windows nothing is listed; on Windows the process lines are cut short and capped, and a failing shell gives nothing', async () => {
  const {holders} = await import('../lib/folder-free.mjs');
  assert.equal(holders({platform: 'darwin', run: () => assert.fail('no shell off Windows')}), '');
  const lines = Array.from({length: 40}, (_, index) => `${index} <- 1 python.exe ${'x'.repeat(400)}`).join('\r\n');
  const listed = holders({platform: 'win32', run: () => ({stdout: lines})}).split(' | ');
  assert.equal(listed.length, 25);
  assert.ok(listed.every(line => line.length <= 220));
  assert.equal(holders({platform: 'win32', run: () => { throw new Error('no powershell'); }}), '');
});

test('the give-up message names the processes still running when it can', async () => {
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, timeout: 5, rename: () => { throw Object.assign(new Error('EPERM x'), {code: 'EPERM'}); }, exists: () => true, who: () => '7 <- 1 pip.exe install --target data'}),
    /stayed held by a process.*processes still running: 7 <- 1 pip\.exe install --target data/);
});
