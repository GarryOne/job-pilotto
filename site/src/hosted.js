// Hosted Always on, server side part 1 (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md): the schedule an install sets, the run token a container gets,
// the one result post, and the inbox the app pulls. The cron tick, Queue and container start are the next PR. Guard: site/test/hosted-schedule.test.js.
// Switch: env.HOSTED_ALWAYS_ON = off | on (off: every route answers 404). The container holds no long-lived secret: a run token is bound to one run, lives 30 minutes, posts once.
import {authorize, digestOf, equal, tokenFor} from './guard.js';
import {accountOf, createAccount, link} from './pro.js';
import {chargeCompute} from './hosted-budget.js';
import {digest} from './hosted-notify.js';

export const hostedOn = env => env.HOSTED_ALWAYS_ON === 'on';
export const RUN_TOKEN_MINUTES = 30, INACTIVE_DAYS = 14, INBOX_MAX = 200, TRIAL_FREQ_HOURS = 24, MIN_FREQ_HOURS = 4;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MINUTE = 60 * 1000, HOUR = 60 * MINUTE;
const iso = ms => new Date(ms).toISOString();
const slotOf = ms => iso(ms).slice(0, 13);
const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };
const notFound = () => new Response('Not found', {status: 404});
const deny = () => Response.json({ok: false, error: 'unauthorized'}, {status: 401});

export async function installOf(request, env) {
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  return access?.ok ? given.install : null;
}

// A run token: `HR1.<run id>.<hmac>`; good only while its run row is unfinished and unexpired.
export const runToken = async (env, id) => `HR1.${id}.${await tokenFor(id, env, 'hosted-run')}`;
export async function runOf(env, bearer, now = new Date()) {
  const [tag, id, token] = String(bearer || '').replace(/^Bearer /, '').split('.');
  if (tag !== 'HR1' || !id || !token || !equal(token, await tokenFor(id, env, 'hosted-run'))) return null;
  const run = await env.STATS.prepare('SELECT * FROM hosted_runs WHERE id = ?').bind(id).first();
  return run && !run.finished_at && Date.parse(run.expires_at) > now.getTime() ? run : null;
}

// Starts a run for a schedule: the row that dedupes the slot, and the token the container gets. -> {id, token} or null when the slot already has a run.
export async function startRun(env, schedule, now = new Date()) {
  const id = `run_${(await digestOf(`${schedule.account}:${slotOf(Date.parse(schedule.next_run_at))}`))}`;
  const made = await env.STATS.prepare('INSERT OR IGNORE INTO hosted_runs (id, account, slot, started_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, schedule.account, slotOf(Date.parse(schedule.next_run_at)), now.toISOString(), iso(now.getTime() + RUN_TOKEN_MINUTES * MINUTE)).run();
  if ((made.meta?.changes ?? made.changes) === 0) return null;
  return {id, token: await runToken(env, id)};
}

// PUT /api/hosted/schedule {on, email?, marketing?}  and  GET: the install's schedule. A trial install needs an e-mail to switch on (no address, no hosted).
// The first PUT makes the trial account (plan 'trial') and links the install; the account's own freq is fixed at once a day until Pro.
export async function schedule(request, env, now = new Date()) {
  if (!hostedOn(env)) return notFound();
  const install = await installOf(request, env);
  if (!install) return deny();
  let account = await accountOf(env, install);
  if (request.method === 'GET') {
    const row = account && await env.STATS.prepare('SELECT state, pause_reason, freq_hours, next_run_at, email_channel, last_seen_at FROM hosted_schedules WHERE account = ?').bind(account.id).first();
    return Response.json({ok: true, schedule: row || null});
  }
  if (request.method !== 'PUT') return Response.json({ok: false, error: 'Use GET or PUT'}, {status: 405});
  let body;
  try { body = await request.json(); } catch { return Response.json({ok: false, error: 'Send JSON'}, {status: 400}); }
  if (!body.on) {   // off: the row stays as 'off' (deleting the data is PR 3's export/delete)
    if (account) await env.STATS.prepare("UPDATE hosted_schedules SET state = 'off', pause_reason = NULL WHERE account = ?").bind(account.id).run();
    return Response.json({ok: true, state: 'off'});
  }
  if (!account) {
    const email = String(body.email || '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return Response.json({ok: false, error: 'Enter an email address like you@example.com.'}, {status: 400});
    const id = await createAccount(env, email, now, {plan: 'trial'});
    const linked = await link(env, id, install, now);
    if (!linked.ok) return Response.json({ok: false, error: linked.error}, {status: 409});
    if (body.marketing === true) await env.STATS.prepare('UPDATE pro_accounts SET marketing_opt_in = 1, marketing_opt_in_at = ? WHERE id = ?').bind(now.toISOString(), id).run();
    account = await accountOf(env, install);
  }
  const pro = account.plan === 'pro' && account.status === 'active';
  const freq = pro ? Math.max(MIN_FREQ_HOURS, Math.min(24, Math.floor(Number(body.freqHours)) || TRIAL_FREQ_HOURS)) : TRIAL_FREQ_HOURS;
  const next = iso(now.getTime() + HOUR);   // first run within the hour of switching on
  await env.STATS.prepare(`INSERT INTO hosted_schedules (account, install, freq_hours, next_run_at, state, last_seen_at, created_at) VALUES (?, ?, ?, ?, 'on', ?, ?)
    ON CONFLICT (account) DO UPDATE SET install = excluded.install, freq_hours = excluded.freq_hours, state = 'on', pause_reason = NULL, last_seen_at = excluded.last_seen_at,
    next_run_at = CASE WHEN hosted_schedules.state = 'on' THEN hosted_schedules.next_run_at ELSE excluded.next_run_at END`)
    .bind(account.id, install, freq, next, now.toISOString(), now.toISOString()).run();
  return Response.json({ok: true, state: 'on', freqHours: freq, nextRunAt: next});
}

// POST /api/hosted/result (Bearer run token) {status, matches: [{job, title, company, url, fit, line}], computeSeconds?}: the container's one post. The token stops working with it.
export async function result(request, env, now = new Date()) {
  if (!hostedOn(env)) return notFound();
  if (request.method !== 'POST') return Response.json({ok: false, error: 'Use POST'}, {status: 405});
  const run = await runOf(env, request.headers.get('authorization'), now);
  if (!run) return deny();
  let body;
  try { body = await request.json(); } catch { return Response.json({ok: false, error: 'Send JSON'}, {status: 400}); }
  const failed = body.status === 'failed';
  const matches = failed || !Array.isArray(body.matches) ? [] : body.matches.slice(0, INBOX_MAX).filter(m => m && m.job && m.title);
  // The run closes first (finished_at is the one-post latch): a second post finds no open run.
  const closed = await env.STATS.prepare("UPDATE hosted_runs SET finished_at = ?, status = ?, new_count = ? WHERE id = ? AND finished_at IS NULL")
    .bind(now.toISOString(), failed ? 'failed' : 'ok', matches.length, run.id).run();
  if ((closed.meta?.changes ?? closed.changes) === 0) return deny();
  for (const m of matches) {
    const payload = JSON.stringify({title: String(m.title).slice(0, 200), company: String(m.company || '').slice(0, 120), url: String(m.url || '').slice(0, 500), fit: Number(m.fit) || 0, line: String(m.line || '').slice(0, 300)});
    await env.STATS.prepare('INSERT OR IGNORE INTO hosted_inbox (account, run, job, payload, at) VALUES (?, ?, ?, ?, ?)').bind(run.account, run.id, String(m.job).slice(0, 120), payload, now.toISOString()).run();
  }
  if (!failed) await chargeCompute(env, run, now);   // the run's compute comes out of the trial budget (a run that failed before the crawl costs the person nothing)
  // The inbox keeps the newest INBOX_MAX per account.
  await env.STATS.prepare('DELETE FROM hosted_inbox WHERE account = ? AND id NOT IN (SELECT id FROM hosted_inbox WHERE account = ? ORDER BY id DESC LIMIT ?)').bind(run.account, run.account, INBOX_MAX).run();
  const next = iso(now.getTime() + (await env.STATS.prepare('SELECT freq_hours FROM hosted_schedules WHERE account = ?').bind(run.account).first())?.freq_hours * HOUR);
  await env.STATS.prepare("UPDATE hosted_schedules SET next_run_at = ? WHERE account = ? AND state = 'on'").bind(next, run.account).run();
  const mailed = await digest(env, run.account, matches, now);   // one digest e-mail per run with new matches (src/hosted-notify.js)
  return Response.json({ok: true, stored: matches.length, mailed: mailed.sent});
}

// GET /api/hosted/inbox?after=<id> (install key): the matches that arrived while the app was closed. Also counts as app contact (resets the 14-day pause clock and resumes a pause that clock caused).
export async function inbox(request, env, now = new Date()) {
  if (!hostedOn(env)) return notFound();
  const install = await installOf(request, env);
  if (!install) return deny();
  const account = await accountOf(env, install);
  if (!account) return Response.json({ok: true, matches: []});
  // Opening the app wakes a schedule the 14-day pause stopped (the pause mail says "Open the app to resume"); a trial-over or guard pause stays.
  await env.STATS.prepare(`UPDATE hosted_schedules SET last_seen_at = ?,
    state = CASE WHEN state = 'paused' AND pause_reason = 'inactive' THEN 'on' ELSE state END,
    pause_reason = CASE WHEN state = 'paused' AND pause_reason = 'inactive' THEN NULL ELSE pause_reason END WHERE account = ?`).bind(now.toISOString(), account.id).run();
  const after = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get('after'))) || 0);
  const {results} = await env.STATS.prepare('SELECT id, job, payload, at FROM hosted_inbox WHERE account = ? AND id > ? ORDER BY id LIMIT ?').bind(account.id, after, INBOX_MAX).all();
  return Response.json({ok: true, matches: results.map(r => ({id: r.id, job: r.job, at: r.at, ...JSON.parse(r.payload)}))});
}
