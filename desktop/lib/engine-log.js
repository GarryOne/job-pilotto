// What the engine printed, in full: <data folder>/logs/engine.log, one file per day (see below). The app's own log says a run
// started and ended; the run's own output was piped to the window and lost on reload or quit, so "what did that run
// actually do?" could not be answered afterwards — a local run left nothing on disk at all (1 Oct 2026).
//
// One file per run would be thousands of files; instead one rolling file, with a header line per run and its exit, so
// a run can be read back between its two markers. The engine's words verbatim: it already prints no secrets and no
// form answers (see src/*.py), and this file never leaves the Mac.
// One file per day like app.log (lib/log-days.js): engine.log for today, engine-YYYY-MM-DD.log for the last 30 days.
import fs from 'node:fs';
import {rollDay, capDay} from './log-days.js';

const DAY_MAX = 20_000_000, TOTAL_MAX = 200_000_000;
let file = null;
export const setFile = path => { file = path; };
export const logPath = () => file;

function append(text) {
  if (!file) return;
  rollDay(file, {maxTotal: TOTAL_MAX});
  capDay(file, DAY_MAX);
  try { fs.appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`); } catch {}
}

// The run's two markers. `args` is the module and its arguments: `src.daily --mode run` (never user content).
// runId, when the app minted one, is on both markers so a line in this file joins the Notion row and app.log.
export function start(args = [], at = new Date(), runId = '') {
  const id = runId ? ` run_id=${runId}` : '';
  append(`${at.toISOString()} ---- python -m ${args.join(' ')}${id}`);
}
export function line(text) {
  append(String(text));
}
export function end({code, seconds, runId} = {}, at = new Date()) {
  const id = runId ? ` run_id=${runId}` : '';
  append(`${at.toISOString()} ---- exit ${code} after ${seconds}s${id}`);
}

// The last `count` lines of the log, for a beta tester's failed-run report (they switched that on; lib/sentry.js scrubs each line).
export function tailLines(count = 200) {
  if (!file) return [];
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-count); } catch { return []; }
}
