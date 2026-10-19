// The Stripe adapter of the payment layer (spec docs/superpowers/specs/2026-10-16-pro-plan.md §2): the only file that knows Stripe. It creates a Checkout Session
// (one-time payment) and turns a signed webhook into OUR event shape, so the ledger, the accounts and the app never see a Stripe field. No SDK: fetch to the API,
// so tests inject a fake. A merchant of record later = one more file like this one. Guards: site/test/pro-stripe.test.js. Secrets (Worker): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
import {equal} from '../guard.js';

const API = 'https://api.stripe.com/v1';
export const TOLERANCE_SECONDS = 300;
const PRICE_VAR = {pro: 'STRIPE_PRICE_PRO', topup5: 'STRIPE_PRICE_TOPUP5', topup10: 'STRIPE_PRICE_TOPUP10', topup20: 'STRIPE_PRICE_TOPUP20'};
const form = fields => new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')).toString();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

// Test keys belong to the "test" plan mode and live keys to "live": a mix is refused before any money moves (never real cards in test mode).
export const keyMatchesMode = env => (env.PRO_PLAN === 'live' ? String(env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') : String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'));

// -> {url} for a one-time Checkout Session, or {error} in words. `install` rides as client_reference_id so the webhook links this device.
export async function createCheckout(env, {kind, install, successUrl, cancelUrl}, fetcher = fetch) {
  const price = env[PRICE_VAR[kind]];
  if (!price || !env.STRIPE_SECRET_KEY) return {error: 'Payments are not set up yet.'};
  const body = form({mode: 'payment', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: install, 'metadata[kind]': kind, 'metadata[install]': install,
    success_url: successUrl, cancel_url: cancelUrl, billing_address_collection: 'required', customer_creation: 'always',
    'consent_collection[terms_of_service]': 'required', 'custom_text[terms_of_service_acceptance][message]': 'I agree to the Terms. I ask for the service to start now and know my 14-day right of withdrawal ends once it has started, but Jobadabra refunds within 14 days on request.',
    'automatic_tax[enabled]': env.STRIPE_TAX === 'on' ? 'true' : 'false'});
  const response = await fetcher(`${API}/checkout/sessions`, {method: 'POST', headers: {authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded'}, body});
  const session = await response.json().catch(() => ({}));
  return response.ok && session.url ? {url: session.url} : {error: 'Payments are not available right now.'};
}

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

// The raw body and the request's headers (Stripe-Signature: `t=…,v1=…`) -> our event, or null (unsigned, forged, too old, or not an event we act on).
// {id, type: 'paid' | 'refunded' | 'disputed' | 'ignored', ref: the payment's id (the same on the paid, refunded and disputed events), …}
export async function verifyEvent(rawBody, headers, env, now = new Date()) {
  const header = headers?.get?.('stripe-signature');
  const parts = Object.fromEntries(String(header || '').split(',').map(part => part.split('=')).filter(pair => pair.length === 2));
  if (!env.STRIPE_WEBHOOK_SECRET || !parts.t || !parts.v1) return null;
  if (Math.abs(now.getTime() / 1000 - Number(parts.t)) > TOLERANCE_SECONDS) return null;
  if (!equal(parts.v1, await sign(env.STRIPE_WEBHOOK_SECRET, `${parts.t}.${rawBody}`))) return null;
  let event;
  try { event = JSON.parse(rawBody); } catch { return null; }
  const object = event?.data?.object || {};
  if (event.type === 'checkout.session.completed' && object.payment_status === 'paid') {
    return {id: event.id, type: 'paid', ref: object.payment_intent, kind: object.metadata?.kind, install: object.client_reference_id || object.metadata?.install, email: object.customer_details?.email,
      amountCents: object.amount_total, currency: String(object.currency || '').toLowerCase(), country: object.customer_details?.address?.country || null, taxCents: object.total_details?.amount_tax ?? null};
  }
  if (event.type === 'charge.refunded') return {id: event.id, type: 'refunded', ref: object.payment_intent, refundedCents: object.amount_refunded, amountCents: object.amount};
  if (event.type === 'charge.dispute.created') return {id: event.id, type: 'disputed', ref: object.payment_intent};
  return {id: event.id, type: 'ignored'};
}

// The processor fee of a payment in cents (from its balance transaction), or null when it cannot be read yet.
export async function feeOf(env, ref, fetcher = fetch) {
  try {
    const response = await fetcher(`${API}/payment_intents/${encodeURIComponent(ref)}?expand[]=latest_charge.balance_transaction`, {headers: {authorization: `Bearer ${env.STRIPE_SECRET_KEY}`}});
    const fee = (await response.json())?.latest_charge?.balance_transaction?.fee;
    return response.ok && Number.isInteger(fee) ? fee : null;
  } catch { return null; }
}
