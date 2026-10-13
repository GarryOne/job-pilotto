// Telegram alerts for the scheduled CI checks (owner, 14 Oct 2026): every failure of e2e.yml (scheduled and gate runs) and replay-offline.yml sends 🔴, and the
// first success after a failure sends 🟢. Bot @jobpilotto_ci_alerts_bot: CI_ALERTS_TELEGRAM_BOT_TOKEN + CI_ALERTS_TELEGRAM_CHAT_ID (missing: one line, no send).
// The token is never printed; no AI. Guard: e2e/test/ci-alert.test.mjs.
//   node ci-alert.mjs <failure|success> "<what failed>"      (GITHUB_* and GH_TOKEN from the runner)
import path from 'node:path';

// The previous finished run of this workflow on the same branch (not this one) -> its conclusion, or ''.
export async function previousConclusion(env = process.env, fetcher = fetch) {
  const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0])}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`;
  try {
    const answer = await fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
    const body = await answer.json();
    return (body.workflow_runs || []).find(run => String(run.id) !== String(env.GITHUB_RUN_ID))?.conclusion || '';
  } catch { return ''; }
}

// -> the message, or '' when there is nothing to say (a success after a success).
export function messageOf({status, what = '', previous = '', env = process.env, now = new Date()}) {
  const name = env.GITHUB_WORKFLOW || 'CI', sha = String(env.GITHUB_SHA || '').slice(0, 7), link = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const time = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}).format(now);
  if (status === 'failure') return [`🔴 ${name} failed · ${env.GITHUB_REF_NAME || 'main'} ${sha} · ${time}`, String(what || 'see the run').slice(0, 1500), link].join('\n');
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
  console.log(await send(messageOf({status, what, previous})));
}
