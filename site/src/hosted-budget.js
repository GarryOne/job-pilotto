// Hosted Always on money: what a run costs the person and how a container's calls are charged. A hosted run's AI calls carry its run token (HR1...) and are charged exactly like the
// install's own Free AI calls (src/free-ai.js: the $2 trial budget, per-install and global lines); the run's compute is a flat HOSTED_RUN_MICRO debited at its one result post, from the same
// lifetime budget and the global Free AI lines (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §3, §4b). Pro's `pro_credit` debit comes with Pro. Guard: site/test/hosted-guards.test.js.
import {digestOf} from './guard.js';

export const runMicro = env => (Number(env.HOSTED_RUN_MICRO) > 0 ? Math.round(Number(env.HOSTED_RUN_MICRO)) : 11000);
const bump = async (kv, key, add, ttl) => kv.put(key, String((Number(await kv.get(key)) || 0) + add), {expirationTtl: ttl});

// The Free AI access a run token stands for: the install that set the schedule (so its calls hit that install's limits). -> {ok, who, install} or null.
export async function aiAccess(env, bearer, runOf, now = new Date()) {
  const run = await runOf(env, bearer, now);
  const schedule = run && await env.STATS.prepare('SELECT install FROM hosted_schedules WHERE account = ?').bind(run.account).first();
  return schedule ? {ok: true, who: await digestOf(schedule.install), install: schedule.install, hosted: true} : null;
}

// Debits one finished run's compute. Trial (and any non-Pro) accounts: the lifetime budget and the global day/month Free AI totals. -> micro-USD debited.
export async function chargeCompute(env, run, now = new Date()) {
  const micro = runMicro(env);
  const schedule = await env.STATS.prepare('SELECT s.install, a.plan, a.status FROM hosted_schedules s JOIN pro_accounts a ON a.id = s.account WHERE s.account = ?').bind(run.account).first();
  if (!schedule) return 0;
  await env.STATS.prepare('UPDATE hosted_runs SET compute_micro = ? WHERE id = ?').bind(micro, run.id).run();
  if (schedule.plan === 'pro' && schedule.status === 'active') return 0;   // Pro: the credit debit comes with Pro (spec §6 step 8)
  const kv = env.WAITLIST, day = now.toISOString().slice(0, 10), month = day.slice(0, 7), who = await digestOf(schedule.install);
  if (kv) await Promise.all([bump(kv, `freeai:life:${who}`, micro, 400 * 86400), bump(kv, `freeai:usd:${day}`, micro, 2 * 86400), bump(kv, `freeai:usdm:${month}`, micro, 40 * 86400)]);
  return micro;
}
