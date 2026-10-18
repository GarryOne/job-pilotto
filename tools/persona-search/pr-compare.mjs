// What a pull request does to one Lab candidate (owner, 19 Oct 2026: "replay on each PR": a PR's search is replayed on the same tape as main's and the two are compared; $0, read-only, never the Lab page).
//   node tools/persona-search/pr-compare.mjs <candidate> <PR out> <PR tape> <main out> <main tape>     -> a table row on stdout, exit 1 only for a real "Worse"
// Verdicts: worse (red: a count is lower, a time is >25% slower, or the PR's search crashes where main's does not), stale (green: the tape lacks what the PR asks, it needs a live re-record after the merge),
// new (green: main's replay of this tape is stale or crashed, nothing to compare with), same (green). The rules are the Lab page's own (site/src/search-lab-judge.js). Guard: tests/test_search_lab_workflow.py.
import fs from 'node:fs';
import path from 'node:path';
import {reasons} from '../../site/src/search-lab-judge.js';
import {rowFromPress} from '../../site/src/search-lab-store.js';
import {replayMisses, staleNote} from './tape-store.mjs';

// -> {state: 'worse'|'stale'|'new'|'same', why: [...]}. now/base are Lab rows (rowFromPress); base may be null.
export function compare(now, base, control = false) {
  if (now.state === 'failed') return base?.state === 'failed' ? {state: 'new', why: [`crashes on main too (${now.failed_step})`]} : {state: 'worse', why: [`a step crashed: ${now.failed_step}`]};
  if (now.state === 'stale') return {state: 'stale', why: [`${now.failed_step}: needs a live re-record after the merge`]};
  if (!base || base.state !== 'ok') return {state: 'new', why: ['main\'s replay of this tape is not usable: nothing to compare with']};
  const why = reasons(now, base, control);
  return {state: why.length ? 'worse' : 'same', why};
}

function load(out, tape, candidate, build) {
  const file = path.join(out, candidate, 'presses.jsonl');
  if (!fs.existsSync(file)) return null;
  const press = JSON.parse(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)[0]);
  const report = path.join(tape, 'report.jsonl');
  press.stale = staleNote(fs.existsSync(report) ? replayMisses(fs.readFileSync(report, 'utf8')) : {ai: 0, web: 0, webTape: 0});
  return rowFromPress(candidate, press, {label: candidate, control: candidate === 'sre', build, runAt: new Date(0).toISOString()});
}

const ICON = {worse: '🔴 Worse', stale: '🟡 Tape stale', new: '⚪ Nothing to compare', same: '🟢 Not worse'};
const cell = (now, base, field, unit = '') => `${base?.[field] ?? '–'}${unit} → ${now?.[field] ?? '–'}${unit}`;

export function line(candidate, now, base, verdict) {
  return `| ${candidate} | ${ICON[verdict.state]} | ${cell(now, base, 'in_places')} | ${cell(now, base, 'fit70')} | ${cell(now, base, 'first_s', ' s')} | ${cell(now, base, 'fit_s', ' s')} | ${verdict.why.join('; ') || ''} |`;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [candidate, nowOut, nowTape, baseOut, baseTape] = process.argv.slice(2);
  if (!baseTape) { console.error('usage: node tools/persona-search/pr-compare.mjs <candidate> <PR out> <PR tape> <main out> <main tape>'); process.exit(2); }
  const now = load(nowOut, nowTape, candidate, 'pr'), base = load(baseOut, baseTape, candidate, 'main');
  const verdict = now ? compare(now, base, candidate === 'sre') : base ? {state: 'worse', why: ['the PR\'s replay left no numbers']} : {state: 'new', why: ['neither replay left numbers']};
  console.log(line(candidate, now, base, verdict));
  process.exitCode = verdict.state === 'worse' ? 1 : 0;
}
