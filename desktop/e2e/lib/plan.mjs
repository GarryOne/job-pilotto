import {STATS_SINCE} from './stats-epoch.mjs';
import {classify, detectorOf} from './selfheal-stats.mjs';
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

// One rule for a scheduled run: a commit gets at most MAX_RUNS_PER_COMMIT looks, then nothing runs until the next commit.
//  - the first look is for what changed; the others walk another seeded random path over the same code (lib/variation.mjs), which is where a second look finds something;
//  - a new commit starts over, so a busy day costs exactly the schedule (3 runs a day, whatever the number of commits) and an idle weekend costs 3 runs in all;
//  - nothing goes stale while it waits: code that did not change cannot make an open finding wrong, and code that changed always gets a run at the next slot.
export const MAX_RUNS_PER_COMMIT = 3;

// runsOnHead: completed runs of main's code on this commit. -> {run, exploring, why}
export function exploreDecision({head, lastSha, runsOnHead = [], max = MAX_RUNS_PER_COMMIT}) {
  if (!lastSha) return {run: true, exploring: false, why: 'no earlier run'};
  if (head !== lastSha) return {run: true, exploring: false, why: 'a new commit'};
  if (runsOnHead.length >= max) return {run: false, exploring: false, why: `${runsOnHead.length} looks at this commit already: waiting for the next one`};
  return {run: true, exploring: true, why: `look ${runsOnHead.length + 1} of ${max} at this commit, another path`};
}

// Kept for the plain "same commit and nothing waits" question (the old rule): true when a run would only repeat the last one.
export const shouldSkipScheduled = ({event, head, lastSha, waiting}) => event === 'schedule' && !!lastSha && head === lastSha && waiting === 0;

// The AI review of screenshots is the costly part of a run: only when the UI (or the tests that drive it) changed since the last run, or a finding waits to be confirmed.
// The noise breaker for the AI screenshot review, which spends the owner's money on every run (owner, 4 Oct 2026: "it burns my tokens and produces noise"). When most of the
// issues the review filed SINCE the job-seeker prompt (NOISE_SINCE) were judged noise (rejected, duplicate, harness) rather than real (fixed or confirmed), the review pauses:
// no more tokens until a person changes the rules and moves NOISE_SINCE forward. It needs NOISE_MIN judged issues before it can trip.
export const NOISE_SINCE = STATS_SINCE;
export const NOISE_MIN = 6, NOISE_SHARE = 0.5;
export function noiseTripped(issues, {since = NOISE_SINCE, min = NOISE_MIN, share = NOISE_SHARE} = {}) {
  let noise = 0, real = 0;
  for (const issue of issues) {
    if (detectorOf(issue) !== 'ai-review' || !(issue.createdAt >= since)) continue;
    const kind = classify(issue);
    if (['falsePositive', 'duplicate', 'harness'].includes(kind)) noise++;
    else if (['fixed', 'queued'].includes(kind)) real++;
  }
  const judged = noise + real;
  return {tripped: judged >= min && noise / judged >= share, noise, real, judged};
}
export const reviewNeeded = ({files, waiting, known}) => !known || waiting > 0 || files.some(file => /^desktop\/(renderer|e2e)\//.test(file));
