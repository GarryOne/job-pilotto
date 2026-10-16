// Trial accounts (migrations/0082_pro_trial.sql, src/pro.js): the onboarding account that has no payment yet. It shares the e-mail, devices and later purchase with a Pro account,
// but never gets the Pro lane or credit; a payment on the same e-mail flips it to Pro. `status` keeps meaning the payment state.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {freeAi, DAY_MESSAGE} from '../src/free-ai.js';
import {tokenFor} from '../src/guard.js';
import {addCredit, createAccount, link, status} from '../src/pro.js';
import {webhook} from '../src/pro-pay.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1(files = ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql']) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const env = (extra = {}) => ({WAITLIST: kv(), STATS: d1(), STATS_SALT: 'salt', PRO_PLAN: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_t', AI: {run: async () => ({choices: [{message: {content: 'hi'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1000, completion_tokens: 1000}}), toMarkdown: async () => []}, ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-16T10:00:30Z');
const one = (e, text, ...args) => ({...e.STATS.db.prepare(text).get(...args)});
const ask = (e, key) => freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': key}, body: JSON.stringify({max_tokens: 10, messages: [{role: 'user', content: 'x'}]})}), e, now);
const asStatus = async (e, install) => (await (await status(new Request('https://x/api/pro/status', {headers: {'x-api-key': await keyOf(install)}}), e)).json()).plan;

test('a trial account records its start; the columns for the wizard and the mails exist with safe defaults', async () => {
  const e = env(), id = await createAccount(e, 'Trial@Example.com', now, {plan: 'trial'});
  assert.deepEqual(one(e, 'SELECT plan, status, trial_started_at, email_confirmed_at, marketing_opt_in, marketing_opt_in_at, service_mail_off_at, credit_micro FROM pro_accounts WHERE id = ?', id),
    {plan: 'trial', status: 'active', trial_started_at: now.toISOString(), email_confirmed_at: null, marketing_opt_in: 0, marketing_opt_in_at: null, service_mail_off_at: null, credit_micro: 0});
});

test('rows made before this migration are Pro (a purchase made them); asking for a trial later never downgrades or restarts an account', async () => {
  const old = {STATS: d1(['0015_ai_calls.sql', '0079_pro.sql'])};
  old.STATS.db.exec("INSERT INTO pro_accounts (id, email_hash, email, created_at) VALUES ('a1', 'h', 'old@example.com', '2026-10-01')");
  old.STATS.db.exec(sql('0082_pro_trial.sql'));
  assert.equal(one(old, 'SELECT plan FROM pro_accounts').plan, 'pro');
  const e = env(), first = await createAccount(e, 'p@example.com', now), again = await createAccount(e, 'p@example.com', new Date(now.getTime() + 86400000), {plan: 'trial'});
  assert.equal(first, again);
  assert.deepEqual(one(e, 'SELECT plan, trial_started_at FROM pro_accounts'), {plan: 'pro', trial_started_at: null});
});

test('a trial account is Free: status says free, the AI keeps the Free rules even if credit were ever there, and its devices still link', async () => {
  const e = env(), id = await createAccount(e, 't@example.com', now, {plan: 'trial'});
  assert.equal((await link(e, id, 'install-trial-1', now)).ok, true);
  await addCredit(e, id, 5_000_000, 'adjust', 'test', now);
  assert.equal(await asStatus(e, 'install-trial-1'), 'free');
  const {digestOf} = await import('../src/guard.js');
  e.WAITLIST.m.set(`freeai:dusd:${await digestOf('install-trial-1')}:2026-10-16`, String(0.5 * 1e6));
  const refused = await ask(e, await keyOf('install-trial-1'));
  assert.equal(refused.status, 429); assert.equal((await refused.json()).error.message, DAY_MESSAGE);
  assert.equal(one(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, 5_000_000, 'nothing was debited');
});

test('a payment on the same e-mail flips the trial account to Pro: same account, same device, credit added, trial start kept', async () => {
  const e = env(), id = await createAccount(e, 'Buyer@Example.com', now, {plan: 'trial'});
  await link(e, id, 'install-buyer-1', now);
  const event = {id: 'evt_t1', type: 'checkout.session.completed', data: {object: {payment_status: 'paid', payment_intent: 'pi_t1', client_reference_id: 'install-buyer-1', metadata: {kind: 'pro'},
    customer_details: {email: ' buyer@example.com', address: {country: 'CH'}}, amount_total: 1900, currency: 'usd', total_details: {amount_tax: 142}}}};
  const body = JSON.stringify(event), t = Math.floor(now.getTime() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_t'), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const v1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const response = await webhook(new Request('https://x/api/pro/webhook', {method: 'POST', headers: {'stripe-signature': `t=${t},v1=${v1}`}, body}), e, now, async () => new Response('{}', {status: 500}));
  assert.equal(response.status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM pro_accounts').get().n, 1, 'one account');
  assert.deepEqual(one(e, 'SELECT id, plan, credit_micro, trial_started_at FROM pro_accounts'), {id, plan: 'pro', credit_micro: 5_000_000, trial_started_at: now.toISOString()});
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM pro_devices').get().n, 1);
  assert.equal(await asStatus(e, 'install-buyer-1'), 'pro');
});
