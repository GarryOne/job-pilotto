#!/usr/bin/env node
// Monthly scorecard per PR check (owner, 17 Oct 2026: "gates stay only while they're proven"): from GitHub's PR runs, per workflow: runs, reds, false reds
// (flaky = red then green on the SAME head sha; setup = the failing step is checkout/install/download/fetch/cache/paths/bundle), real catches (red, then green
// after a later commit of the PR, not a rebase or merge of main, that changes non-test product files the check loads: its own `on: pull_request: paths:`), median and p90 minutes, and the minutes it adds to the PR wait (slowest check of a sha minus the next).
// Pure counting by structure (shas, step names, changed paths); no AI, no log text. Guard: tests/pr-check-scorecard.test.mjs.
//   node tools/pr-check-scorecard.mjs [--days 30] [--out scorecard.json] [--message telegram.txt] [--runs runs.json --compare compare.json]
// Needs gh with GH_TOKEN (unless --runs). --runs: [{id,name,head_branch,head_sha,conclusion,created_at,run_started_at,updated_at,jobs:[{conclusion,steps:[{name,conclusion}]}]}];
// --compare: {"<fromSha>...<toSha>": {rebased, files}} (files of the PR's own new commits, authored after the red run, between the two; rebased = unknown, never a catch); --paths: {"<workflow>": ["glob", ...] | null}.
// All three are what fetchInput() collects, so a test or a re-run needs no network.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

export const SETUP_STEP = /checkout|set ?up|install|download|fetch|cache|artifact|paths|bundle|restore|upload/i;
export const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|fixtures|recorded|docs|zoo)\/|\.(test|spec)\.|\.md$|^\.github\/|^tools\/githooks\//;
const RED = new Set(['failure', 'timed_out']);

// A workflow's `on: pull_request: paths:` list (GitHub's globs: ** any depth, * inside a folder, a leading ! removes) -> a function path => bool; no list = every path.
export function pathsOf(workflowText) {
  const lines = String(workflowText || '').split('\n'), indent = line => line.length - line.trimStart().length;
  const pr = lines.findIndex(line => /^\s+pull_request:\s*$/.test(line));
  if (pr < 0) return null;
  const list = [];
  for (let i = pr + 1, inPaths = 0; i < lines.length && (!lines[i].trim() || indent(lines[i]) > indent(lines[pr])); i++) {
    if (/^\s+paths(-ignore)?:\s*$/.test(lines[i])) inPaths = /ignore/.test(lines[i]) ? -1 : indent(lines[i]);
    else if (inPaths > 0 && indent(lines[i]) > inPaths && /^\s+-\s/.test(lines[i])) list.push(lines[i].replace(/^\s+-\s+/, '').replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, ''));
    else if (lines[i].trim() && indent(lines[i]) <= Math.abs(inPaths)) inPaths = 0;
  }
  return list.length ? list : null;
}
export function matcher(patterns) {
  if (!patterns) return () => true;
  const regex = glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(.*/)?').replace(/\u0001/g, '.*')}$`);
  const rules = patterns.map(glob => ({negate: glob.startsWith('!'), regex: regex(glob.replace(/^!/, ''))}));
  return path => rules.reduce((hit, rule) => (rule.regex.test(path) ? !rule.negate : hit), false);
}

const minutes = run => Math.max(0, (Date.parse(run.updated_at) - Date.parse(run.run_started_at || run.created_at)) / 60000) || 0;
const pick = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0);
const round = n => Math.round(n * 10) / 10;

export const productFile = path => !TEST_PATH.test(path);

// Why a red run was red, by structure alone: 'flaky' | 'setup' | 'real' | 'fixed-other' | 'open'.
export function classify(run, later, changed, loads = () => true) {
  if (later.some(next => next.head_sha === run.head_sha && next.conclusion === 'success')) return 'flaky';
  const failed = (run.jobs || []).flatMap(job => job.steps || []).filter(step => RED.has(step.conclusion));
  if (failed.length && failed.every(step => SETUP_STEP.test(step.name))) return 'setup';
  const fixed = later.find(next => next.head_sha !== run.head_sha && next.conclusion === 'success');
  if (!fixed) return 'open';
  const {rebased, files} = changed(run.head_sha, fixed.head_sha);
  return !rebased && files.some(file => productFile(file) && loads(file)) ? 'real' : 'fixed-other';
}

export function scorecard(runs, changed, {days = 30, now = new Date(), paths = {}} = {}) {
  const done = runs.filter(run => run.conclusion && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped');
  const byName = new Map();
  for (const run of done) byName.set(run.name, [...(byName.get(run.name) || []), run]);
  // The wait a check adds: per head sha, its minutes beyond the slowest OTHER check (0 when it is not the slowest).
  const bySha = new Map();
  for (const run of done) bySha.set(run.head_sha, [...(bySha.get(run.head_sha) || []), run]);
  const added = new Map();
  for (const group of bySha.values()) {
    for (const run of group) {
      const others = Math.max(0, ...group.filter(other => other !== run).map(minutes));
      added.set(run.name, [...(added.get(run.name) || []), Math.max(0, minutes(run) - others)]);
    }
  }
  const checks = [...byName].map(([name, list]) => {
    const tally = {flaky: 0, setup: 0, real: 0, 'fixed-other': 0, open: 0}, catchPrs = new Set(), loads = matcher(paths[name]);
    for (const run of list.filter(item => RED.has(item.conclusion))) {
      const later = list.filter(next => next.head_branch === run.head_branch && next.created_at > run.created_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const kind = classify(run, later, changed, loads);
      tally[kind] += 1;
      if (kind === 'real') for (const number of run.pull_requests || []) catchPrs.add(number);
    }
    const mins = list.map(minutes).sort((a, b) => a - b);
    const extra = (added.get(name) || []).sort((a, b) => a - b);
    const reds = list.filter(item => RED.has(item.conclusion)).length;
    return {name, runs: list.length, reds, realCatches: tally.real, catchPrs: [...catchPrs].sort((a, b) => a - b), falseReds: tally.flaky + tally.setup, flaky: tally.flaky, setup: tally.setup,
      fixedOther: tally['fixed-other'], open: tally.open, medianMin: round(pick(mins, 0.5)), p90Min: round(pick(mins, 0.9)),
      addedMin: round(pick(extra, 0.5)), verdict: tally.real === 0 ? 'review' : 'proven'};
  }).sort((a, b) => b.runs - a.runs);
  return {days, generatedAt: now.toISOString(), checks};
}

// The Telegram text: a table of a few words per cell, then one line per check to review.
export function message(card) {
  const rows = card.checks.map(check => `${check.verdict === 'review' ? '🟡' : '🟢'} ${check.name}: ${check.runs} runs, ${check.realCatches} catches${check.catchPrs?.length ? ` (${check.catchPrs.map(number => `#${number}`).join(' ')})` : ''}, ${check.falseReds} false reds, p90 ${check.p90Min} min (+${check.addedMin} wait)`);
  const review = card.checks.filter(check => check.verdict === 'review').map(check => `🟡 review: ${check.name} (0 catches in ${card.days} days)`);
  return [`PR checks, last ${card.days} days`, ...rows, ...(review.length ? ['', ...review] : [])].join('\n');
}

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28});

// Everything the counting needs, from GitHub: PR runs of the window, the jobs of the red ones, and the changed files of each red→green sha pair.
export function fetchInput(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const trim = '.workflow_runs[] | {id, name, path, head_branch, head_sha, conclusion, created_at, run_started_at, updated_at, pull_requests: [.pull_requests[].number]}';
  const runs = gh('api', '--paginate', `repos/${repo}/actions/runs?event=pull_request&created=>=${since}&per_page=100`, '--jq', trim)
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  // GitHub leaves `pull_requests` empty on most runs: the PR is found by its branch.
  const byBranch = new Map(JSON.parse(gh('pr', 'list', '--repo', repo, '--state', 'all', '--limit', '1500', '--json', 'number,headRefName')).map(pr => [pr.headRefName, pr.number]));
  for (const run of runs) if (!run.pull_requests?.length && byBranch.has(run.head_branch)) run.pull_requests = [byBranch.get(run.head_branch)];
  const reds = runs.filter(item => RED.has(item.conclusion));
  for (const run of reds) {
    run.jobs = JSON.parse(gh('api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, '--jq', '[.jobs[] | {conclusion, steps: [.steps[] | {name, conclusion}]}]'));
  }
  // The files of the PR's own NEW work between a red run and its green one: the PR's non-merge commits authored after the red run started. A rebase keeps the author
  // date of the commits it replays and a merge of main is a merge commit, so neither counts; no PR number on the run = unknown (not a catch).
  const compare = {}, commitsOf = new Map(), filesOf = new Map();
  const prCommits = number => {
    if (!commitsOf.has(number)) commitsOf.set(number, JSON.parse(gh('api', '--paginate', `repos/${repo}/pulls/${number}/commits?per_page=100`, '--jq', '[.[] | {sha, merge: (.parents | length > 1), at: .commit.author.date}]')
      .replace(/\]\s*\[/g, ',')));
    return commitsOf.get(number);
  };
  const filesIn = sha => { if (!filesOf.has(sha)) filesOf.set(sha, JSON.parse(gh('api', `repos/${repo}/commits/${sha}`, '--jq', '[.files[].filename]'))); return filesOf.get(sha); };
  for (const run of reds) {
    const fix = runs.find(next => next.name === run.name && next.head_branch === run.head_branch && next.created_at > run.created_at && next.head_sha !== run.head_sha && next.conclusion === 'success');
    const number = run.pull_requests?.[0];
    if (!fix) continue;
    const key = `${run.head_sha}...${fix.head_sha}`;
    try { compare[key] = number ? {rebased: false, files: prCommits(number).filter(commit => !commit.merge && commit.at > run.run_started_at).flatMap(commit => filesIn(commit.sha))} : {rebased: true, files: []}; } catch { compare[key] = {rebased: true, files: []}; }
  }
  // What each workflow loads: its own `on: pull_request: paths:`, read from main.
  const paths = {};
  for (const [name, path] of new Map(runs.map(run => [run.name, run.path]))) {
    try { paths[name] = pathsOf(gh('api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}?ref=main`)); } catch { paths[name] = null; }
  }
  return {runs, compare, paths};
}

function main() {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : ''; };
  const days = Number(arg('days')) || 30;
  const read = name => (arg(name) ? JSON.parse(readFileSync(arg(name), 'utf8')) : {});
  const input = arg('runs') ? {runs: JSON.parse(readFileSync(arg('runs'), 'utf8')), compare: read('compare'), paths: read('paths')} : fetchInput(days);
  if (!arg('runs') && arg('save')) writeFileSync(arg('save'), JSON.stringify(input));
  const card = scorecard(input.runs, (from, to) => input.compare[`${from}...${to}`] || {rebased: true, files: []}, {days, paths: input.paths || {}});
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(card, null, 1));
  if (arg('message')) writeFileSync(arg('message'), message(card));
  console.log(message(card));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
