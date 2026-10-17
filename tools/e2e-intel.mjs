#!/usr/bin/env node
// Publishes the finished release/beta e2e runs of the last 30 days and the cause of every red suite to /admin/operations/e2e (e2e-intel.yml: after each release run, hourly as backup).
// A run is read once; a red whose cause is "open" or "unknown" is read again until its fix lands. Causes come from facts only (site/src/e2e-causes.js, guard: site/test/e2e-intel-collector.test.js):
// the job's step results, the failing job's log text (never stored), and the files changed between the red run and the next run where the same suite passed.
//   node tools/e2e-intel.mjs [--dry [--out rows.json]]    needs gh with GH_TOKEN; publishing needs SELFHEAL_PUBLISH_KEY (optional E2E_INTEL_URL)
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFileSync} from 'node:fs';
import {CAUSES, RULES_VERSION, causeOf, suiteOfJob} from '../site/src/e2e-causes.js';

const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'GarryOne/job-pilotto';
const base = process.env.E2E_INTEL_URL || 'https://www.jobpilotto.top/e2e/data';
const execAsync = promisify(execFile);
const MAX_LOGS = 24;   // a log is megabytes and a call takes seconds: only the newest reds of one collector run are read; an older red with no log read is "unknown", never a guess
const gh = (...args) => JSON.parse(execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 28}) || 'null');
const RUN_TITLE = /Beta|Nightly|E2E check/;
const minutesOf = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 6000) / 10) || 0;

// The suite jobs of one run that were red on their first try: [{suite, platform, jobConclusion, failedStep, rerun, minutes, jobId}]. A Mac job that went green on the "once more" step still counts (a flake).
export function redJobs(jobs = []) {
  const out = [];
  for (const job of jobs) {
    const id = suiteOfJob(job.name);
    if (!id) continue;
    const again = (job.steps || []).find(step => /once more, to tell flaky from real/.test(step.name) && step.conclusion && step.conclusion !== 'skipped');
    if (job.conclusion !== 'failure' && job.conclusion !== 'cancelled' && !again) continue;
    const failed = (job.steps || []).find(step => step.conclusion === 'failure');
    out.push({...id, jobConclusion: job.conclusion, failedStep: failed?.name || '', rerun: again?.conclusion, minutes: minutesOf(job.started_at, job.completed_at), jobId: job.id});
  }
  return out;
}
// Did this suite pass on its first try in this run?
export const passedFirst = (jobs = [], suite, platform) => jobs.some(job => {
  const id = suiteOfJob(job.name);
  return id && id.suite === suite && id.platform === platform && job.conclusion === 'success' && !(job.steps || []).some(step => /once more/.test(step.name) && step.conclusion && step.conclusion !== 'skipped');
});

// runs: [{databaseId, createdAt, updatedAt, headSha, conclusion, displayTitle, jobs}] oldest first -> {runs, fails} rows for the site.
export function rowsOf(runs, {logOf = () => '', filesBetween = () => null} = {}) {
  const out = {runs: [], fails: []};
  runs.forEach((run, index) => {
    out.runs.push({runId: run.databaseId, createdAt: run.createdAt, kind: /Nightly/.test(run.displayTitle) ? 'nightly' : 'beta', conclusion: run.conclusion, minutes: minutesOf(run.createdAt, run.updatedAt)});
    for (const red of redJobs(run.jobs)) {
      const fixed = runs.slice(index + 1).find(later => passedFirst(later.jobs, red.suite, red.platform));
      const fixFiles = red.rerun === 'success' ? null : fixed ? filesBetween(run.headSha, fixed.headSha) : [];
      const cause = causeOf({...red, log: red.rerun === 'success' ? '' : logOf(red.jobId), fixFiles});
      out.fails.push({runId: run.databaseId, suite: red.suite, platform: red.platform, day: run.createdAt.slice(0, 10), cause, minutes: red.minutes});
    }
  });
  return out;
}

// The text of failing jobs' logs is read once, eight at a time, and only searched (never stored or sent).
async function readLogs(runs) {
  const ids = runs.flatMap(run => redJobs(run.jobs).filter(red => red.rerun !== 'success').map(red => red.jobId)).slice(0, MAX_LOGS), logs = new Map();   // in the order given: new runs, newest first, then runs waiting for a cause, oldest first
  for (let at = 0; at < ids.length; at += 8) {
    await Promise.all(ids.slice(at, at + 8).map(async id => {
      try { logs.set(id, (await execAsync('gh', ['api', '--allow-escape-sequences', `repos/${repo}/actions/jobs/${id}/logs`], {maxBuffer: 1 << 28})).stdout); } catch { logs.set(id, ''); }
    }));
  }
  return logs;
}
const filesBetween = (from, to) => { if (from === to) return []; try { return gh('api', `repos/${repo}/compare/${from}...${to}`).files.map(file => file.filename); } catch { return null; } };

async function main() {
  const key = process.env.SELFHEAL_PUBLISH_KEY, dry = process.argv.includes('--dry');
  if (!key && !dry) { console.log('::warning::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); return; }
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const listed = gh('run', 'list', '--repo', repo, '--workflow', 'desktop.yml', '--limit', '200', '--json', 'databaseId,conclusion,createdAt,updatedAt,displayTitle,headSha')
    .filter(run => RUN_TITLE.test(run.displayTitle) && ['success', 'failure'].includes(run.conclusion) && run.createdAt >= since).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let have = [], pending = [];
  if (key) ({have, pending} = await (await fetch(`${base}?v=${RULES_VERSION}`, {headers: {Authorization: `Bearer ${key}`}})).json());
  const settled = new Set(have), waiting = new Set(pending);
  const todo = listed.filter(run => !settled.has(run.databaseId) || waiting.has(run.databaseId));
  console.log(`${listed.length} finished runs in 30 days, ${settled.size} stored, ${todo.length} to read`);
  if (!todo.length) return;
  // A fix is looked for in the runs after the oldest one to read: read their jobs too (at most 60 runs a time).
  const from = listed.findIndex(run => run.databaseId === todo[0].databaseId);
  const needed = listed.slice(from, from + 60);   // the oldest 60 first: a later hourly run takes the rest; a red whose fix is past the window stays "open" and is read again
  for (let at = 0; at < needed.length; at += 8) {   // eight at a time: one call per run is slow one by one
    await Promise.all(needed.slice(at, at + 8).map(async run => {
      try { run.jobs = JSON.parse((await execAsync('gh', ['api', `repos/${repo}/actions/runs/${run.databaseId}/jobs?per_page=100`], {maxBuffer: 1 << 28})).stdout).jobs || []; } catch { run.jobs = []; }
    }));
  }
  const wanted = needed.filter(run => todo.some(t => t.databaseId === run.databaseId));
  const logs = await readLogs([...wanted.filter(run => !settled.has(run.databaseId)).reverse(), ...wanted.filter(run => settled.has(run.databaseId))]);
  const rows = rowsOf(needed, {logOf: id => (logs.has(id) ? logs.get(id) : null), filesBetween});
  const send = {runs: rows.runs.filter(row => todo.some(run => run.databaseId === row.runId)), fails: rows.fails.filter(row => todo.some(run => run.databaseId === row.runId))};
  const counts = Object.fromEntries(CAUSES.map(cause => [cause.id, send.fails.filter(fail => fail.cause === cause.id).length]));
  console.log(JSON.stringify(counts));
  const out = process.argv.indexOf('--out');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(send));
  if (dry) return;
  const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify({rules: RULES_VERSION, ...send})});
  console.log(`published ${send.runs.length} runs, ${send.fails.length} reds: HTTP ${response.status} ${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
