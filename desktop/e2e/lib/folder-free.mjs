// Waits until a folder is no longer held by a process that outlived the app (Windows: a child's working directory or open handle keeps the folder, not its files, from being renamed
// or removed). The reset and the import of the next start need exactly that; a relaunch before it failed them (17 Oct 2026, Windows settings). Guarded by test/folder-free.test.mjs.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// -> the milliseconds waited; throws after `timeout` with the last error, so a holder that never leaves is said, not hidden by a later vague failure.
// The processes that could be the holder, named when the wait gives up (Windows): every python / pip / node / chrome / electron process with its parent and command line, so the failure says
// which child outlived the app instead of "held by a process" (18 Oct 2026: the add-on setup's pip). -> one line per process, or ''.
export function holders({run = spawnSync, platform = process.platform, dir = ''} = {}) {
  if (platform !== 'win32') return '';
  // Also any process whose command line names the folder (beta run 7, 22 Oct: the holder was none of the listed names, and the 8 s shell may have timed out).
  const named = dir ? ` -or $_.CommandLine -like '*${String(dir).split(/[\\/]/).pop().replace(/'/g, "''")}*'` : '';
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python|pip|node|chrome|electron|tar|conhost|powershell|cmd|explorer'${named} } | ForEach-Object { "$($_.ProcessId) <- $($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }`;
  try { return String(run('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8', timeout: 15000, windowsHide: true}).stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => line.slice(0, 220)).slice(0, 25).join(' | '); } catch { return ''; }
}

// Windows: end the leftovers of THIS run's app (its processes carry the run's own throwaway folder name in their command line: --user-data-dir=...\\jp-e2e-xxxx) once the wait
// has run `endAfter` ms (beta 17, 24 Oct: the app's main, gpu and crashpad-handler processes outlived the exit and held the folder 20 s). -> the process ids ended, or [].
export function endLeftovers({run = spawnSync, platform = process.platform, dir = ''} = {}) {
  const name = String(dir).split(/[\\/]/).pop();
  if (platform !== 'win32' || !/^jp-e2e-/.test(name)) return [];
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${name.replace(/'/g, "''")}*' -and $_.ProcessId -ne $PID -and $_.Name -match 'electron|python|node|crashpad' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  try { return String(run('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8', timeout: 15000, windowsHide: true}).stdout || '').trim().split(/\r?\n/).filter(Boolean); } catch { return []; }
}

export async function waitForFolderFree(dir, {timeout = 20000, every = 250, endAfter = 8000, rename = fs.renameSync, exists = fs.existsSync, who = () => holders({dir}), end = () => endLeftovers({dir})} = {}) {
  const aside = `${dir}.probe`;
  let waited = 0;
  let ended = false;
  while (exists(dir)) {
    try { rename(dir, aside); rename(aside, dir); return waited; } catch (error) {
      if (!LOCKED.has(error.code)) throw error;
      if (waited >= timeout) throw new Error(`the data folder stayed held by a process after the app exited (${waited / 1000} s): ${error.message}${who() ? `; processes still running: ${who()}` : ''}`);
      if (!ended && waited >= endAfter) { ended = true; const gone = end(); if (gone.length) console.log(`  the data folder was still held after ${waited / 1000} s: ended its leftover processes ${gone.join(', ')}`); }
      await pause(every); waited += every;
    }
  }
  return waited;
}
