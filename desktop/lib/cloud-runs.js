// "Keep working while my Mac is off": runs in the user's GitHub repo show in Recent activity like the Mac's own:
// what ran (from the run's name, e.g. "scheduled", "insight", "mail", "scout 15"), who started it, the step it's
// on, and, once finished, its log with the same result line and message a run on this Mac gets.
import {client} from './github.js';
import {appMessage, mailProblem, mailResult, runs, saveRuns, taskSummary} from './pipeline.js';

const TASK_MODES = ['mail', 'scout', 'insight', 'weekly', 'today'];
// The run's name is its mode: "scheduled" and "run" are searches; apply/prepare/more/… are Telegram button actions.
export function kindOf(title) {
  const mode = String(title || '').split(' ')[0];
  if (mode === 'scheduled' || mode === 'run' || mode === '') return 'search';
  return TASK_MODES.includes(mode) ? mode : 'action';
}

// A workflow run as an activity record (ids are start times, like the Mac's, so the list sorts as one).
export function record(run) {
  const startedAt = run.run_started_at || run.created_at;
  return {id: Date.parse(startedAt), githubId: run.id, source: 'github', url: run.html_url, kind: kindOf(run.display_title),
    mode: String(run.display_title || '').split(' ')[0], trigger: run.event === 'schedule' ? 'schedule' : 'you', startedAt,
    ...(run.status === 'completed' ? {endedAt: run.updated_at, ok: run.conclusion === 'success'} : {})};
}

// Log lines without the timestamps and GitHub's ##[group] markers.
export const cleanLog = text => String(text).split(/\r?\n/).map(line => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ''))
  .filter(line => line && !/^##\[(end)?group\]/.test(line));

// What the log says, as the Mac's runs record it (see pipeline.js).
export function results(kind, log) {
  const notionUrl = log.map(line => line.match(/^Cronjob run logged: (\S+)/)?.[1]).filter(Boolean).pop() || null;
  if (kind === 'mail') {
    return {notionUrl, ...mailResult(log), off: log.some(line => /Gmail \+ Calendar is off/.test(line)), problem: mailProblem(log.join('\n'))};
  }
  if (kind === 'search') {
    const counts = log.map(line => line.match(/^Digest ready: \d+ jobs?, (\d+) new/)).filter(Boolean).pop();
    return {notionUrl, ...(counts ? {new: Number(counts[1])} : {}), message: appMessage(log)};
  }
  return {notionUrl, summary: taskSummary(kind, log), message: appMessage(log)};
}

// One sync: the repo's latest runs into runs.json (a finished run's log is fetched once), and the run in
// progress (with its current step) for the activity bar. Returns {running} or null when the cloud is off.
export async function sync(storage, {fetcher = globalThis.fetch, perPage = 15} = {}) {
  const repo = storage.settings().cloud?.repo;
  const token = storage.secret('GITHUB_TOKEN');
  if (!repo || !token) return null;
  const api = client(token, fetcher);
  const {workflow_runs: latest = []} = await api('GET', `/repos/${repo}/actions/runs?per_page=${perPage}`);
  const list = runs(storage);
  const known = new Map(list.filter(r => r.githubId).map(r => [r.githubId, r]));
  let running = null, changed = false;
  for (const run of latest) {
    const next = record(run);
    const before = known.get(run.id);
    if (!next.endedAt) {
      if (!running) {
        const {jobs = []} = await api('GET', `/repos/${repo}/actions/runs/${run.id}/jobs`).catch(() => ({}));
        const step = jobs.flatMap(job => job.steps || []).find(s => s.status === 'in_progress')?.name;
        running = {...next, step: step ? `On GitHub: ${step}` : 'On GitHub: starting'};
      }
      continue;
    }
    if (before?.endedAt) continue;  // already recorded with its log
    const log = await logOf(api, repo, run.id, fetcher, token).catch(error => [`Log not available: ${error.message}`]);
    const done = {...next, log: log.slice(-400), ...results(next.kind, log)};
    if (before) list.splice(list.indexOf(before), 1, done); else list.push(done);
    changed = true;
  }
  if (changed) saveRuns(storage, list.sort((a, b) => b.id - a.id));
  return {running};
}

// A finished run's log: each job's plain-text log (GitHub answers with a redirect to it).
async function logOf(api, repo, runId, fetcher, token) {
  const {jobs = []} = await api('GET', `/repos/${repo}/actions/runs/${runId}/jobs`);
  const lines = [];
  for (const job of jobs) {
    const response = await fetcher(`https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`,
      {headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-desktop'}});
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    lines.push(...cleanLog(await response.text()));
  }
  return lines;
}
