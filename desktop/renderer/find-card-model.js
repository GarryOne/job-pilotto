// The "Find jobs" card on top of Jobs, as data (pure): which of its five states shows (empty first run, searching, done, failed, none), the step chips
// with the one that is running, the last lines in words, and the counts. Drawn by pages/jobs-find.js. Guarded by: test/find-card.test.js.
// Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md
import {readableLog} from './human-log.js';

// A first run reads a slice and scores 3 jobs first; the usual run starts with the job boards. The latest line that matches a step is the running one.
export const FIRST = /^(Finding your first jobs|First jobs:)/;
const EMPLOYERS = /^(Checking employer|Reading employer|⏳ Reading employer|Titles:|Places:|⏳ Scoring|Scored |Added |Job Matches)/;
const SLICE_END = /^First jobs: (\d+ scored|\d+ found, none to score)/;
const STEPS = {
  first: [['First jobs', FIRST], ['All employers', EMPLOYERS], ['Job boards', /^Searching job boards/], ['More employers', /^(Growing your sources|Source scout|🔭)/]],
  usual: [['Job boards', /^Searching job boards/], ['Employer sites', EMPLOYERS], ['More employers', /^(Growing your sources|Source scout|🔭)/]],
};

export function stepChips(log = []) {
  const first = log.some(line => FIRST.test(String(line)));
  const steps = STEPS[first ? 'first' : 'usual'];
  let active = 0, sliceDone = !first;   // the slice reads feeds and scores too: its own lines are not the "All employers" step
  for (const raw of log) {
    const line = String(raw);
    if (SLICE_END.test(line)) sliceDone = true;
    steps.forEach(([, pattern], i) => { if (pattern.test(line) && i >= active && (sliceDone || i === 0 || i > 1)) active = i; });
  }
  return steps.map(([label], i) => ({label, state: i < active ? 'done' : i === active ? 'active' : 'pending'}));
}

// This search's own numbers: the engine's last "Run counts: looked=N matches=M scored=K" line (src/run_counts.py, each job once by its URL).
const COUNTS = /^Run counts: looked=(\d+) matches=(\d+) scored=(\d+)(?: good=(\d+))?\s*$/;
export function runCounts(log = []) {
  for (let i = log.length - 1; i >= 0; i--) {
    const found = COUNTS.exec(String(log[i]));
    if (found) return {looked: Number(found[1]), matches: Number(found[2]), scored: Number(found[3]), good: Number(found[4] || 0)};
  }
  return {looked: 0, matches: 0, scored: 0, good: 0};
}

// One definition of a search run's numbers, read by the Find jobs card and the Recent activity run card (owner, 19 Oct 2026): found = the possible jobs
// for you, scored, good fits (70+), and waiting = found but not scored yet. Null when the run has no counts line (an older run): nothing is invented.
export function searchNumbers(log = []) {
  if (!(log || []).some(line => COUNTS.test(String(line)))) return null;
  const {matches, scored, good} = runCounts(log);
  return {found: matches, scored, good, waiting: Math.max(0, matches - scored)};
}

// The employer read as progress: the latest "Reading employer job sites: 1953 of 2251" ticker line (src/progress.py), or null before it starts.
export function employersRead(log = []) {
  for (let i = log.length - 1; i >= 0; i--) {
    const found = /Reading employer job sites: (\d+) of (\d+)/.exec(String(log[i]));
    if (found) return {done: Number(found[1]), total: Number(found[2])};
  }
  return null;
}

// running: window.pilot.runs().running; last: the newest finished search run; listed/scored: the Jobs list's counts (kept for the none state); finishedHere: a search ended while this window was open.
export function findCard({running = null, last = null, lastSearchAt = '', listed = 0, scored = 0, finishedHere = false} = {}) {
  const searching = running && (running.kind || 'search') === 'search';
  if (searching) {
    const log = running.log || [];
    const lines = readableLog(log.slice(-60)).filter(line => !/^⏳ Still running/.test(line)).slice(-3);
    return {state: 'searching', chips: stepChips(log), lines, ...runCounts(log), waiting: searchNumbers(log)?.waiting ?? 0, employers: employersRead(log), first: log.some(line => FIRST.test(String(line)))};
  }
  if (last && last.ok === false && (finishedHere || !listed)) return {state: 'failed', problem: last.problem || last.result || '', listed};
  if (finishedHere && last) return {state: 'done', listed, found: last.new ?? null, ...runCounts(last.log), waiting: Math.max(0, runCounts(last.log).matches - runCounts(last.log).scored)};
  if (!lastSearchAt && !listed) return {state: 'empty'};
  return {state: 'none'};
}
