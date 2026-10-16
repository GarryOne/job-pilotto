// Telegram alerts for the scheduled CI checks (owner, 14 Oct 2026): a failure of e2e.yml (scheduled and gate runs) and site-replays.yml sends 🔴 once per commit and set of failed jobs (16 Oct 2026), and the
// first success after a failure sends 🟢. Bot @jobpilotto_ci_alerts_bot: CI_ALERTS_TELEGRAM_BOT_TOKEN + CI_ALERTS_TELEGRAM_CHAT_ID (missing: one line, no send).
// The token is never printed; no AI. Guard: e2e/test/ci-alert.test.mjs.
//   node ci-alert.mjs <failure|success> "<what failed>"      (GITHUB_* and GH_TOKEN from the runner)
import path from 'node:path';

// The previous finished run of this workflow on the same branch (not this one) -> its conclusion, or ''.
// Until 28 Oct 2026 a renamed workflow's old file is read too (replay-offline.yml → site-replays.yml, 14 Oct 2026).
export const OLD_FILES = {'site-replays.yml': 'replay-offline.yml'};
export async function previousConclusion(env = process.env, fetcher = fetch) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);
  for (const name of [file, OLD_FILES[file]].filter(Boolean)) {
    const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${name}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`;
    try {
      const answer = await fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
      const body = await answer.json();
      const found = (body.workflow_runs || []).find(run => String(run.id) !== String(env.GITHUB_RUN_ID))?.conclusion;
      if (found) return found;
    } catch { /* try the next name */ }
  }
  return '';
}

// The merged-PR list in an alert: the newest 5 and "+N more" (an old baseline named ~80 of them).
export function capMerged(text) {
  return String(text).replace(/(PRs merged since then: )((?:#\d+(?:, )?)+)/, (all, head, list) => {
    const prs = list.split(', ').filter(Boolean);
    return prs.length <= 5 ? all : `${head}${prs.slice(-5).join(', ')} +${prs.length - 5} more`;
  });
}

const API = env => env.GITHUB_API_URL || 'https://api.github.com';
const get = (url, env, fetcher) => fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)}).then(answer => answer.json());

// A run's failed jobs, sorted (the alert's own job is still running, so it never counts).
export async function failedJobs(runId, env = process.env, fetcher = fetch) {
  const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
  return (body.jobs || []).filter(job => job.conclusion === 'failure').map(job => job.name).sort();
}

// One alert per (workflow, commit, failed jobs): true when an earlier finished run of this workflow on this commit failed with the same failed jobs. Errors: false (alert).
export async function isRepeat(env = process.env, fetcher = fetch) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`, env, fetcher);
    const earlier = (body.workflow_runs || []).filter(run => String(run.id) !== String(env.GITHUB_RUN_ID) && run.head_sha === env.GITHUB_SHA && run.conclusion === 'failure');
    if (!earlier.length) return false;
    const now = [...await failedJobs(env.GITHUB_RUN_ID, env, fetcher), ...(env.CI_ALERT_ASSUME_FAILED ? [env.CI_ALERT_ASSUME_FAILED] : [])].sort().join('|');   // ASSUME_FAILED: the job that sends is itself the failing one, not yet marked
    if (!now) return false;
    for (const run of earlier) if ((await failedJobs(run.id, env, fetcher)).join('|') === now) return true;
  } catch { /* alert rather than stay silent */ }
  return false;
}

// -> the message, or '' when there is nothing to say (a success after a success).
export function messageOf({status, what = '', previous = '', env = process.env, now = new Date()}) {
  const name = env.GITHUB_WORKFLOW || 'CI', sha = String(env.GITHUB_SHA || '').slice(0, 7), link = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const time = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}).format(now);
  if (status === 'failure') {
    const cause = capMerged(String(what || 'see the run')), head = cause.split('\n')[0].split(/(?<=\.)\s/)[0].slice(0, 90);   // first line: the cause in a few words
    return [`🔴 ${head}`, `${name} failed · ${env.GITHUB_REF_NAME || 'main'} ${sha} · ${time}`, cause.slice(0, 1500), link].join('\n');
  }
  if (status === 'success' && ['failure', 'timed_out'].includes(previous)) return [`🟢 ${name} back to green · ${env.GITHUB_REF_NAME || 'main'} ${sha} · ${time}`, link].join('\n');
  return '';
}

export async function send(text, env = process.env, fetcher = fetch) {
  if (!text) return 'ci-alert: nothing to send';
  if (!env.CI_ALERTS_TELEGRAM_BOT_TOKEN || !env.CI_ALERTS_TELEGRAM_CHAT_ID) return 'ci-alert: not sent (CI_ALERTS_TELEGRAM_BOT_TOKEN or CI_ALERTS_TELEGRAM_CHAT_ID not set)';
  try {
    const answer = await fetcher(`https://api.telegram.org/bot${env.CI_ALERTS_TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.CI_ALERTS_TELEGRAM_CHAT_ID, text, disable_web_page_preview: true}), signal: AbortSignal.timeout(15000)});
    return answer.ok ? 'ci-alert: sent' : `ci-alert: not sent (Telegram ${answer.status})`;
  } catch (error) { return `ci-alert: not sent (${String(error?.name || 'error')})`; }   // never the error text: it can carry the URL with the token
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [status, what] = process.argv.slice(2);
  const previous = status === 'success' ? await previousConclusion() : '';
  console.log(status === 'failure' && await isRepeat() ? 'ci-alert: not sent (same failure on this commit already alerted)' : await send(messageOf({status, what, previous})));
}
