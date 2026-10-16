// Unsubscribe and bounces for src/mail.js. GET /unsubscribe?a=<address digest>&l=<service|marketing>&t=<signed token> shows a one-button page (a mail scanner opening the link changes nothing);
// POST on the same URL (the button, or a mail client's one-click List-Unsubscribe-Post) turns that list off. Bounce/complaint events from the Email Sending queue turn every list off.
// Both also set the columns on pro_accounts (service_mail_off_at, marketing_opt_in). Guard: test/mail.test.js.
import {digestOf, equal, tokenFor} from './guard.js';

const LISTS = ['service', 'marketing'];
export const page = (title, body, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
  + `<body style="font:16px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">${title}</h1>${body}`, {status, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
const MEANING = {service: 'the daily search mails (new matches, reminders)', marketing: 'product news and offers'};

// Turns a list ('service' | 'marketing' | 'all') off for an address digest.
export async function switchOff(env, addr, list, reason, now = new Date()) {
  await env.STATS.prepare('INSERT OR REPLACE INTO mail_off (addr, list, reason, at) VALUES (?, ?, ?, ?)').bind(addr, list, reason, now.toISOString()).run();
  if (list !== 'marketing') await env.STATS.prepare('UPDATE pro_accounts SET service_mail_off_at = ? WHERE email_hash = ? AND service_mail_off_at IS NULL').bind(now.toISOString(), addr).run().catch(() => {});
  if (list !== 'service') await env.STATS.prepare('UPDATE pro_accounts SET marketing_opt_in = 0 WHERE email_hash = ?').bind(addr).run().catch(() => {});
}

export async function unsubscribe(request, env, now = new Date()) {
  const url = new URL(request.url), addr = url.searchParams.get('a') || '', list = url.searchParams.get('l') || '', token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{16}$/.test(addr) || !LISTS.includes(list) || !equal(token, await tokenFor(addr, env, `unsub-${list}`))) return page('This link does not work', '<p>It may be cut off. Open the link from the mail again.</p>', 400);
  if (request.method === 'POST') {
    await switchOff(env, addr, list, 'unsubscribe', now);
    return page('Done', `<p>You will get no more mail about ${MEANING[list]}.</p>`);
  }
  if (request.method !== 'GET') return page('Not allowed', '', 405);
  return page('Stop these mails?', `<p>This stops ${MEANING[list]}.</p><form method="post"><button style="font:inherit;padding:.5rem 1rem">Stop these mails</button></form>`);
}

// One Email Sending event (queue message body): a hard bounce or a complaint turns the address off for good.
export async function handleEvent(env, event, now = new Date()) {
  const recipient = String(event?.payload?.recipient || '').trim().toLowerCase();
  const complaint = event?.type === 'cf.email.sending.message.complained';
  const hard = event?.type === 'cf.email.sending.message.bounced' && event.payload?.bounce?.type === 'hard';
  if (!recipient || !(complaint || hard)) return false;
  await switchOff(env, await digestOf(recipient), 'all', complaint ? 'complaint' : 'bounce', now);
  return true;
}

// The Worker's queue() handler for the Email Sending events subscription.
export async function consume(batch, env) {
  for (const message of batch.messages) {
    try { await handleEvent(env, message.body); message.ack(); }
    catch (error) { console.error(`mail event: ${error.message}`); message.retry(); }
  }
}
