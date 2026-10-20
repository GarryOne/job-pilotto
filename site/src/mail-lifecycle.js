// Trial and lifecycle mail (owner, 16 Oct 2026): "N applications left", "trial ends in 3 days", "Always on paused", and the Pro-launch mail to the marketing list (sent by hand, behind env.MAIL_LAUNCH).
// Runs once a day from the Worker's cron (src/index.js). Each mail goes out once (mail_log is the memory); src/mail.js applies the lists, the opt-in, the 6-a-day limit and the unsubscribe.
// The trial numbers are the ones GET /api/trial/status keeps in KV per install (src/trial.js). Guard: test/mail-lifecycle.test.js.
import {digestOf} from './guard.js';
import {addrOf, send} from './mail.js';
import {FREE_APPLICATIONS, stand} from './trial.js';

export const PRICING_URL = 'https://www.jobadabra.top/pricing';
const DAY = 24 * 60 * 60 * 1000;
export const LEFT_AT = 5;        // "5 applications left"
export const ENDING_DAYS = 3;    // "trial ends in 3 days"
const MAX_PER_RUN = 500;

async function sentSince(env, to, template, since) {
  const row = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE addr = ? AND template = ? AND status = 'sent' AND at >= ?").bind(await addrOf(to), template, since).first();
  return row.n > 0;
}

// The trial numbers of an account: the most applications and the earliest first run over its devices.
async function trialOf(env, account, now) {
  const devices = (await env.STATS.prepare('SELECT install FROM pro_devices WHERE account = ?').bind(account.id).all()).results || [];
  let applied = 0, first = null;
  for (const {install} of devices) {
    const who = await digestOf(install);
    const [a, f] = await Promise.all([env.WAITLIST.get(`trial:applied:${who}`), env.WAITLIST.get(`trial:first:${who}`)]);
    applied = Math.max(applied, Number(a) || 0);
    if (f && (!first || f < first)) first = f;
  }
  return stand({applied, first: first || account.trial_started_at || account.created_at, now});
}

// -> {left: n, ending: n, paused: n} mails sent today.
export async function run(env, now = new Date()) {
  const done = {left: 0, ending: 0, paused: 0};
  const reminders = env.TRIAL_REMINDERS === 'on';   // owner, 17 Oct 2026: the trial reminders push Pro, so they are off by default
  if (!env.STATS || !env.WAITLIST) return done;
  const accounts = (await env.STATS.prepare("SELECT id, email, created_at, trial_started_at FROM pro_accounts WHERE plan = 'trial' AND status = 'active' AND service_mail_off_at IS NULL ORDER BY created_at LIMIT ?").bind(MAX_PER_RUN).all()).results || [];
  for (const account of accounts) {
    const trial = await trialOf(env, account, now);
    const left = FREE_APPLICATIONS - trial.used;
    if (reminders && left > 0 && left <= LEFT_AT && !await sentSince(env, account.email, 'trial-left', '')) {
      if ((await send(env, 'trial-left', account.email, {left}, {now})).ok) done.left++;
    }
    if (reminders && trial.used >= FREE_APPLICATIONS && trial.daysLeft > 0 && trial.daysLeft <= ENDING_DAYS && !await sentSince(env, account.email, 'trial-ending', '')) {
      if ((await send(env, 'trial-ending', account.email, {days: trial.daysLeft, pricingUrl: PRICING_URL}, {now})).ok) done.ending++;
    }
  }
  // Hosted Always on paused (src/hosted tables, migration 0083_hosted): once per pause, never more than once a month.
  const paused = (await env.STATS.prepare("SELECT a.email, h.pause_reason FROM hosted_schedules h JOIN pro_accounts a ON a.id = h.account WHERE h.state = 'paused' AND h.pause_reason IN ('trial-over', 'inactive') AND a.plan = 'trial' LIMIT ?")
    .bind(MAX_PER_RUN).all().catch(() => ({results: []}))).results || [];
  for (const row of paused) {
    if (await sentSince(env, row.email, 'always-on-paused', new Date(now.getTime() - 30 * DAY).toISOString())) continue;
    if ((await send(env, 'always-on-paused', row.email, {reason: row.pause_reason, pricingUrl: PRICING_URL, pro: env.MARKETING_MAIL === 'on'}, {now})).ok) done.paused++;
  }
  return done;
}

// The Pro-launch mail to every opted-in address that has not had it (owner sends it by hand: POST /admin/mail/launch). env.MAIL_LAUNCH = "on" and env.MARKETING_MAIL = "on" are the flags; without ?send=1 it only counts.
export async function launch(env, {send: really = false, now = new Date()} = {}) {
  if (env.MAIL_LAUNCH !== 'on' || env.MARKETING_MAIL !== 'on') return {off: true};
  const rows = (await env.STATS.prepare('SELECT email FROM pro_accounts WHERE marketing_opt_in = 1 ORDER BY created_at').all()).results || [];
  const todo = [];
  for (const {email} of rows) if (!await sentSince(env, email, 'pro-launch', '')) todo.push(email);
  if (!really) return {would: todo.length};
  const data = {price: env.PRO_PRICE_USD || '29', launch: env.PRO_LAUNCH_USD ?? '19', pricingUrl: PRICING_URL};
  let sent = 0;
  for (const email of todo) if ((await send(env, 'pro-launch', email, data, {now})).ok) sent++;
  return {sent, skipped: todo.length - sent};
}
