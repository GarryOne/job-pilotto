// The gaps between a pool row's progress notes (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2: the silent dead-end rule's T is measured, not guessed).
// Reads the extension's "progress: <kind>" lines (extension/ladder/progress.js) from each row's app log. A row is one application: a gap is the wall-clock time between two notes in
// any of its tabs (the extension's per-tab sinceMs would count the posting tab as silent forever once Apply opened a new one); the tail is the silence from the last note to the log's
// end. Activity without progress (presses, judgments) counts as silence. Pure: the caller reads the files (pool-gaps.mjs). Guard: e2e/test/pool-gaps.test.mjs.
import {PROGRESS_KINDS} from '../../../extension/ladder/progress.js';

const PROGRESS_LINE = /^(\S+Z) \[extension\] fill: progress: (\w+)(?: \{.*\})?$/;
const ANY_LINE = /^(\S+Z) \[/;
const DOOR = /^\S+Z \[extension\] fill: dead end: [a-z_-]+ (\{.*\})\s*$/;

// appLog -> [{at, kind}], in the log's order
export const progressOf = (appLog = '') => String(appLog).split('\n').map(text => PROGRESS_LINE.exec(text)).filter(found => found && PROGRESS_KINDS.includes(found[2]))
  .map(([, at, kind]) => ({at: Date.parse(at), kind}));

// The door's lines (extension/ladder/dead-end.js), told apart by their shadow field (never their words): -> {stops, seen} (seen: the silent rule's shadow notices).
export function doorLines(appLog = '') {
  let stops = 0, seen = 0;
  for (const found of String(appLog).split('\n').map(text => DOOR.exec(text)).filter(Boolean)) {
    let data = {};
    try { data = JSON.parse(found[1]); } catch { /* a cut line: a stop */ }
    if (data.shadow === true) seen++; else stops++;
  }
  return {stops, seen};
}

// appLog -> {events, gaps: [{ms, kind: the note that ended the wait}], maxGapMs, tailMs, deadEnd, silent}. tailMs null when the row has no note (a build before the notes, or no page
// considered); deadEnd: the door reported a stop; silent: how many times the silent rule noted the application in shadow.
export function rowGaps(appLog = '') {
  const notes = progressOf(appLog);
  const gaps = notes.slice(1).map((note, i) => ({ms: note.at - notes[i].at, kind: note.kind}));
  const times = String(appLog).split('\n').map(text => ANY_LINE.exec(text)).filter(Boolean).map(found => Date.parse(found[1])).filter(Number.isFinite);
  const end = times.length ? Math.max(...times) : null;
  const door = doorLines(appLog);
  return {events: notes.length, gaps, maxGapMs: Math.max(0, ...gaps.map(gap => gap.ms)), tailMs: notes.length && end != null ? end - notes.at(-1).at : null, deadEnd: door.stops > 0, silent: door.seen};
}

// A row's app log file in a smoke reports folder: the name smoke.mjs writes (the test reads smoke.mjs for the same expression).
export const appLogName = (day, shape) => `${day}-${shape.replace(/\W+/g, '-')}.app.log`;

// report: the day report (smoke.mjs); logs: {row: app log text}. -> one row per row THIS run ran, with its ending.
export function gapRows(report = {}, logs = {}) {
  const ran = Array.isArray(report.thisRun?.ran) ? new Set(report.thisRun.ran) : null;
  return Object.entries(report.results || {}).filter(([row]) => !ran || ran.has(row)).map(([row, item]) => {
    const gaps = rowGaps(logs[row] || '');
    return {row, ending: item?.ending || '', reached: item?.reached || '', ...gaps, measured: gaps.events > 0};
  });
}

export const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
};

// rows -> the numbers T is chosen from: every gap's quantiles, and the slowest gap on rows that reached the form (a normal run's slowest wait).
export function gapSummary(rows = []) {
  const measured = rows.filter(row => row.measured), all = measured.flatMap(row => row.gaps.map(gap => gap.ms));
  const ready = measured.filter(row => row.ending === 'ready').flatMap(row => row.gaps.map(gap => gap.ms));
  return {measured: measured.length, notMeasured: rows.length - measured.length, gaps: all.length,
    p50: quantile(all, 0.5), p90: quantile(all, 0.9), p95: quantile(all, 0.95), p99: quantile(all, 0.99), max: all.length ? Math.max(...all) : null, maxReady: ready.length ? Math.max(...ready) : null};
}
