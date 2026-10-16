// The address a person gives Job Pilotto (onboarding, Settings → Notifications) and the mail the app or a run sends to it. The install proves itself with its AI key
// (x-api-key: JPF1.<install>.<token>). PUT/GET /api/account/email makes or reads the trial account; POST /api/notify/email mails a Telegram-style message to it;
// /confirm confirms the address. An address another account already holds is refused here (joining it takes a code sent to that address, the device sign-in). Guard: test/account-email.test.js.
import {authorize, digestOf, equal, tokenFor} from './guard.js';
import {confirmLink, validAddress, clean} from './mail.js';
import {fromTelegram} from './mail-html.js';
import {CADENCES, deliver, hold} from './mail-held.js';
import {page} from './mail-unsub.js';
import {accountOf, createAccount, link} from './pro.js';

const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };
const json = (status, body) => Response.json(body, {status});

async function who(request, env) {
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  return access?.ok ? given.install : null;
}

async function setMarketing(env, account, on, now) {
  await env.STATS.prepare('UPDATE pro_accounts SET marketing_opt_in = ?, marketing_opt_in_at = ? WHERE id = ?').bind(on ? 1 : 0, on ? now.toISOString() : null, account).run();
}

export async function address(request, env, now = new Date()) {
  const install = await who(request, env);
  if (!install || !env.STATS) return json(401, {ok: false, error: 'unauthorized'});
  let account = await accountOf(env, install);
  if (request.method === 'GET') {
    return json(200, {ok: true, email: account?.email || null, confirmed: !!account?.email_confirmed_at, marketing: !!account?.marketing_opt_in, serviceOff: !!account?.service_mail_off_at, cadence: account?.digest_cadence || 'daily', plan: account?.plan || null});
  }
  if (request.method !== 'PUT') return json(405, {ok: false});
  const body = await request.json().catch(() => ({})), email = clean(body.email);
  if (!validAddress(email)) return json(400, {ok: false, error: 'Enter an email address like you@example.com.'});
  const hash = await digestOf(email);
  if (account && account.plan === 'pro') return json(409, {ok: false, error: 'pro'});   // a Pro account's address changes only through its own sign-in
  const holder = await env.STATS.prepare('SELECT id FROM pro_accounts WHERE email_hash = ?').bind(hash).first();
  if (account && account.email_hash !== hash) {
    if (holder) return json(409, {ok: false, error: 'taken'});
    const id = `acc_${hash}`;   // a changed address is a new, unconfirmed one: same devices, same trial start
    await env.STATS.prepare('UPDATE pro_accounts SET id = ?, email_hash = ?, email = ?, email_confirmed_at = NULL, service_mail_off_at = NULL WHERE id = ?').bind(id, hash, email, account.id).run();
    await env.STATS.prepare('UPDATE pro_devices SET account = ? WHERE account = ?').bind(id, account.id).run();
    account = {...account, id};
  } else if (!account) {
    if (holder) return json(409, {ok: false, error: 'taken'});
    const id = await createAccount(env, email, now, {plan: 'trial'});
    const linked = await link(env, id, install, now);
    if (!linked.ok) return json(409, {ok: false, error: linked.error});
    account = {id};
  }
  if (typeof body.marketing === 'boolean') await setMarketing(env, account.id, body.marketing, now);
  if (CADENCES.includes(body.cadence)) await env.STATS.prepare('UPDATE pro_accounts SET digest_cadence = ? WHERE id = ?').bind(body.cadence, account.id).run();   // how often the digest comes: daily or weekly
  return json(200, {ok: true});
}

// POST /api/notify/email {subject, html, buttons?: [{text, url}], kind?: 'activity'}: 'activity' is held for the digest, anything else goes at once; `html` is the Telegram HTML the engine built (tgcard.py); only a safe subset reaches the mail (mail-html.js).
export async function notify(request, env, now = new Date()) {
  const install = await who(request, env);
  if (!install || !env.STATS) return json(401, {ok: false, error: 'unauthorized'});
  if (request.method !== 'POST') return json(405, {ok: false});
  const account = await accountOf(env, install);
  if (!account?.email) return json(200, {ok: false, reason: 'no_address'});
  const body = await request.json().catch(() => ({}));
  const {html, text} = fromTelegram(body.html);
  if (!text) return json(400, {ok: false, reason: 'empty'});
  const buttons = (Array.isArray(body.buttons) ? body.buttons : []).slice(0, 6).filter(b => b && /^https:\/\//.test(b.url) && b.text).map(b => ({text: String(b.text).slice(0, 80), url: String(b.url).slice(0, 500)}));
  const item = {subject: String(body.subject || '').slice(0, 150), html, text, buttons};
  if (body.kind === 'activity') return json(200, await hold(env, account, item, now));   // not new matches, not urgent: waits for the daily or weekly digest (src/mail-held.js)
  const result = await deliver(env, account, item, now);
  return json(200, result.ok ? {ok: true} : {ok: false, reason: result.reason});
}

// GET /confirm?a&t asks (a mail scanner opening the link confirms nothing); POST confirms.
export async function confirm(request, env, now = new Date()) {
  const url = new URL(request.url), addr = url.searchParams.get('a') || '', token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{16}$/.test(addr) || !equal(token, await tokenFor(addr, env, 'confirm'))) return page('This link does not work', '<p>It may be cut off. Open the link from the mail again.</p>', 400);
  if (request.method === 'POST') {
    await env.STATS.prepare('UPDATE pro_accounts SET email_confirmed_at = ? WHERE email_hash = ? AND email_confirmed_at IS NULL').bind(now.toISOString(), addr).run();
    return page('Email confirmed', '<p>Thank you. Your mails will keep coming.</p>');
  }
  if (request.method !== 'GET') return page('Not allowed', '', 405);
  return page('Confirm your email?', '<form method="post"><button style="font:inherit;padding:.5rem 1rem">Yes, this is my email</button></form>');
}
