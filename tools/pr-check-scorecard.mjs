#!/usr/bin/env node
// Monthly scorecard per PR check (owner, 17 Oct 2026: "gates stay only while they're proven"): from GitHub's PR runs, per workflow: runs, reds, false reds
// (flaky = red then green on the SAME head sha; setup = the failing step is checkout/install/download/fetch/cache/paths/bundle), real catches (red, then green
// after a later commit that changes non-test product files), median and p90 minutes, and the minutes it adds to the PR wait (slowest check of a sha minus the next).
// Pure counting by structure (shas, step names, changed paths); no AI, no log text. Guard: tests/pr-check-scorecard.test.mjs.
//   node tools/pr-check-scorecard.mjs [--days 30] [--out scorecard.json] [--message telegram.txt] [--runs runs.json --compare compare.json]
// Needs gh with GH_TOKEN (unless --runs). --runs: [{id,name,head_branch,head_sha,conclusion,created_at,run_started_at,updated_at,jobs:[{conclusion,steps:[{name,conclusion}]}]}];
// --compare: {"<fromSha>...<toSha>": ["changed/file", ...]}. Both are what fetchInput() collects, so a test or a re-run needs no network.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

export const SETUP_STEP = /checkout|set ?up|install|download|fetch|cache|artifact|paths|bundle|restore|upload/i;
export const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|fixtures|recorded|docs|zoo)\/|\.(test|spec)\.|\.md$|^\.github\/|^tools\/githooks\//;
const RED = new Set(['failure', 'timed_out']);

const minutes = run => Math.max(0, (Date.parse(run.updated_at) - Date.parse(run.run_started_at || run.created_at)) / 60000) || 0;
const pick = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0);
const round = n => Math.round(n * 10) / 10;

export const productFile = path => !TEST_PATH.test(path);

// Why a red run was red, by structure alone: 'flaky' | 'setup' | 'real' | 'fixed-other' | 'open'.
export function classify(run, later, changedFiles) {
  if (later.some(next => next.head_sha === run.head_sha && next.conclusion === 'success')) return 'flaky';
  const failed = (run.jobs || []).flatMap(job => job.steps || []).filter(step => RED.has(step.conclusion));
  if (failed.length && failed.every(step => SETUP_STEP.test(step.name))) return 'setup';
  const fixed = later.find(next => next.head_sha !== run.head_sha && next.conclusion === 'success');
  if (!fixed) return 'open';
  const files = changedFiles(run.head_sha, fixed.head_sha);
  return files.some(productFile) ? 'real' : 'fixed-other';
}

export function scorecard(runs, changedFiles, {days = 30, now = new Date()} = {}) {
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
    const tally = {flaky: 0, setup: 0, real: 0, 'fixed-other': 0, open: 0};
    for (const run of list.filter(item => RED.has(item.conclusion))) {
      const later = list.filter(next => next.head_branch === run.head_branch && next.created_at > run.created_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      tally[classify(run, later, changedFiles)] += 1;
    }
    const mins = list.map(minutes).sort((a, b) => a - b);
    const extra = (added.get(name) || []).sort((a, b) => a - b);
    const reds = list.filter(item => RED.has(item.conclusion)).length;
    return {name, runs: list.length, reds, realCatches: tally.real, falseReds: tally.flaky + tally.setup, flaky: tally.flaky, setup: tally.setup,
      fixedOther: tally['fixed-other'], open: tally.open, medianMin: round(pick(mins, 0.5)), p90Min: round(pick(mins, 0.9)),
      addedMin: round(pick(extra, 0.5)), verdict: tally.real === 0 ? 'review' : 'proven'};
  }).sort((a, b) => b.runs - a.runs);
  return {days, generatedAt: now.toISOString(), checks};
}

// The Telegram text: a table of a few words per cell, then one line per check to review.
export function message(card) {
  const rows = card.checks.map(check => `${check.verdict === 'review' ? '🟡' : '🟢'} ${check.name}: ${check.runs} runs, ${check.realCatches} catches, ${check.falseReds} false reds, p90 ${check.p90Min} min (+${check.addedMin} wait)`);
  const review = card.checks.filter(check => check.verdict === 'review').map(check => `🟡 review: ${check.name} (0 catches in ${card.days} days)`);
  return [`PR checks, last ${card.days} days`, ...rows, ...(review.length ? ['', ...review] : [])].join('\n');
}

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28});

// Everything the counting needs, from GitHub: PR runs of the window, the jobs of the red ones, and the changed files of each red→green sha pair.
export function fetchInput(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const trim = '.workflow_runs[] | {id, name, head_branch, head_sha, conclusion, created_at, run_started_at, updated_at}';
  const runs = gh('api', '--paginate', `repos/${repo}/actions/runs?event=pull_request&created=>=${since}&per_page=100`, '--jq', trim)
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const run of runs.filter(item => RED.has(item.conclusion))) {
    run.jobs = JSON.parse(gh('api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, '--jq', '[.jobs[] | {conclusion, steps: [.steps[] | {name, conclusion}]}]'));
  }
  const compare = {};
  const need = (from, to) => { compare[`${from}...${to}`] ??= JSON.parse(gh('api', `repos/${repo}/compare/${from}...${to}`, '--jq', '[.files[].filename]')); };
  for (const run of runs.filter(item => RED.has(item.conclusion))) {
    const fix = runs.find(next => next.name === run.name && next.head_branch === run.head_branch && next.created_at > run.created_at && next.head_sha !== run.head_sha && next.conclusion === 'success');
    if (fix) { try { need(run.head_sha, fix.head_sha); } catch { compare[`${run.head_sha}...${fix.head_sha}`] = []; } }
  }
  return {runs, compare};
}

function main() {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : ''; };
  const days = Number(arg('days')) || 30;
  const input = arg('runs') ? {runs: JSON.parse(readFileSync(arg('runs'), 'utf8')), compare: arg('compare') ? JSON.parse(readFileSync(arg('compare'), 'utf8')) : {}} : fetchInput(days);
  if (!arg('runs') && arg('save')) writeFileSync(arg('save'), JSON.stringify(input));
  const card = scorecard(input.runs, (from, to) => input.compare[`${from}...${to}`] || [], {days});
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(card, null, 1));
  if (arg('message')) writeFileSync(arg('message'), message(card));
  console.log(message(card));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
