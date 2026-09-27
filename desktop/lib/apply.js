// "Apply to N jobs": pick the N best open jobs and start applying.
//   chrome: open them as tabs in Google Chrome; the Job Pilotto extension fills each, you submit.
//   agents: one Claude session per job in Terminal (tools/apply-batch-claude.sh), driving Chrome with
//     Claude in Chrome; it follows a job board's Apply to the employer's site, signs up there if asked,
//     and fills every page. Recommended when Claude Code is installed; needs Notion kits.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pipeline from './pipeline.js';

export const FILL_MARK = 'jobpilotto-fill'; // must match extension/background.js

// Only jobs with a drafted kit (their form is already answered), best first.
export function pick(jobs, n) {
  return jobs.filter(job => ['unreviewed', 'saved'].includes(job.status) && job.url && job.kit)
    .sort((a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1))
    .slice(0, n);
}

// One job, from its row: open it in Chrome with the fill marker, so the extension fills the form by itself.
export function openOne(url, open = spawn) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  open('open', ['-a', 'Google Chrome', `${url.split('#')[0]}#${FILL_MARK}`], {detached: true, stdio: 'ignore'}).unref();
  return {ok: true};
}

// Where the Claude Code installer and Homebrew put `claude`: an app opened from the Finder has no shell PATH.
export function claudeBinary(env = process.env, exists = fs.existsSync) {
  const dirs = [...String(env.PATH || '').split(':').filter(Boolean), path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map(dir => path.join(dir, 'claude')).find(file => exists(file)) || '';
}

// Apply with Claude works when Claude Code is installed and Notion holds the kits.
export function claudeReady(storage, binary = claudeBinary) {
  if (!binary()) return {ok: false, error: 'Apply with Claude needs Claude Code: install it from claude.com/claude-code, or use Fill in Chrome.'};
  if (!storage.secret('NOTION_TOKEN')) return {ok: false, error: 'Apply with Claude reads the kit from Notion. Connect Notion in Settings first, or use Fill in Chrome.'};
  return {ok: true};
}

// The job's kit in Notion (answers and cover letter): a Claude session has nothing to fill from without it.
export async function hasKit(storage, url, run = pipeline.run) {
  const lines = [];
  const {code} = await run(storage, ['src.ai.apply_batch', '--has-kit', url], line => lines.push(line));
  return code === 0 ? {ok: true} : {ok: false, error: `No application kit for this job yet: press Prepare first. ${lines.slice(-1)[0] || ''}`.trim()};
}

// One job, from its row: a Claude session in Terminal takes it from the posting to a filled form.
export async function claudeOne(storage, url, open = spawn, binary = claudeBinary, kit = hasKit) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  const ready = claudeReady(storage, binary);
  if (!ready.ok) return ready;
  const drafted = await kit(storage, url);
  if (!drafted.ok) return drafted;
  open(path.join(pipeline.REPO, 'tools', 'apply-batch-claude.sh'), [url.split('#')[0]],
    {cwd: pipeline.REPO, env: pipeline.pipelineEnv(storage), detached: true, stdio: 'ignore'}).unref();
  return {ok: true};
}

export async function start(storage, {n, mode}, open = spawn, list = pipeline.jobs) {
  n = Math.max(1, Math.min(10, Number(n) || 1));
  if (mode === 'agents') {
    const ready = claudeReady(storage);
    if (!ready.ok) return ready;
    const child = open(path.join(pipeline.REPO, 'tools', 'apply-batch-claude.sh'), ['--max', String(n)],
      {cwd: pipeline.REPO, env: pipeline.pipelineEnv(storage), detached: true, stdio: 'ignore'});
    child.unref();
    return {ok: true, message: `Starting ${n} Claude session(s) in Terminal, one per job. Each reads sign-up emails itself, asks you in its window for a CAPTCHA, and stops before Submit for your review.`};
  }
  const {jobs} = await list(storage);
  const chosen = pick(jobs, n);
  if (!chosen.length) return {ok: false, error: 'No job has an application kit yet. Press Prepare on the jobs you like first (about 20 s each).'};
  // The marker tells the extension to fill each tab by itself as it loads, all tabs in parallel.
  const urls = chosen.map(job => `${job.url.split('#')[0]}#${FILL_MARK}`);
  open('open', ['-a', 'Google Chrome', ...urls], {detached: true, stdio: 'ignore'}).unref();
  return {ok: true, jobs: chosen.map(job => `${job.title} · ${job.company}`),
    message: `Opened ${chosen.length} job(s) in Chrome; each fills itself in a few seconds. Review every tab and submit yourself. ` +
      '(If a form sits behind an "Apply" button, open it and click ✈️ → Fill with AI.)'};
}
