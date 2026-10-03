// Which suites a run starts. A push to main runs only the suites whose files changed (every test-file push used to run all of them, and the shared test key's
// AI credit ran out); a schedule or a manual run runs all, or the ones named. The CI matrix is built from this (suite.mjs --list).
import {FALSE_POSITIVE, FIX_KINDS, LABEL, NEEDS_HUMAN, SIGHTINGS_NEEDED, sightings} from './triage.mjs';

const SMOKE = 'settings';   // AI-free, about 30 s: proof that the shared test code still launches the app and drives a page

// A suite's cadence (its `cadence` export): 'always' (default) runs on every automatic run, 'nightly' only in the nightly release gate and on a push that touches
// its own files or `watches`, 'watched' never in a schedule or the nightly gate but ONLY on a push that touches its own files or `watches` (a suite that
// costs real AI money and judges one piece of code: the mail reading eval), 'manual' never by itself (a person names it). cadence: {suite: 'nightly'}; watches: {suite: ['src/ai/score.py', 'dir/']}.
export function autoSuites(all, cadence = {}, alwaysOnly = false) {
  return all.filter(suite => { const when = cadence[suite] || 'always'; return alwaysOnly ? when === 'always' : (when !== 'manual' && when !== 'watched'); });
}

export function suitesFor(files, all, {watches = {}, cadence = {}} = {}) {
  const chosen = new Set();
  for (const file of files.map(name => String(name).trim()).filter(Boolean)) {
    const suite = /^desktop\/e2e\/suites\/([^/]+)\.mjs$/.exec(file)?.[1];
    if (suite) { if (all.includes(suite)) chosen.add(suite); continue; }
    if (/^extension\//.test(file)) { chosen.add('apply'); continue; }
    if (/^desktop\/e2e\/test\//.test(file) || /\.md$/.test(file)) continue;   // unit tests run on their own; docs run nothing
    if (/^desktop\/e2e\//.test(file) || file === '.github/workflows/e2e.yml') chosen.add(SMOKE);
  }
  for (const file of files.map(name => String(name).trim()).filter(Boolean)) {   // files a suite watches (the scoring prompt, a model id): that suite runs too
    for (const [suite, paths] of Object.entries(watches)) if (all.includes(suite) && paths.some(path => file === path || (path.endsWith('/') && file.startsWith(path)))) chosen.add(suite);
  }
  return all.filter(suite => chosen.has(suite) && (cadence[suite] || 'always') !== 'manual');   // a manual suite is never chosen by a push
}

// A manual run's `suite` input: "" = all, else a comma-separated list.
export function suitesNamed(text, all) {
  const names = String(text || '').split(',').map(name => name.trim()).filter(Boolean);
  const unknown = names.filter(name => !all.includes(name));
  if (unknown.length) throw new Error(`unknown suite: ${unknown.join(', ')} (known: ${all.join(', ')})`);
  return names.length ? all.filter(suite => names.includes(suite)) : all;
}

// Open findings of the UI loop that wait for a second sighting before anything acts on them (a failed step or a parked finding never gets a fix, so it needs none).
export function waitingFindings(issues) {
  return issues.filter(issue => {
    const labels = (issue.labels || []).map(label => label.name || label);
    const kind = /·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '';
    return issue.state === 'OPEN' && labels.includes(LABEL) && !labels.includes(NEEDS_HUMAN) && !labels.includes(FALSE_POSITIVE) && FIX_KINDS.includes(kind) && sightings(issue) < SIGHTINGS_NEEDED;
  }).length;
}

// A scheduled run exists to find what changed, to confirm a finding, or (since the runs walk seeded random paths, lib/variation.mjs) to EXPLORE the same code another way.
// On the same commit as the last run it keeps going while the varied runs still find something and stops once they go quiet:
//  - at least QUIET_RUNS runs on the commit first (one run has seen one path);
//  - then it runs again while any UI-loop issue was opened or seen again since the earliest of the last QUIET_RUNS runs;
//  - never more than MAX_RUNS_PER_COMMIT (cost: macOS minutes and the shared AI credit);
//  - a new commit starts over, and a finding that waits for its second sighting always runs.
export const QUIET_RUNS = 3, MAX_RUNS_PER_COMMIT = 12;

// runsOnHead: completed runs on this commit, newest first ({createdAt}); activity: ISO times when the UI loop found something (an issue opened, a "Seen again" comment).
// -> {run, exploring, why}
export function exploreDecision({head, lastSha, waiting, runsOnHead = [], activity = [], quiet = QUIET_RUNS, max = MAX_RUNS_PER_COMMIT}) {
  if (!lastSha) return {run: true, exploring: false, why: 'no earlier run'};
  if (head !== lastSha) return {run: true, exploring: false, why: 'a new commit'};
  if (waiting > 0) return {run: true, exploring: false, why: `${waiting} finding(s) wait for a second sighting`};
  if (runsOnHead.length >= max) return {run: false, exploring: false, why: `${runsOnHead.length} runs on this commit: the cap`};
  if (runsOnHead.length < quiet) return {run: true, exploring: true, why: `only ${runsOnHead.length} run(s) on this commit, exploring another path`};
  const since = Date.parse(runsOnHead[quiet - 1].createdAt);
  const found = activity.filter(at => Date.parse(at) > since).length;
  return found ? {run: true, exploring: true, why: `the last ${quiet} runs still found something (${found})`}
    : {run: false, exploring: false, why: `${quiet} varied runs in a row found nothing new`};
}

// Kept for the plain "same commit and nothing waits" question (the old rule): true when a run would only repeat the last one.
export const shouldSkipScheduled = ({event, head, lastSha, waiting}) => event === 'schedule' && !!lastSha && head === lastSha && waiting === 0;

// The AI review of screenshots is the costly part of a run: only when the UI (or the tests that drive it) changed since the last run, or a finding waits to be confirmed.
export const reviewNeeded = ({files, waiting, known}) => !known || waiting > 0 || files.some(file => /^desktop\/(renderer|e2e)\//.test(file));
