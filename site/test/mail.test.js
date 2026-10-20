// The e-mail sender (src/mail.js, src/mail-unsub.js): refusals, the 6-a-day limit, the two lists, one-click unsubscribe, bounce/complaint events, and that no mail body or plain address is logged.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {DAILY_MAX, addrOf, mailAllowed, send, stopLink} from '../src/mail.js';
import {handleEvent, unsubscribe} from '../src/mail-unsub.js';
import {TEMPLATES} from '../src/mail-templates.js';
import {createAccount} from '../src/pro.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const setup = (extra = {}) => { const sent = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }}, ...extra}; return {e, sent}; };
const now = new Date('2026-10-16T10:00:00Z');
const digest = {total: 2, matches: [{title: 'Data Engineer', company: 'Acme', fit: 82, url: 'https://x/1'}, {title: 'SRE', url: 'https://x/2'}]};
const rows = (e, text) => e.STATS.db.prepare(text).all();

test('a digest goes out from the service address with the footer, the one-click link and the headers; the log keeps no body and no address', async () => {
  const {e, sent} = setup(), got = await send(e, 'digest', 'Me@Example.com', digest, {now});
  assert.deepEqual(got, {ok: true, id: 'm1'});
  assert.equal(sent[0].to, 'me@example.com');
  assert.match(sent[0].from, /notifications@jobadabra\.top/);
  const link = await stopLink(e, 'me@example.com', 'service');
  assert.ok(sent[0].text.includes(link) && sent[0].html.includes(link.replaceAll('&', '&amp;')));
  assert.equal(sent[0].headers['List-Unsubscribe'], `<${link}>`);
  assert.equal(sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const log = JSON.stringify(rows(e, 'SELECT * FROM mail_log'));
  assert.ok(!log.includes('example.com') && !log.includes('Data Engineer'));
  assert.deepEqual(rows(e, 'SELECT status, template, list FROM mail_log').map(r => ({...r})), [{status: 'sent', template: 'digest', list: 'service'}]);
});

test('nothing is sent when MAIL is off, the binding is missing, the address is bad or the template is unknown', async () => {
  const {e, sent} = setup({MAIL: 'off'});
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).reason, 'off');
  assert.equal((await send(setup().e, 'digest', 'not an address', digest, {now})).reason, 'bad_address');
  assert.equal((await send(setup().e, 'nope', 'a@b.co', {}, {now})).reason, 'bad_template');
  assert.equal(sent.length, 0);
});

test('the 7th mail to one address in a day is refused; another address and the next day are fine', async () => {
  const {e, sent} = setup();
  for (let i = 0; i < DAILY_MAX; i++) assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).ok, true);
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).reason, 'rate');
  assert.equal((await send(e, 'digest', 'c@d.co', digest, {now})).ok, true);
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now: new Date(now.getTime() + 25 * 3600e3)})).ok, true);
  assert.equal(sent.length, DAILY_MAX + 2);
});

test('one-click unsubscribe: GET only asks, POST turns the service list off (log, account column, later sends refused); a wrong token does nothing', async () => {
  const {e, sent} = setup(), id = await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  const link = await stopLink(e, 'me@example.com', 'service');
  assert.equal((await unsubscribe(new Request(link), e, now)).status, 200);
  assert.equal((await send(e, 'digest', 'me@example.com', digest, {now})).ok, true, 'a GET (a mail scanner) changes nothing');
  assert.equal((await unsubscribe(new Request(link.replace(/t=\w+/, 't=00'), {method: 'POST'}), e, now)).status, 400);
  assert.equal((await unsubscribe(new Request(link, {method: 'POST'}), e, now)).status, 200);
  assert.equal((await send(e, 'digest', 'me@example.com', digest, {now})).reason, 'unsubscribed');
  assert.ok(rows(e, 'SELECT service_mail_off_at FROM pro_accounts WHERE id = ?'.replace('?', `'${id}'`))[0].service_mail_off_at);
  assert.equal(sent.length, 1);
});

test('a sign-in code is not stopped by the service unsubscribe, and carries no unsubscribe footer', async () => {
  const {e, sent} = setup();
  await unsubscribe(new Request(await stopLink(e, 'me@example.com', 'service'), {method: 'POST'}), e, now);
  assert.equal((await send(e, 'account-code', 'me@example.com', {code: '123456'}, {now})).ok, true);
  assert.ok(!sent[0].text.includes('unsubscribe') && !sent[0].headers);
});

test('marketing mail needs the opt-in on the account, and its unsubscribe clears it; the service list is untouched', async () => {
  TEMPLATES.news = {list: 'marketing', subject: () => 'News', title: () => 'News', text: () => 'Pro is here', html: () => '<p>Pro is here</p>'};
  try {
    const {e, sent} = setup({MARKETING_MAIL: 'on'}), id = await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    assert.equal((await send({...e, MARKETING_MAIL: 'off'}, 'news', 'me@example.com', {}, {now})).reason, 'marketing_off', 'the owner\'s flag is off: nothing promotional goes out');
    assert.equal((await send(e, 'news', 'me@example.com', {}, {now})).reason, 'not_opted_in');
    assert.equal((await send(e, 'news', 'nobody@example.com', {}, {now})).reason, 'not_opted_in');
    e.STATS.db.prepare('UPDATE pro_accounts SET marketing_opt_in = 1 WHERE id = ?').run(id);
    assert.equal((await send(e, 'news', 'me@example.com', {}, {now})).ok, true);
    assert.match(sent[0].from, /news@jobadabra\.top/);
    await unsubscribe(new Request(await stopLink(e, 'me@example.com', 'marketing'), {method: 'POST'}), e, now);
    assert.equal(rows(e, 'SELECT marketing_opt_in FROM pro_accounts')[0].marketing_opt_in, 0);
    assert.equal((await send(e, 'news', 'me@example.com', {}, {now})).reason, 'unsubscribed');
    assert.equal((await send(e, 'digest', 'me@example.com', digest, {now})).ok, true);
  } finally { delete TEMPLATES.news; }
});

test('a hard bounce or a complaint turns every list off, even a sign-in code; a soft bounce does not', async () => {
  const {e} = setup(), event = (type, extra = {}) => ({type, payload: {recipient: 'Bad@Example.com', ...extra}});
  assert.equal(await handleEvent(e, event('cf.email.sending.message.bounced', {bounce: {type: 'soft'}}), now), false);
  assert.equal((await mailAllowed(e, 'bad@example.com')).ok, true);
  assert.equal(await handleEvent(e, event('cf.email.sending.message.bounced', {bounce: {type: 'hard'}}), now), true);
  assert.equal((await send(e, 'digest', 'bad@example.com', digest, {now})).reason, 'suppressed');
  assert.equal((await send(e, 'account-code', 'bad@example.com', {code: '1'}, {now})).reason, 'suppressed');
  const other = setup().e;
  await handleEvent(other, event('cf.email.sending.message.complained'), now);
  assert.equal((await mailAllowed(other, 'bad@example.com')).reason, 'suppressed');
  assert.equal(await addrOf('bad@example.com'), await addrOf(' BAD@example.com '));
});

test('a failing sender is logged as failed and reported, not thrown', async () => {
  const {e} = setup({EMAIL: {send: async () => { throw new Error('boom'); }}});
  assert.deepEqual(await send(e, 'digest', 'a@b.co', digest, {now}), {ok: false, reason: 'failed'});
  assert.equal(rows(e, 'SELECT status FROM mail_log')[0].status, 'failed');
});
