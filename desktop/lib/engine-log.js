// What the engine printed, in full: <data folder>/logs/engine.log (5 MB, then .1). The app's own log says a run
// started and ended; the run's own output was piped to the window and lost on reload or quit, so "what did that run
// actually do?" could not be answered afterwards — a local run left nothing on disk at all (1 Oct 2026).
//
// One file per run would be thousands of files; instead one rolling file, with a header line per run and its exit, so
// a run can be read back between its two markers. The engine's words verbatim: it already prints no secrets and no
// form answers (see src/*.py), and this file never leaves the Mac.
import fs from 'node:fs';

const LIMIT = 5_000_000;
let file = null;
export const setFile = path => { file = path; };
export const logPath = () => file;

function append(text) {
  if (!file) return;
  try { if (fs.statSync(file).size > LIMIT) fs.renameSync(file, `${file}.1`); } catch {}
  try { fs.appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`); } catch {}
}

// The run's two markers. `args` is the module and its arguments: `src.daily --mode run` (never user content).
export function start(args = [], at = new Date()) {
  append(`${at.toISOString()} ---- python -m ${args.join(' ')}`);
}
export function line(text) {
  append(String(text));
}
export function end({code, seconds} = {}, at = new Date()) {
  append(`${at.toISOString()} ---- exit ${code} after ${seconds}s`);
}
