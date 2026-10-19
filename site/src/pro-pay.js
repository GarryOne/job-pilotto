// Paying for Pro and top-ups (spec docs/superpowers/specs/2026-10-16-pro-plan.md §2): POST /api/pro/checkout starts a one-time payment, POST /api/pro/webhook
// turns the provider's signed events into accounts, devices, purchases and credit (src/pro.js), and takes the credit back on a refund or a dispute. The provider
// is only reached through ./payments (one adapter, Stripe today). Replay-safe: an event id and a payment's ref are each handled once. Guards: test/pro-stripe.test.js.
import {authorize} from './guard.js';
import {addCredit, createAccount, link, makePro, planOn} from './pro.js';
import {createCheckout, feeOf, keyMatchesMode, providerName, verifyEvent} from './payments/index.js';

// What each purchase adds, in micro-USD (owner, 16 Oct 2026): Pro includes $5 of AI credit; top-ups are VAT-included prices with the margin kept ($5 → $2.80, $10 → $5.80, $20 → $11.80).
export const CREDIT = {pro: 5_000_000, topup5: 2_800_000, topup10: 5_800_000, topup20: 11_800_000};
const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };   // the install's Free AI key
const json = (body, status = 200) => Response.json(body, {status});

// POST /api/pro/checkout {kind} with x-api-key: JPF1.<install>.<token> -> {ok, url} (the app opens it in the browser).
export async function checkout(request, env, now = new Date(), fetcher = fetch) {
  if (!planOn(env)) return new Response('Not found', {status: 404});
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const given = parseKey(request.headers.get('x-api-key')), access = given && await authorize(env, given.install, given.token, 'ai');
  if (!access?.ok) return json({ok: false, error: 'unauthorized'}, 401);
  const body = await request.json().catch(() => ({}));
  if (!Object.hasOwn(CREDIT, body.kind)) return json({ok: false, error: 'Unknown purchase.'}, 400);
  if (!keyMatchesMode(env)) return json({ok: false, error: 'Payments are not available right now.'}, 503);   // a test key in live mode (or the reverse) never reaches the provider
  const hour = `procheckout:${access.who}:${now.toISOString().slice(0, 13)}`, used = Number(await env.WAITLIST?.get(hour)) || 0;
  if (used >= 20) return json({ok: false, error: 'Too many attempts. Try again in an hour.'}, 429);
  await env.WAITLIST?.put(hour, String(used + 1), {expirationTtl: 7200});
  const home = env.PRO_RETURN_URL || 'https://www.jobadabra.top/';
  const made = await createCheckout(env, {kind: body.kind, install: given.install, successUrl: `${home}?pro=thanks`, cancelUrl: `${home}?pro=cancelled`}, fetcher);
  return made.url ? json({ok: true, url: made.url}) : json({ok: false, error: made.error}, 503);
}

const changed = result => (result?.meta?.changes ?? result?.changes ?? 0) > 0;

// A payment arrived: the e-mail's account (made on the first one), this device linked, the purchase kept, the credit added. A second delivery adds nothing.
async function paid(env, event, fetcher, now) {
  if (!Object.hasOwn(CREDIT, event.kind) || !event.email || !event.ref) return;
  const account = await createAccount(env, event.email, now);
  const fee = await feeOf(env, event.ref, fetcher);
  const made = await env.STATS.prepare(`INSERT OR IGNORE INTO pro_purchases (id, account, kind, amount_cents, currency, credit_micro, status, at, provider, provider_ref, country, tax_cents, fee_cents)
    VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?)`).bind(`pur_${event.id}`, account, event.kind, event.amountCents, event.currency, CREDIT[event.kind], now.toISOString(), providerName(env), event.ref, event.country, event.taxCents, fee).run();
  if (!changed(made)) return;
  await makePro(env, account);   // a trial account (same e-mail) becomes Pro
  if (event.install) await link(env, account, event.install, now);   // refused when this account has 3 devices already: the credit is the account's anyway
  await env.STATS.prepare("UPDATE pro_accounts SET status = 'active' WHERE id = ? AND status = 'refunded'").bind(account).run();   // buying again after a refund
  await addCredit(env, account, CREDIT[event.kind], 'purchase', event.ref, now);
}

// A refund (cumulative on the provider's side) takes back the matching share of the purchase's credit; a refunded Pro also stops being Pro. A dispute takes it all and holds the account.
async function reversed(env, event, now) {
  const purchase = await env.STATS.prepare('SELECT * FROM pro_purchases WHERE provider = ? AND provider_ref = ?').bind(providerName(env), event.ref).first();
  if (!purchase || purchase.status !== 'paid') return;
  const disputed = event.type === 'disputed', share = disputed || event.refundedCents >= event.amountCents ? 1 : Math.min(1, event.refundedCents / event.amountCents);
  const taken = -((await env.STATS.prepare("SELECT COALESCE(SUM(delta_micro), 0) AS n FROM pro_credit WHERE account = ? AND reason = 'refund' AND ref = ?").bind(purchase.account, event.ref).first()).n);
  const delta = Math.round(purchase.credit_micro * (purchase.kind === 'pro' ? 1 : share)) - taken;
  if (delta > 0) await addCredit(env, purchase.account, -delta, 'refund', event.ref, now);
  const full = disputed || purchase.kind === 'pro' || share >= 1;
  if (full) await env.STATS.prepare('UPDATE pro_purchases SET status = ? WHERE id = ?').bind(disputed ? 'disputed' : 'refunded', purchase.id).run();
  if (disputed) await env.STATS.prepare("UPDATE pro_accounts SET status = 'disputed' WHERE id = ?").bind(purchase.account).run();
  else if (purchase.kind === 'pro') await env.STATS.prepare("UPDATE pro_accounts SET status = 'refunded' WHERE id = ? AND status = 'active'").bind(purchase.account).run();
}

// POST /api/pro/webhook: signature checked on the raw body first; anything unsigned is a 400 and writes nothing.
export async function webhook(request, env, now = new Date(), fetcher = fetch) {
  if (!planOn(env)) return new Response('Not found', {status: 404});
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const raw = await request.text();
  const event = await verifyEvent(raw, request.headers, env, now);
  if (!event) return json({ok: false}, 400);
  const first = await env.STATS.prepare('INSERT OR IGNORE INTO payment_events (id, provider, at) VALUES (?, ?, ?)').bind(event.id, providerName(env), now.toISOString()).run();
  if (!changed(first)) return json({ok: true, replay: true});
  try {
    if (event.type === 'paid') await paid(env, event, fetcher, now);
    else if (event.type === 'refunded' || event.type === 'disputed') await reversed(env, event, now);
  } catch {
    await env.STATS.prepare('DELETE FROM payment_events WHERE id = ? AND provider = ?').bind(event.id, providerName(env)).run().catch(() => {});   // so the provider's retry is handled
    return json({ok: false}, 500);
  }
  return json({ok: true});
}
