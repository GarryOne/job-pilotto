// Owns: killTree(), how a run of the engine is ended together with everything it started (pip, a browser…), per platform. Used by lib/pipeline-run.js and lib/pipeline-queue.js.
// Guarded by: test/kill-tree.test.js.
import {spawnSync} from 'node:child_process';

// Ends a run and everything it started. A run is its own process group on Mac/Linux and its tree on Windows: the add-on setup's `pip install --target <data folder>` (a grandchild)
// outlived the app, kept the folder from being renamed on Windows, and a Reset or Import failed with EPERM (18 Oct 2026, Windows settings suite); on Mac/Linux it would keep
// writing into the folder orphaned. Windows: taskkill /T. Elsewhere: the engine is spawned detached (a group of its own), and the signal goes to the whole group.
// Guard: test/pipeline-run.test.js (a grandchild is gone after the stop, per platform branch).
export function killTree(child, {platform = process.platform, run = spawnSync, signal = 'SIGTERM', kill = process.kill.bind(process)} = {}) {
  if (platform === 'win32') {
    if (child.pid) { try { run('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000}); return; } catch {} }
  } else if (child.pid) { try { kill(-child.pid, signal); return; } catch {} }
  try { child.kill(signal); } catch {}
}
