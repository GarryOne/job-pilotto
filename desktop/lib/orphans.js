// An engine run (`python -m src daily|check|scout|discover|feeds`) the app started and then lost: the app restarted, so the run's parent is now
// process 1 and nothing watches it (the app's watchdog, lib/pipeline.js LIMITS, only sees its own children). 5 Oct 2026: such a search hung for
// 20+ minutes, held the run lock, and "Prepare top matches" waited on it unseen. A run that is orphaned AND has used no CPU for QUIET_MS (or has lasted
// past the whole-run limit) is stopped; SIGTERM first, so the engine can close its own Notion row. Mac and Linux only (Windows ends the
// whole process tree with the app). A terminal run has a shell for a parent, never process 1, so it is never touched.
import {execFile} from 'node:child_process';

export const ORPHAN = {quietMs: 10 * 60 * 1000, totalMs: 45 * 60 * 1000, killAfterMs: 8000};
const ENGINE = /\s-m\s+src\s+(?:daily|check|scout|discover|feeds)\b/;

// "1-02:03:04", "03:04", "00:31.79" -> seconds.
export function seconds(text) {
  const [days, rest] = String(text).includes('-') ? String(text).split('-') : ['0', String(text)];
  const parts = rest.split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  return Number(days) * 86400 + parts.reduce((total, part) => total * 60 + part, 0);
}

// ps -axo pid=,ppid=,etime=,time=,command= -> [{pid, ppid, elapsed, cpu, command}] of orphaned engine runs only.
export function orphans(psOutput) {
  const found = [];
  for (const line of String(psOutput).split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match || match[2] !== '1' || !ENGINE.test(` ${match[5]}`)) continue;
    const elapsed = seconds(match[3]), cpu = seconds(match[4]);
    if (Number.isFinite(elapsed) && Number.isFinite(cpu)) found.push({pid: Number(match[1]), elapsed, cpu, command: match[5]});
  }
  return found;
}

// One sweep. `seen` (pid -> {cpu, since}) is kept between sweeps: since = when its CPU time last moved.
// Returns the runs to stop, each with why.
export function stale(runs, seen, now = Date.now(), limits = ORPHAN) {
  const alive = new Set(runs.map(run => run.pid));
  for (const pid of seen.keys()) if (!alive.has(pid)) seen.delete(pid);
  const stop = [];
  for (const run of runs) {
    const before = seen.get(run.pid);
    if (!before || run.cpu > before.cpu) seen.set(run.pid, {cpu: run.cpu, since: now});
    const quiet = now - seen.get(run.pid).since;
    if (run.elapsed * 1000 > limits.totalMs) stop.push({...run, why: `running ${Math.round(run.elapsed / 60)} min`});
    else if (quiet >= limits.quietMs) stop.push({...run, why: `no CPU use for ${Math.round(quiet / 60000)} min`});
  }
  return stop;
}

const ps = () => new Promise(resolve => execFile('ps', ['-axo', 'pid=,ppid=,etime=,time=,command='], {maxBuffer: 8e6}, (error, out) => resolve(error ? '' : out)));

// Check now and then; every stop is one line in app.log (what, how long, why), with no command-line values.
// onStopped(run) runs once the run is gone (SIGTERM lets it close its own Notion row; a SIGKILLed one cannot, so the caller closes it:
// otherwise the app listed the killed search as "Running" for 3 h, 5 Oct 2026).
export function watchOrphans(log, {every = 2 * 60 * 1000, limits = ORPHAN, list = ps, kill = process.kill.bind(process), onStopped = async () => {}, platform = process.platform} = {}) {
  if (platform === 'win32') return () => {};
  const seen = new Map();
  const sweep = async () => {
    for (const run of stale(orphans(await list()), seen, Date.now(), limits)) {
      log('run', 'stopping an engine run the app lost track of', {pid: run.pid, running_min: Math.round(run.elapsed / 60), why: run.why, decidedBy: 'orphan watchdog'});
      try { kill(run.pid, 'SIGTERM'); } catch { continue; }
      setTimeout(() => {
        try { kill(run.pid, 0); kill(run.pid, 'SIGKILL'); } catch {}
        setTimeout(() => Promise.resolve(onStopped(run)).catch(error => log('run', 'the stopped run\'s row was not closed', {pid: run.pid, error: error.message})), limits.killAfterMs / 4).unref?.();
      }, limits.killAfterMs).unref?.();
      seen.delete(run.pid);
    }
  };
  sweep();
  const timer = setInterval(sweep, every);
  timer.unref?.();
  return () => clearInterval(timer);
}
