// The e-mail digest of everything that is not a new-matches mail (owner, 17 Oct 2026): mail-check results, insights, finished jobs wait here, and the daily cron sends each account
// ONE mail (weekly on Mondays for an account that chose weekly). New matches and interview notices never wait: src/account-email.js sends them at once. Guard: test/account-email.test.js.
import {addrOf, confirmLink, send} from './mail.js';

const HOLD_MAX = 100;            // per account: a stuck mailbox cannot grow the table
const KEEP_DAYS = 14;
const UNCONFIRMED_MAILS = 2;     // an address nobody confirmed gets two mails ever (the first carries the confirm link)
export const CADENCES = ['daily', 'weekly'];

// One mail to the account's address, with the confirm link while the address is unconfirmed. -> {ok} or {ok: false, reason}.
export async function deliver(env, account, {subject, html, text, buttons = []}, now = new Date()) {
  let confirmUrl = null;
  if (!account.email_confirmed_at) {
    const addr = await addrOf(account.email);
    const {n} = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE addr = ? AND template = 'message' AND status = 'sent'").bind(addr).first();
    if (n >= UNCONFIRMED_MAILS) return {ok: false, reason: 'unconfirmed'};
    confirmUrl = await confirmLink(env, account.email);
  }
  return send(env, 'message', account.email, {subject: String(subject || '').slice(0, 150), html, text, buttons, confirmUrl}, {now});
}

export async function hold(env, account, item, now = new Date()) {
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM mail_held WHERE account = ?').bind(account.id).first();
  if (n >= HOLD_MAX) return {ok: false, reason: 'full'};
  await env.STATS.prepare('INSERT INTO mail_held (account, at, subject, html, text, buttons) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(account.id, now.toISOString(), item.subject, item.html, item.text, JSON.stringify(item.buttons || [])).run();
  return {ok: true, held: true};
}

function digestOf(rows) {
  const subject = rows.length === 1 ? rows[0].subject : `Your Jobadabra update: ${rows.length} items`;
  const buttons = rows.flatMap(row => JSON.parse(row.buttons || '[]')).slice(0, 6);
  return {subject, html: rows.map(row => row.html).join('<hr>'), text: rows.map(row => row.text).join('\n\n---\n\n'), buttons};
}

// -> {sent, kept}: accounts mailed and accounts whose digest waits (weekly day not reached, or the sender refused).
export async function sendDigests(env, now = new Date()) {
  const done = {sent: 0, kept: 0};
  if (!env.STATS) return done;
  await env.STATS.prepare('DELETE FROM mail_held WHERE at < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString()).run();
  const accounts = (await env.STATS.prepare("SELECT a.id, a.email, a.email_confirmed_at, a.digest_cadence FROM pro_accounts a WHERE EXISTS (SELECT 1 FROM mail_held h WHERE h.account = a.id) LIMIT 500").all()).results || [];
  for (const account of accounts) {
    if (account.digest_cadence === 'weekly' && now.getUTCDay() !== 1) { done.kept++; continue; }
    const rows = (await env.STATS.prepare('SELECT id, subject, html, text, buttons FROM mail_held WHERE account = ? ORDER BY id LIMIT 30').bind(account.id).all()).results || [];
    if (!rows.length) continue;
    const result = await deliver(env, account, digestOf(rows), now);
    if (result.ok || result.reason === 'unsubscribed' || result.reason === 'suppressed') {   // sent, or the person does not want it: either way it is not held again
      await env.STATS.prepare(`DELETE FROM mail_held WHERE account = ? AND id <= ?`).bind(account.id, rows[rows.length - 1].id).run();
      if (result.ok) done.sent++;
    } else done.kept++;
  }
  return done;
}
