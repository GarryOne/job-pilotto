// lib/storemove-steps.mjs processRows: the process table of each platform read into {pid, ppid, command} (the Windows one was missing: `ps -A` does not exist there).
import test from 'node:test';
import assert from 'node:assert/strict';
import {processRows} from '../lib/storemove-steps.mjs';

test('a Unix `ps` listing and a Windows Get-CimInstance listing give the same rows', () => {
  const unix = processRows('  10     1 /Applications/Job Pilotto\n 11 10 python -m src.stores.copy --from sqlite --to notion\n', 'darwin');
  const windows = processRows(JSON.stringify([{ProcessId: 10, ParentProcessId: 1, CommandLine: 'Job Pilotto.exe'}, {ProcessId: 11, ParentProcessId: 10, CommandLine: 'python.exe -m src.stores.copy --from sqlite --to notion'}, {ProcessId: 12, ParentProcessId: 10, CommandLine: null}]), 'win32');
  assert.deepEqual(unix.map(({pid, ppid}) => [pid, ppid]), [[10, 1], [11, 10]]);
  assert.deepEqual(windows.map(({pid, ppid}) => [pid, ppid]), [[10, 1], [11, 10], [12, 10]]);
  assert.ok(unix[1].command.includes('-m src.stores.copy') && windows[1].command.includes('-m src.stores.copy'));
  assert.equal(windows[2].command, '', 'a process whose command line is not readable is an empty command, not a crash');
});

test('a Windows listing of one process (PowerShell prints an object, not a list) and an empty one', () => {
  assert.equal(processRows(JSON.stringify({ProcessId: 7, ParentProcessId: 1, CommandLine: 'x'}), 'win32').length, 1);
  assert.deepEqual(processRows('', 'win32'), []);
});
