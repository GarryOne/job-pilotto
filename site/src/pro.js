// Pro accounts and the AI credit ledger (spec docs/superpowers/specs/2026-10-16-pro-plan.md §1, §3): who is Pro, how much credit is left,
// the devices (3 per account), GET /api/pro/status for the app. Money is micro-USD; the app only ever sees a percent and a warning step, never dollars.
// Guards: site/test/pro-credit.test.js. Payments (Stripe) are the next PR: they call addCredit/refund/link here. Switch: env.PRO_PLAN = off | test | live.
import {authorize, digestOf, flag} from './guard.js';

// The key ai_calls.who has for an install (aicost.js digests the install's digest again, keeps 8 characters): join pro_devices.install to ai_calls through it.
export const aiCallsKey = async install => (await digestOf(await digestOf(install))).slice(0, 8);

export const DEVICES_PER_ACCOUNT = 3;
export const OVERDRAFT_MICRO = 250_000;   // $0.25: an application in progress finishes when the credit runs out (the app starts no new work at 0)
export const planOn = env => ['test', 'live'].includes(env.PRO_PLAN);
const stamp = date => date.toISOString();
const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };   // as free-ai.js (not imported: it imports this lane)

// The account a (raw) install id belongs to, or null.
export async function accountOf(env, install) {
  if (!env.STATS || !install) return null;
  return (await env.STATS.prepare('SELECT a.* FROM pro_devices d JOIN pro_accounts a ON a.id = d.account WHERE d.install = ?').bind(install).first().catch(() => null)) || null;
}

// An account for an e-mail (the same e-mail is the same account) -> its id. `plan: 'trial'` makes a trial account (onboarding, no payment: no Pro lane, no credit);
// a payment makes or finds the account and flips it to Pro (makePro). An existing account is never downgraded or restarted by asking again.
export async function createAccount(env, email, now = new Date(), {plan = 'pro'} = {}) {
  const clean = String(email).trim().toLowerCase(), hash = await digestOf(clean), trial = plan === 'trial';
  await env.STATS.prepare('INSERT OR IGNORE INTO pro_accounts (id, email_hash, email, created_at, plan, trial_started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`acc_${hash}`, hash, clean, stamp(now), trial ? 'trial' : 'pro', trial ? stamp(now) : null).run();
  return (await env.STATS.prepare('SELECT id FROM pro_accounts WHERE email_hash = ?').bind(hash).first()).id;
}

// A purchase of Pro (or a top-up) on a trial account makes it a Pro account, same e-mail, same devices.
export async function makePro(env, account) {
  await env.STATS.prepare("UPDATE pro_accounts SET plan = 'pro' WHERE id = ? AND plan = 'trial'").bind(account).run();
}

// Adds an install to an account: max 3 devices, and an install belongs to one account only (a 4th device or a second account is refused and flagged).
export async function link(env, account, install, now = new Date()) {
  const mine = await env.STATS.prepare('SELECT account FROM pro_devices WHERE install = ?').bind(install).first();
  if (mine) {
    if (mine.account !== account) { await flag(env, 'pro-install-two-accounts', await digestOf(install), '', now); return {ok: false, error: 'This device belongs to another account.'}; }
    await env.STATS.prepare('UPDATE pro_devices SET last_seen = ? WHERE install = ?').bind(stamp(now), install).run();
    return {ok: true};
  }
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM pro_devices WHERE account = ?').bind(account).first();
  if (n >= DEVICES_PER_ACCOUNT) { await flag(env, 'pro-device-limit', await digestOf(install), account, now); return {ok: false, error: `This account already has ${DEVICES_PER_ACCOUNT} devices. Remove one first.`}; }
  await env.STATS.prepare('INSERT INTO pro_devices (install, account, added_at, last_seen) VALUES (?, ?, ?, ?)').bind(install, account, stamp(now), stamp(now)).run();
  return {ok: true};
}

// A purchase or an adjustment adds credit (+) and counts as "ever added"; a refund takes it back from both (balance floored at 0).
export async function addCredit(env, account, micro, reason, ref, now = new Date()) {
  if (!['purchase', 'adjust', 'refund'].includes(reason)) throw new Error(`bad reason ${reason}`);
  await env.STATS.prepare('UPDATE pro_accounts SET credit_micro = MAX(0, credit_micro + ?), credit_added_micro = MAX(0, credit_added_micro + ?) WHERE id = ?').bind(micro, micro, account).run();
  await env.STATS.prepare('INSERT INTO pro_credit (account, delta_micro, reason, ref, at) VALUES (?, ?, ?, ?, ?)').bind(account, micro, reason, ref || null, stamp(now)).run();
}

// One AI call's cost, in the same micro-USD ai_calls records. May dip below 0 within the overdraft.
export async function spend(env, account, micro, ref, now = new Date()) {
  if (!(micro > 0)) return;
  await env.STATS.prepare('UPDATE pro_accounts SET credit_micro = credit_micro - ? WHERE id = ?').bind(micro, account).run();
  await env.STATS.prepare('INSERT INTO pro_credit (account, delta_micro, reason, ref, at) VALUES (?, ?, ?, ?, ?)').bind(account, -micro, 'ai_call', ref || null, stamp(now)).run();
}

// "AI credit: N% left", rounded down to 5%: the credit left over the credit ever added. Pure arithmetic, no estimate.
export const percentOf = account => (account?.credit_added_micro > 0 ? Math.floor(Math.max(0, account.credit_micro) / account.credit_added_micro * 20) * 5 : 0);
// The warning step the app shows once each: 30 (30% or less), 10 (10% or less), 0 (used up); null above 30%.
export const warnOf = percent => (percent <= 0 ? 0 : percent <= 10 ? 10 : percent <= 30 ? 30 : null);

// GET /api/pro/status with the install's own AI key (x-api-key: JPF1.<install>.<token>, the one Free AI already uses).
export async function status(request, env) {
  if (!planOn(env)) return new Response('Not found', {status: 404});
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  if (!access?.ok) return Response.json({ok: false, error: 'unauthorized'}, {status: 401});
  const account = await accountOf(env, given.install);
  // The price to show (the launch price while there is one: PRO_LAUNCH_USD empty ends it), so the app never hard-codes a number. A trial account is Free until it pays.
  if (!account || account.status !== 'active' || account.plan !== 'pro') return Response.json({ok: true, plan: 'free', mode: env.PRO_PLAN, offer: {price: env.PRO_PRICE_USD || '29', launch: env.PRO_LAUNCH_USD ?? '19'}});
  const percent = percentOf(account);
  return Response.json({ok: true, plan: 'pro', mode: env.PRO_PLAN, creditPercent: percent, warn: warnOf(percent), devices: DEVICES_PER_ACCOUNT});
}
