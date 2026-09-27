// "Apply to N jobs": pick the N best open jobs and start applying.
//   chrome: open them as tabs in Google Chrome; the Job Pilotto extension fills each, you submit.
//   agents: one Claude session per job in Terminal (tools/apply-batch-claude.sh, as today); needs Notion kits.
import {spawn} from 'node:child_process';
import path from 'node:path';
import * as pipeline from './pipeline.js';

export function pick(jobs, n) {
  return jobs.filter(job => ['unreviewed', 'saved'].includes(job.status) && job.url)
    .sort((a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1))
    .slice(0, n);
}

export async function start(storage, {n, mode}, open = spawn) {
  n = Math.max(1, Math.min(10, Number(n) || 1));
  if (mode === 'agents') {
    if (!storage.secret('NOTION_TOKEN')) {
      return {ok: false, error: 'AI agent sessions use the drafted kits in Notion. Connect Notion in Settings first, or use Chrome.'};
    }
    const child = open(path.join(pipeline.REPO, 'tools', 'apply-batch-claude.sh'), ['--max', String(n)],
      {cwd: pipeline.REPO, env: pipeline.pipelineEnv(storage), detached: true, stdio: 'ignore'});
    child.unref();
    return {ok: true, message: `Starting ${n} Claude session(s) in Terminal. Each stops before Submit for your review.`};
  }
  const {jobs} = await pipeline.jobs(storage);
  const chosen = pick(jobs, n);
  if (!chosen.length) return {ok: false, error: 'No open jobs left to apply to. Find new jobs first.'};
  open('open', ['-a', 'Google Chrome', ...chosen.map(job => job.url)], {detached: true, stdio: 'ignore'}).unref();
  return {ok: true, jobs: chosen.map(job => `${job.title} · ${job.company}`),
    message: `Opened ${chosen.length} job(s) in Chrome. On each application form, click the ✈️ extension → Fill with AI, review, submit.`};
}
