// Which suites a run starts. A push to main runs only the suites whose files changed (every test-file push used to run all of them, and the shared test key's
// AI credit ran out); a schedule or a manual run runs all, or the ones named. The CI matrix is built from this (suite.mjs --list).
import {FALSE_POSITIVE, FIX_KINDS, LABEL, NEEDS_HUMAN, SIGHTINGS_NEEDED, sightings} from './triage.mjs';

const SMOKE = 'settings';   // AI-free, about 30 s: proof that the shared test code still launches the app and drives a page

// A suite's cadence (its `cadence` export): 'always' (default) runs on every automatic run, 'nightly' only in the nightly release gate and on a push that touches
// its own files or `watches`, 'manual' never by itself (a person names it). cadence: {suite: 'nightly'}; watches: {suite: ['src/ai/score.py', 'dir/']}.
export function autoSuites(all, cadence = {}, alwaysOnly = false) {
  return all.filter(suite => { const when = cadence[suite] || 'always'; return alwaysOnly ? when === 'always' : when !== 'manual'; });
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

// A scheduled run exists to find what changed or to confirm a finding: with the same commit as the last run and nothing waiting, it would only repeat it.
export const shouldSkipScheduled = ({event, head, lastSha, waiting}) => event === 'schedule' && !!lastSha && head === lastSha && waiting === 0;

// The AI review of screenshots is the costly part of a run: only when the UI (or the tests that drive it) changed since the last run, or a finding waits to be confirmed.
export const reviewNeeded = ({files, waiting, known}) => !known || waiting > 0 || files.some(file => /^desktop\/(renderer|e2e)\//.test(file));
