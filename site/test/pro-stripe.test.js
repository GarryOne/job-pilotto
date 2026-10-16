// Paying for Pro and top-ups (src/pro-pay.js, src/payments/): checkout, the signed webhook, credit, refunds and disputes, against a fake Stripe (nothing reaches the network).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../src/guard.js';
import {status} from '../src/pro.js';
import {CREDIT, checkout, webhook} from '../src/pro-pay.js';

const SECRET = 'whsec_test_secret';
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const env = (extra = {}) => ({WAITLIST: kv(), STATS: d1(), STATS_SALT: 'salt', PRO_PLAN: 'test', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_TOPUP5: 'price_t5', STRIPE_PRICE_TOPUP10: 'price_t10', STRIPE_PRICE_TOPUP20: 'price_t20', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-16T10:00:00Z');
const hmac = async (secret, text) => { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''); };
// A fake Stripe: records every call; the payment's balance transaction carries a fee unless `fee` is null.
const stripeFake = (fee = 88) => { const calls = []; return {calls, fetcher: async (url, init = {}) => { calls.push({url: String(url), init});
  if (String(url).includes('/checkout/sessions')) return Response.json({url: 'https://checkout.stripe.test/c/pay_1'});
  return fee === null ? new Response('{}', {status: 500}) : Response.json({latest_charge: {balance_transaction: {fee}}}); }}; };
const sessionEvent = (id, kind, extra = {}) => ({id, type: 'checkout.session.completed', data: {object: {payment_status: 'paid', payment_intent: `pi_${id}`, client_reference_id: 'install-buyer-1', metadata: {kind},
  customer_details: {email: 'Buyer@Example.com', address: {country: 'CH'}}, amount_total: 1900, currency: 'USD', total_details: {amount_tax: 142}, ...extra}}});
const refundEvent = (id, pi, refunded, amount) => ({id, type: 'charge.refunded', data: {object: {payment_intent: pi, amount_refunded: refunded, amount}}});
const post = async (e, event, {secret = SECRET, at = now, body = JSON.stringify(event), signed = body, fake = stripeFake()} = {}) => {
  const t = Math.floor(at.getTime() / 1000), signature = `t=${t},v1=${await hmac(secret, `${t}.${signed}`)}`;
  return webhook(new Request('https://x/api/pro/webhook', {method: 'POST', headers: {'stripe-signature': signature}, body}), e, now, fake.fetcher);
};
const rows = (e, sql, ...args) => e.STATS.db.prepare(sql).all(...args).map(r => ({...r}));
const one = (e, sql, ...args) => ({...e.STATS.db.prepare(sql).get(...args)});

test('a webhook that is not genuinely signed is a 400 and writes nothing: no header, wrong secret, tampered body, too old', async () => {
  const e = env(), event = sessionEvent('evt_1', 'pro'), good = JSON.stringify(event);
  const answers = [await webhook(new Request('https://x/api/pro/webhook', {method: 'POST', body: good}), e, now), await post(e, event, {secret: 'whsec_other'}),
    await post(e, event, {at: new Date(now.getTime() - 301_000)}), await post(e, event, {body: good.replace('1900', '100'), signed: good})];
  assert.deepEqual(answers.map(r => r.status), [400, 400, 400, 400]);
  assert.equal(rows(e, 'SELECT * FROM pro_accounts').length + rows(e, 'SELECT * FROM pro_purchases').length + rows(e, 'SELECT * FROM payment_events').length, 0);
  assert.equal((await post(e, event, {at: new Date(now.getTime() - 299_000)})).status, 200, 'inside the 5-minute window it is accepted');
});

test('every handled event, in one loop: a Pro payment and each top-up add exactly their credit, the account and the device, with country, VAT and fee kept', async () => {
  assert.deepEqual(CREDIT, {pro: 5_000_000, topup5: 2_800_000, topup10: 5_800_000, topup20: 11_800_000}, 'the owner\'s numbers: $5 included, $2.80 / $5.80 / $11.80');
  for (const kind of Object.keys(CREDIT)) {
    const e = env(), response = await post(e, sessionEvent(`evt_${kind}`, kind));
    assert.equal(response.status, 200, kind);
    assert.deepEqual(one(e, 'SELECT credit_micro, credit_added_micro, status FROM pro_accounts'), {credit_micro: CREDIT[kind], credit_added_micro: CREDIT[kind], status: 'active'}, kind);
    assert.deepEqual(one(e, 'SELECT install FROM pro_devices'), {install: 'install-buyer-1'}, 'the paying device is linked, as the raw install id');
    assert.deepEqual(one(e, 'SELECT kind, status, amount_cents, currency, country, tax_cents, fee_cents, provider, provider_ref, credit_micro FROM pro_purchases'),
      {kind, status: 'paid', amount_cents: 1900, currency: 'usd', country: 'CH', tax_cents: 142, fee_cents: 88, provider: 'stripe', provider_ref: `pi_evt_${kind}`, credit_micro: CREDIT[kind]}, kind);
    assert.deepEqual(one(e, 'SELECT reason, delta_micro FROM pro_credit'), {reason: 'purchase', delta_micro: CREDIT[kind]});
  }
});

test('the e-mail is the account: a second payment adds to the same account; the processor fee stays null until it can be read', async () => {
  const e = env(), fake = stripeFake(null);
  await post(e, sessionEvent('evt_a', 'pro'), {fake});
  await post(e, sessionEvent('evt_b', 'topup5', {customer_details: {email: ' buyer@example.com', address: {country: 'DE'}}}), {fake});
  assert.equal(rows(e, 'SELECT * FROM pro_accounts').length, 1);
  assert.equal(one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, CREDIT.pro + CREDIT.topup5);
  assert.deepEqual(rows(e, 'SELECT fee_cents FROM pro_purchases').map(r => r.fee_cents), [null, null]);
});

test('a replay of the same event, or a second event for the same payment, adds nothing', async () => {
  const e = env();
  await post(e, sessionEvent('evt_r', 'pro'));
  assert.deepEqual(await (await post(e, sessionEvent('evt_r', 'pro'))).json(), {ok: true, replay: true});
  await post(e, sessionEvent('evt_r2', 'pro', {payment_intent: 'pi_evt_r'}));   // another event id, the same payment
  assert.equal(one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, CREDIT.pro);
  assert.equal(rows(e, 'SELECT * FROM pro_purchases').length, 1);
});

test('events we do not act on are acknowledged and change nothing; an unpaid session adds no credit', async () => {
  const e = env();
  assert.equal((await post(e, {id: 'evt_x', type: 'customer.created', data: {object: {}}})).status, 200);
  assert.equal((await post(e, sessionEvent('evt_u', 'pro', {payment_status: 'unpaid'}))).status, 200);
  assert.equal(rows(e, 'SELECT * FROM pro_accounts').length, 0);
});

test('a refunded Pro takes its credit back and stops being Pro; a refunded top-up takes back its share only, floored at 0; buying again restores Pro', async () => {
  const e = env(), pro = async () => (await (await status(new Request('https://x/api/pro/status', {headers: {'x-api-key': await keyOf('install-buyer-1')}}), e)).json()).plan;
  await post(e, sessionEvent('evt_p', 'pro')); await post(e, sessionEvent('evt_t', 'topup10', {payment_intent: 'pi_top', amount_total: 1000}));
  assert.equal(await pro(), 'pro');
  e.STATS.db.prepare('UPDATE pro_accounts SET credit_micro = ?').run(3_000_000);   // part of it spent
  await post(e, refundEvent('evt_r0', 'pi_top', 500, 1000));   // half of the top-up refunded: half of its credit (2.90)
  assert.equal(one(e, 'SELECT status FROM pro_purchases WHERE provider_ref = ?', 'pi_top').status, 'paid', 'a partial refund keeps the purchase');
  assert.equal(one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, 3_000_000 - 2_900_000);
  await post(e, refundEvent('evt_r1', 'pi_top', 1000, 1000));   // now the whole refund (cumulative): the other half
  assert.equal(one(e, 'SELECT status FROM pro_purchases WHERE provider_ref = ?', 'pi_top').status, 'refunded');
  assert.equal(one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, 0, '0.10 - 2.90 floors at 0');
  assert.equal(await pro(), 'pro', 'a top-up refund keeps Pro');
  await post(e, refundEvent('evt_r2', 'pi_evt_p', 1900, 1900));
  assert.deepEqual([one(e, 'SELECT status FROM pro_accounts').status, await pro()], ['refunded', 'free']);
  await post(e, refundEvent('evt_r3', 'pi_evt_p', 1900, 1900));   // the same refund again: nothing more
  await post(e, sessionEvent('evt_again', 'pro', {payment_intent: 'pi_second'}));
  assert.deepEqual([one(e, 'SELECT status FROM pro_accounts').status, await pro()], ['active', 'pro'], 'buying again restores Pro');
});

test('a dispute takes the purchase\'s credit and holds the account (no Pro until the owner decides)', async () => {
  const e = env(), asked = async () => (await (await status(new Request('https://x/api/pro/status', {headers: {'x-api-key': await keyOf('install-buyer-1')}}), e)).json()).plan;
  await post(e, sessionEvent('evt_d', 'pro'));
  await post(e, {id: 'evt_dd', type: 'charge.dispute.created', data: {object: {payment_intent: 'pi_evt_d'}}});
  assert.deepEqual([one(e, 'SELECT status FROM pro_accounts').status, one(e, 'SELECT status FROM pro_purchases').status, one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, await asked()], ['disputed', 'disputed', 0, 'free']);
  await post(e, sessionEvent('evt_after', 'pro', {payment_intent: 'pi_other'}));
  assert.equal(one(e, 'SELECT status FROM pro_accounts').status, 'disputed', 'a payment after a dispute does not reopen the account');
});

test('a failure while handling is a 500 and the event is forgotten, so the provider\'s retry is handled', async () => {
  const e = env(), event = sessionEvent('evt_f', 'pro');
  e.STATS.db.exec('ALTER TABLE pro_purchases RENAME TO pro_purchases_gone');
  assert.equal((await post(e, event)).status, 500);
  assert.equal(rows(e, 'SELECT * FROM payment_events').length, 0);
  e.STATS.db.exec('ALTER TABLE pro_purchases_gone RENAME TO pro_purchases');
  assert.equal((await post(e, event)).status, 200);
  assert.equal(one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, CREDIT.pro);
});

const checkoutRequest = async (kind, {key, method = 'POST'} = {}) => new Request('https://x/api/pro/checkout', {method, headers: {'x-api-key': key ?? await keyOf('install-buyer-1')}, ...(method === 'POST' ? {body: JSON.stringify({kind})} : {})});

test('checkout: a one-time payment for the install, with the terms consent and billing country; the secret never leaves the request header', async () => {
  const e = env({STRIPE_TAX: 'on'}), fake = stripeFake(), response = await checkout(await checkoutRequest('pro'), e, now, fake.fetcher);
  assert.deepEqual(await response.json(), {ok: true, url: 'https://checkout.stripe.test/c/pay_1'});
  const [{url, init}] = fake.calls, sent = new URLSearchParams(init.body);
  assert.match(url, /\/v1\/checkout\/sessions$/);
  assert.equal(init.headers.authorization, 'Bearer sk_test_fake');
  assert.deepEqual([sent.get('mode'), sent.get('line_items[0][price]'), sent.get('client_reference_id'), sent.get('metadata[kind]'), sent.get('consent_collection[terms_of_service]'),
    sent.get('billing_address_collection'), sent.get('automatic_tax[enabled]')], ['payment', 'price_pro', 'install-buyer-1', 'pro', 'required', 'required', 'true']);
  assert.doesNotMatch(init.body, /sk_test/);
  for (const kind of ['topup5', 'topup10', 'topup20']) assert.equal(new URLSearchParams((await (async () => { const f = stripeFake(); await checkout(await checkoutRequest(kind), e, now, f.fetcher); return f.calls[0].init; })()).body).get('line_items[0][price]'), `price_t${kind.slice(5)}`);
});

test('checkout refuses: plan off (404), a bad key (401), an unknown purchase (400), a test key in live mode (503), no price set (503), too many tries (429)', async () => {
  const fake = stripeFake(), ask = async (e, request = null) => (await checkout(request || await checkoutRequest('pro'), e, now, fake.fetcher)).status;
  assert.equal(await ask(env({PRO_PLAN: 'off'})), 404);
  assert.equal(await ask(env(), await checkoutRequest('pro', {key: 'JPF1.install-buyer-1.deadbeef'})), 401);
  assert.equal(await ask(env(), await checkoutRequest('lifetime')), 400);
  assert.equal(await ask(env({PRO_PLAN: 'live'})), 503, 'sk_test_ key while live');
  assert.equal(await ask(env({STRIPE_PRICE_PRO: ''})), 503);
  const e = env();
  for (let i = 0; i < 20; i++) await ask(e);
  assert.equal(await ask(e), 429);
  assert.equal(fake.calls.length, 20, 'only the allowed tries reached the provider');
});

test('the payment layer is the only place that knows Stripe: no Stripe field or header name outside src/payments/stripe.js', () => {
  const src = new URL('../src/', import.meta.url);
  for (const file of ['pro-pay.js', 'pro.js', 'pro-ai.js']) {   // (payments/index.js is the registry of adapters: it names them)
    const code = readFileSync(new URL(file, src), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).map(line => line.replace(/\s\/\/ .*$/, '')).join('\n');
    assert.doesNotMatch(code, /stripe|cs_|pi_|checkout\.session|payment_intent|client_reference/i, `${file} stays provider-neutral`);
  }
  assert.ok(readdirSync(new URL('payments/', src)).includes('stripe.js'));
});
