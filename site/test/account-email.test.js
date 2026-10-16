// The address and the Telegram-style mail (src/account-email.js, src/mail-html.js): making a trial account from an install, refusing a taken or Pro address, the safe HTML subset,
// two mails to an unconfirmed address, confirming it with a signed link, and the marketing opt-in. Fake sender only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address, confirm, notify} from '../src/account-email.js';
import {sendDigests} from '../src/mail-held.js';
import {fromTelegram} from '../src/mail-html.js';
import {confirmLink} from '../src/mail.js';
import {tokenFor} from '../src/guard.js';
import {createAccount} from '../src/pro.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const setup = () => { const sent = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}}; return {e, sent}; };
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const call = async (fn, e, install, method, body) => { const r = await fn(new Request('https://x/api', {method, headers: {'x-api-key': await keyOf(install)}, ...(body && {body: JSON.stringify(body)})}), e, new Date('2026-10-16T10:00:00Z')); return {status: r.status, ...(await r.json())}; };
const card = '<b>3 new matches</b>\nTop: <a href="https://x.example/1">Data Engineer</a> &amp; more';

test('fromTelegram keeps bold, italics and https links; shows every other tag as text; closes what is left open', () => {
  const {html, text} = fromTelegram('<b>Hi <script>alert(1)</script></b> <a href="javascript:x">bad</a> <a href="https://a.co/?x=1&amp;y=2">ok</a> <i>open');
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script') && !html.includes('javascript:'));
  assert.ok(html.includes('<a href="https://a.co/?x=1&amp;y=2">ok</a>') && html.endsWith('</i>'));
  assert.ok(text.includes('ok (https://a.co/?x=1&y=2)'));
});

test('an install gives its address once: a trial account with the install linked; a second install on a taken address is refused; Pro is refused', async () => {
  const {e} = setup();
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'not an address'})).status, 400);
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'Me@Example.com', marketing: true})).ok, true);
  const got = await call(address, e, 'install-aaaa', 'GET');
  assert.deepEqual([got.email, got.confirmed, got.marketing, got.plan], ['me@example.com', false, true, 'trial']);
  assert.equal((await call(address, e, 'install-bbbb', 'PUT', {email: 'me@example.com'})).error, 'taken');
  const pro = await createAccount(e, 'pro@example.com');
  e.STATS.db.prepare("UPDATE pro_accounts SET plan = 'pro' WHERE id = ?").run(pro);
  e.STATS.db.prepare('INSERT INTO pro_devices (install, account, added_at, last_seen) VALUES (?, ?, ?, ?)').run('install-pppp', pro, 'x', 'x');
  assert.equal((await call(address, e, 'install-pppp', 'PUT', {email: 'other@example.com'})).error, 'pro');
  assert.equal((await call(address, e, 'install-zzzz', 'GET')).email, null);
  assert.equal((await address(new Request('https://x/api', {method: 'GET'}), e)).status, 401);
});

test('changing the address makes a new unconfirmed one on the same devices; the opt-in can be switched off', async () => {
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'a@example.com', marketing: true});
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-15');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'b@example.com', marketing: false});
  const got = await call(address, e, 'install-aaaa', 'GET');
  assert.deepEqual([got.email, got.confirmed, got.marketing], ['b@example.com', false, false]);
});

test('a message is mailed in the Telegram layout with a confirm link; an unconfirmed address gets two mails, then none; confirming lifts it', async () => {
  const {e, sent} = setup();
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 'x', html: card})).reason, 'no_address');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: '3 new matches', html: card, buttons: [{text: 'Open', url: 'https://x.example/app'}, {text: 'bad', url: 'javascript:1'}]})).ok, true);
  assert.equal(sent[0].subject, '3 new matches');
  assert.ok(sent[0].html.includes('Data Engineer') && sent[0].html.includes('/confirm?a=') && sent[0].text.includes('Open: https://x.example/app') && !sent[0].text.includes('javascript'));
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).ok, true);
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).reason, 'unconfirmed');
  const link = await confirmLink(e, 'me@example.com');
  assert.equal((await confirm(new Request(link), e)).status, 200);
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).confirmed, false, 'a GET (a mail scanner) confirms nothing');
  assert.equal((await confirm(new Request(link.replace(/t=\w+/, 't=00'), {method: 'POST'}), e)).status, 400);
  assert.equal((await confirm(new Request(link, {method: 'POST'}), e)).status, 200);
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).confirmed, true);
  const last = sent.length;
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).ok, true);
  assert.ok(!sent[last].html.includes('/confirm?a='));
});

test('an empty message and a person who switched the service list off send nothing', async () => {
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: ''})).status, 400);
  e.STATS.db.prepare('UPDATE pro_accounts SET service_mail_off_at = ?').run('2026-10-16');
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).reason, 'unsubscribed');
  assert.equal(sent.length, 0);
});

test('an "activity" message waits for the digest; one mail a day with everything, weekly on Mondays for a weekly account; matches and the rest go at once', async () => {
  const {e, sent} = setup(), mon = new Date('2026-10-19T06:00:00Z'), tue = new Date('2026-10-20T06:00:00Z');
  await call(address, e, 'install-held', 'PUT', {email: 'me@example.com'});
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-01');
  const first = await call(notify, e, 'install-held', 'POST', {subject: 'Matches', html: card}); assert.equal(first.ok, true);   // new matches: at once
  assert.equal(sent.length, 1);
  assert.equal((await call(notify, e, 'install-held', 'POST', {subject: 'Rejection from Acme', html: '<b>Acme said no</b>', kind: 'activity'})).held, true);
  assert.equal((await call(notify, e, 'install-held', 'POST', {subject: 'Insight', html: '<b>Insight ready</b>', kind: 'activity'})).held, true);
  assert.equal(sent.length, 1, 'held, not sent');
  assert.deepEqual(await sendDigests(e, tue), {sent: 1, kept: 0});
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /2 items/);
  assert.ok(sent[1].text.includes('Acme said no') && sent[1].text.includes('Insight ready'));
  assert.deepEqual(await sendDigests(e, tue), {sent: 0, kept: 0}, 'nothing held, nothing sent');
  assert.equal((await call(address, e, 'install-held', 'PUT', {email: 'me@example.com', cadence: 'weekly'})).ok, true);
  assert.equal((await call(address, e, 'install-held', 'GET')).cadence, 'weekly');
  await call(notify, e, 'install-held', 'POST', {subject: 'Done', html: '<b>Job finished</b>', kind: 'activity'});
  assert.deepEqual(await sendDigests(e, tue), {sent: 0, kept: 1}, 'a weekly account waits for Monday');
  assert.deepEqual(await sendDigests(e, mon), {sent: 1, kept: 0});
  assert.equal(sent.length, 3);
  assert.equal((await call(address, e, 'install-held', 'PUT', {email: 'me@example.com', cadence: 'hourly'})).ok, true);
  assert.equal((await call(address, e, 'install-held', 'GET')).cadence, 'weekly', 'an unknown cadence changes nothing');
});
