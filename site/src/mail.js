// Our e-mail sender (Cloudflare Email Sending, binding EMAIL): send(env, template, to, data) is the one way any code mails a person. It refuses (never throws) on a bad address,
// a bounce/complaint, an unsubscribe from the template's list, marketing without an opt-in, or more than 6 mails a day to one address; it adds the footer, the one-click
// unsubscribe link and headers, and logs the mail (hash of the address, never the body) in mail_log. Switch: env.MAIL = "on" (anything else sends nothing). Guard: test/mail.test.js.
import {digestOf, tokenFor} from './guard.js';
import {frameHtml, frameText, SITE} from './mail-frame.js';
import {TEMPLATES} from './mail-templates.js';

export const DAILY_MAX = 6;                 // per address, per rolling 24 h (spec §4c "Abuse")
const GLOBAL_DAY_MAX = 3000;                // a safety net over every address; env.MAIL_DAY_MAX overrides
const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const FROM = {service: 'Jobadabra <notifications@jobadabra.top>', marketing: 'Jobadabra <news@jobadabra.top>'};

export const clean = to => String(to || '').trim().toLowerCase();
export const validAddress = to => ADDRESS.test(clean(to)) && clean(to).length <= 254;
export const addrOf = to => digestOf(clean(to));   // the key everywhere: pro_accounts.email_hash, mail_log.addr, mail_off.addr

// The one-click link for a list ('service' = stop the daily searches' mail, 'marketing' = stop news). Signed, no sign-in.
// The signed link that confirms an address (the first mail carries it, src/account-email.js).
export async function confirmLink(env, to) {
  const addr = await addrOf(to);
  return `${SITE}/confirm?a=${addr}&t=${await tokenFor(addr, env, 'confirm')}`;
}

export async function stopLink(env, to, list) {
  const addr = await addrOf(to);
  return `${SITE}/unsubscribe?a=${addr}&l=${list}&t=${await tokenFor(addr, env, `unsub-${list}`)}`;
}

// The signed link to the e-mail settings page (src/mail-settings.js): the same token as the service stop link, no sign-in.
export async function settingsLink(env, to) {
  const addr = await addrOf(to);
  return `${SITE}/email-settings?a=${addr}&t=${await tokenFor(addr, env, 'unsub-service')}`;
}

// -> {ok: true} or {ok: false, reason}. For a caller that builds an expensive mail (the digest) and wants to know first.
export async function mailAllowed(env, to, list = 'service', {essential = false} = {}) {
  if (!validAddress(to)) return {ok: false, reason: 'bad_address'};
  if (list === 'marketing' && env.MARKETING_MAIL !== 'on') return {ok: false, reason: 'marketing_off'};   // owner, 17 Oct 2026: no promotional mail until he turns it on
  const addr = await addrOf(to);
  const off = await env.STATS.prepare("SELECT list, reason FROM mail_off WHERE addr = ? AND list IN ('all', ?)").bind(addr, list).all();
  for (const row of off.results || []) if (row.list === 'all' || !essential) return {ok: false, reason: row.list === 'all' ? 'suppressed' : 'unsubscribed'};
  const account = await env.STATS.prepare('SELECT marketing_opt_in, service_mail_off_at FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  if (list === 'marketing' && !account?.marketing_opt_in) return {ok: false, reason: 'not_opted_in'};
  if (list === 'service' && !essential && account?.service_mail_off_at) return {ok: false, reason: 'unsubscribed'};
  return {ok: true};
}

async function record(env, now, addr, list, template, status, id = null) {
  await env.STATS?.prepare('INSERT INTO mail_log (at, addr, list, template, status, message_id) VALUES (?, ?, ?, ?, ?, ?)').bind(now.toISOString(), addr, list, template, status, id).run().catch(() => {});
}

export async function send(env, template, to, data = {}, {now = new Date()} = {}) {
  const spec = TEMPLATES[template];
  if (!spec) return {ok: false, reason: 'bad_template'};
  if (env.MAIL !== 'on' || !env.EMAIL || !env.STATS) return {ok: false, reason: 'off'};
  try {
    const verdict = await mailAllowed(env, to, spec.list, spec);
    const addr = await addrOf(to);
    if (!verdict.ok) { if (verdict.reason !== 'bad_address' && verdict.reason !== 'marketing_off') await record(env, now, addr, spec.list, template, verdict.reason); return verdict; }
    const since = new Date(now.getTime() - DAY).toISOString();
    const mine = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE addr = ? AND status = 'sent' AND at >= ?").bind(addr, since).first();
    const all = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'sent' AND at >= ?").bind(since).first();
    if (mine.n >= DAILY_MAX || all.n >= Number(env.MAIL_DAY_MAX || GLOBAL_DAY_MAX)) { await record(env, now, addr, spec.list, template, 'rate'); return {ok: false, reason: 'rate'}; }
    const stop = spec.essential ? null : await stopLink(env, to, spec.list);
    const why = spec.essential ? 'A security email: sent even if you stopped other emails.'
      : spec.list === 'marketing' ? 'You get these because you agreed to product news.' : 'You get this because you set up Jobadabra with this address.';
    const frame = {title: spec.title(data), why, button: spec.button?.(data) || null, links: stop && {stop, settings: await settingsLink(env, to)}};
    const text = frameText({...frame, body: spec.text(data)});
    const html = frameHtml({...frame, body: spec.html(data)});
    const headers = stop ? {'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'} : undefined;
    const result = await env.EMAIL.send({from: FROM[spec.list], to: clean(to), subject: spec.subject(data), text, html, ...(headers && {headers})});
    await record(env, now, addr, spec.list, template, 'sent', result?.messageId || null);
    return {ok: true, id: result?.messageId || null};
  } catch (error) {
    console.error(`mail ${template}: ${error.message}`);
    await record(env, now, await addrOf(to).catch(() => ''), spec.list, template, 'failed');
    return {ok: false, reason: 'failed'};
  }
}

// Daily: the mail log keeps 90 days (the per-address limit only reads the last day).
export async function purge(env, now = new Date()) {
  await env.STATS?.prepare('DELETE FROM mail_log WHERE at < ?').bind(new Date(now.getTime() - 90 * DAY).toISOString()).run();
}
