// /admin/signups (owner, 16 Oct 2026: "keep track of the signups... follow up on them"): trial accounts by what we can act on (confirmed, unconfirmed, product-news opt-in, Always on paused, converted to Pro)
// and what our e-mail did in the last 7 days. Counts only, never an address. The Pro-launch mail is sent from here by hand: POST /admin/mail/launch (Bearer, src/mail-lifecycle.js). Guard: test/mail-lifecycle.test.js.
import {viewer, isOwner} from './auth.js';
import {esc} from './stats.js';
import {launch} from './mail-lifecycle.js';

const n = value => (Number(value) || 0).toLocaleString('en-US');
const one = async (env, sql, ...args) => (await env.STATS.prepare(sql).bind(...args).first().catch(() => null)) || {n: 0};
const many = async (env, sql, ...args) => (await env.STATS.prepare(sql).bind(...args).all().catch(() => ({results: []}))).results || [];

export async function collect(env, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const [trial, confirmed, optIn, paused, converted, sent, refused, off] = await Promise.all([
    one(env, "SELECT COUNT(*) AS n FROM pro_accounts WHERE plan = 'trial'"),
    one(env, "SELECT COUNT(*) AS n FROM pro_accounts WHERE plan = 'trial' AND email_confirmed_at IS NOT NULL"),
    one(env, "SELECT COUNT(*) AS n FROM pro_accounts WHERE plan = 'trial' AND marketing_opt_in = 1"),
    one(env, "SELECT COUNT(DISTINCT h.account) AS n FROM hosted_schedules h JOIN pro_accounts a ON a.id = h.account WHERE a.plan = 'trial' AND h.state = 'paused'"),
    one(env, "SELECT COUNT(*) AS n FROM pro_accounts WHERE plan = 'pro' AND trial_started_at IS NOT NULL"),
    many(env, "SELECT template, COUNT(*) AS n FROM mail_log WHERE status = 'sent' AND at >= ? GROUP BY template ORDER BY n DESC", since),
    many(env, "SELECT status, COUNT(*) AS n FROM mail_log WHERE status != 'sent' AND at >= ? GROUP BY status ORDER BY n DESC", since),
    many(env, 'SELECT reason, COUNT(*) AS n FROM mail_off GROUP BY reason ORDER BY n DESC'),
  ]);
  return {trial: trial.n, confirmed: confirmed.n, unconfirmed: trial.n - confirmed.n, optIn: optIn.n, paused: paused.n, converted: converted.n, sent, refused, off};
}

export function page(data) {
  const tile = (label, value, note) => `<section class="card tile"><span class="muted">${label}</span><b>${n(value)}</b><span class="muted">${note}</span></section>`;
  const table = (title, rows, key) => `<section class="card"><h2>${title}</h2>${rows.length ? `<table>${rows.map(row => `<tr><td>${esc(row[key])}</td><td class="num">${n(row.n)}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing yet.</p>'}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Signups · Admin</title>
<style>.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:30px;margin:4px 0}h2{margin:0 0 8px}</style></head><body><main>
<header><h1>✉️ Signups</h1><span class="muted">Trial accounts and our e-mail · mail: last 7 days</span></header>
<div class="tiles">${tile('Trial accounts', data.trial, 'gave an address (wizard or Settings)')}${tile('Confirmed', data.confirmed, 'clicked the link in the first mail')}${tile('Unconfirmed', data.unconfirmed, 'follow up with the next mail')}
${tile('Product news: yes', data.optIn, 'the opt-in box')}${tile('Always on paused', data.paused, 'hosted schedule paused')}${tile('Converted to Pro', data.converted, 'trial accounts that paid')}</div>
${table('Mail sent', data.sent, 'template')}${table('Mail not sent', data.refused, 'status')}${table('Switched off (all time)', data.off, 'reason')}
</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  return new Response(page(await collect(env)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}

// POST /admin/mail/launch[?send=1] (Bearer, owner): counts who would get the Pro-launch mail; with send=1 sends it. Off unless env.MAIL_LAUNCH = "on".
export async function launchRoute(request, env) {
  const notFound = () => new Response('Not found', {status: 404});
  if (request.method !== 'POST' || !(await isOwner(request, env)) || !(request.headers.get('Authorization') || '').startsWith('Bearer ')) return notFound();
  return Response.json(await launch(env, {send: new URL(request.url).searchParams.get('send') === '1'}));
}
