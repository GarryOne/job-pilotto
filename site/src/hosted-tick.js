// Hosted Always on, the cron side (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §1, §5): every 5 minutes (the one existing cron) the Worker scans due schedules, applies the guards, and puts one
// message per run on the Queue (env.HOSTED_QUEUE); the runner Worker (site/hosted-runner) starts the container. The Worker only enqueues. Guard: site/test/hosted-guards.test.js.
import {digestOf} from './guard.js';
import {hostedOn, INACTIVE_DAYS, startRun} from './hosted.js';
import {monthStopUsd, trialUsd} from './free-ai.js';

export const BATCH = 50, MONTH_COMPUTE_MICRO = 1_500_000, SITE = 'https://www.jobadabra.top';
const DAY = 24 * 60 * 60 * 1000, HOUR = 60 * 60 * 1000;
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
const count = async (kv, key) => Number(kv ? await kv.get(key) : 0) || 0;

async function pause(env, schedule, reason, now) {
  await env.STATS.prepare("UPDATE hosted_schedules SET state = 'paused', pause_reason = ? WHERE account = ?").bind(reason, schedule.account).run();
  return reason;
}

// -> {enqueued, paused: {reason: n}, held} (held: due but kept for the next tick by a global cap).
export async function tick(env, now = new Date()) {
  const out = {enqueued: 0, paused: {}, held: 0};
  if (!hostedOn(env) || !env.STATS) return out;
  const stamp = now.toISOString(), kv = env.WAITLIST, day = stamp.slice(0, 10), month = day.slice(0, 7);
  // A run that never posted (container crashed, Worker restarted) is failed once its token has expired, so its slot is not stuck.
  await env.STATS.prepare("UPDATE hosted_runs SET status = 'failed', finished_at = ? WHERE finished_at IS NULL AND expires_at < ?").bind(stamp, stamp).run();
  const {results: due} = await env.STATS.prepare(`SELECT s.account, s.install, s.freq_hours, s.next_run_at, s.last_seen_at, a.plan, a.status AS payment FROM hosted_schedules s JOIN pro_accounts a ON a.id = s.account
    WHERE s.state = 'on' AND s.next_run_at <= ? ORDER BY s.next_run_at LIMIT ?`).bind(stamp, BATCH).all();
  const today = (await env.STATS.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN a.plan = ? THEN 1 ELSE 0 END) AS trial FROM hosted_runs r JOIN pro_accounts a ON a.id = r.account WHERE r.started_at >= ?').bind('trial', `${day}T00:00:00`).first());
  let runsToday = today.n || 0, trialToday = today.trial || 0;
  const freeStopped = await count(kv, `freeai:usd:${day}`) >= num(env.FREE_AI_STOP_USD, 10) * 1e6 || await count(kv, `freeai:usdm:${month}`) >= monthStopUsd(env) * 1e6;
  for (const schedule of due) {
    const trial = !(schedule.plan === 'pro' && schedule.payment === 'active');
    const note = async reason => { out.paused[reason] = (out.paused[reason] || 0) + 1; await pause(env, schedule, reason, now); };
    if (now.getTime() - Date.parse(schedule.last_seen_at) > INACTIVE_DAYS * DAY) { await note('inactive'); continue; }
    if (trial && await count(kv, `freeai:life:${await digestOf(schedule.install)}`) >= trialUsd(env) * 1e6) { await note('trial-over'); continue; }
    const spent = await env.STATS.prepare('SELECT COALESCE(SUM(compute_micro), 0) AS micro FROM hosted_runs WHERE account = ? AND started_at >= ?').bind(schedule.account, `${month}-01`).first();
    if (spent.micro >= MONTH_COMPUTE_MICRO) { await note('guard'); continue; }
    if (runsToday >= num(env.HOSTED_MAX_RUNS_DAY, 2000) || (trial && (trialToday >= num(env.HOSTED_TRIAL_MAX_RUNS_DAY, 1500) || freeStopped))) { out.held++; continue; }
    if (!env.HOSTED_QUEUE) { out.held++; continue; }
    const run = await startRun(env, schedule, now);
    // Whether or not the slot was new, the schedule moves on; a slot that already has a run is never started twice.
    await env.STATS.prepare('UPDATE hosted_schedules SET next_run_at = ? WHERE account = ?').bind(new Date(now.getTime() + schedule.freq_hours * HOUR).toISOString(), schedule.account).run();
    if (!run) continue;
    await env.HOSTED_QUEUE.send({run: run.id, token: run.token, site: env.HOSTED_SITE || SITE, account: await digestOf(schedule.account)});
    out.enqueued++; runsToday++; if (trial) trialToday++;
  }
  return out;
}
