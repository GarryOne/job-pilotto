// The e-mail settings page (src/mail-settings.js): the signed footer link opens it without a sign-in, a bad link is refused, saving turns service mail and product news on/off and sets the digest cadence,
// and product news is shown off and cannot be switched on while the owner's marketing flag is off. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {addrOf, mailAllowed, settingsLink} from '../src/mail.js';
import {settings} from '../src/mail-settings.js';
import {createAccount} from '../src/pro.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const now = new Date('2026-10-17T10:00:00Z');
const env = (extra = {}) => ({MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', ...extra});
const save = async (e, link, fields) => settings(new Request(link, {method: 'POST', body: new URLSearchParams(fields)}), e, now);
const accountRow = e => e.STATS.db.prepare('SELECT marketing_opt_in, service_mail_off_at, digest_cadence FROM pro_accounts').get();

test('the signed link opens the page without a sign-in; a cut-off link does not', async () => {
  const e = env();
  await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  const link = await settingsLink(e, 'me@example.com');
  const page = await settings(new Request(link), e, now);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Email settings') && html.includes('One email a day') && html.includes('name="service" checked'));
  assert.equal((await settings(new Request(link.replace(/t=\w+/, 't=00')), e, now)).status, 400);
  assert.equal((await settings(new Request(link.replace(/a=\w+/, 'a=zz')), e, now)).status, 400);
});

test('saving turns service mail off and on and sets the digest cadence', async () => {
  const e = env(), id = await createAccount(e, 'me@example.com', now, {plan: 'trial'}), link = await settingsLink(e, 'me@example.com');
  await save(e, link, {cadence: 'weekly'});   // service box unticked = off
  assert.equal(accountRow(e).digest_cadence, 'weekly');
  assert.ok(accountRow(e).service_mail_off_at);
  assert.equal((await mailAllowed(e, 'me@example.com', 'service')).reason, 'unsubscribed');
  await save(e, link, {service: 'on', cadence: 'daily'});
  assert.equal(accountRow(e).service_mail_off_at, null);
  assert.equal((await mailAllowed(e, 'me@example.com', 'service')).ok, true);
  assert.equal(accountRow(e).digest_cadence, 'daily');
  await save(e, link, {service: 'on', cadence: 'hourly'});
  assert.equal(accountRow(e).digest_cadence, 'daily', 'an unknown cadence changes nothing');
  assert.ok(id);
});

test('product news shows off and cannot be switched on while the marketing flag is off; with the flag on it can', async () => {
  const e = env(), link = await settingsLink(e, 'me@example.com');
  await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  e.STATS.db.prepare('UPDATE pro_accounts SET marketing_opt_in = 1').run();   // the wizard's pre-checked box is recorded for later
  const html = await (await settings(new Request(link), e, now)).text();
  assert.ok(/name="marketing" disabled/.test(html) && html.includes('We are not sending any product news right now'));
  await save(e, link, {service: 'on', marketing: 'on'});
  assert.equal(accountRow(e).marketing_opt_in, 1, 'the recorded opt-in is left as it was');
  const on = {...e, MARKETING_MAIL: 'on'};
  await save(on, link, {service: 'on'});
  assert.equal(accountRow(e).marketing_opt_in, 0);
  await save(on, link, {service: 'on', marketing: 'on'});
  assert.equal(accountRow(e).marketing_opt_in, 1);
});

test('after a bounce or complaint the page says so and changes nothing', async () => {
  const e = env();
  await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'all', 'bounce', 'x')").run(await addrOf('me@example.com'));
  const link = await settingsLink(e, 'me@example.com');
  assert.ok((await (await settings(new Request(link), e, now)).text()).includes('Mail to this address is stopped'));
  await save(e, link, {service: 'on', cadence: 'weekly'});
  assert.equal(accountRow(e).service_mail_off_at, null);
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_off WHERE list = 'all'").get().n, 1);
});
