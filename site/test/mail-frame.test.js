// The branded frame (src/mail-frame.js): every template goes through it with the logo, the footer with the stop and settings links and a plain-text twin; at most one orange button; no Pro or
// product-news line while the owner's marketing flag is off; and a template without a title (the frame's input) or a sender that skips send() fails. Fake sender and fake D1.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {send, settingsLink, stopLink} from '../src/mail.js';
import {TEMPLATES} from '../src/mail-templates.js';
import {createAccount} from '../src/pro.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const setup = (extra = {}) => { const sent = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }}, ...extra}; return {e, sent}; };
const now = new Date('2026-10-17T10:00:00Z');
const matches = [{title: 'Senior Site Reliability Engineer', company: 'Example Bank', place: 'Zürich', mode: 'Hybrid', fit: 86, url: 'https://x.example/1'}, {title: 'Platform Engineer', company: 'Northwind', fit: 81}];
// One sample of data per template: a new template without a sample fails the coverage test below.
const SAMPLES = {
  'message': {subject: 'Rejection from Acme', html: '<b>Acme said no</b>', text: 'Acme said no', buttons: [{text: 'Open the job', url: 'https://x.example/job'}, {text: 'See why', url: 'https://x.example/why'}], confirmUrl: 'https://x.example/confirm'},
  'account-code': {code: '482913'},
  'digest': {matches, total: 3},
  'trial-left': {left: 4},
  'trial-ending': {days: 2, pricingUrl: 'https://www.jobadabra.top/pricing'},
  'always-on-paused': {reason: 'trial-over', pricingUrl: 'https://www.jobadabra.top/pricing', pro: false},
  'pro-launch': {price: '29', launch: '19', pricingUrl: 'https://www.jobadabra.top/pricing'},
};

test('every template has a sample here (a new template must be added to this test)', () => assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(TEMPLATES).sort()));

test('every template goes through the frame: logo, title, footer with stop + settings + site links, a plain-text twin, one orange button at most', async () => {
  for (const [name, spec] of Object.entries(TEMPLATES)) {
    const {e, sent} = setup({MARKETING_MAIL: 'on'});
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    e.STATS.db.prepare('UPDATE pro_accounts SET marketing_opt_in = 1').run();
    assert.equal((await send(e, name, 'me@example.com', SAMPLES[name], {now})).ok, true, name);
    const {html, text} = sent[0];
    assert.ok(html.includes('data-jp-frame="1"') && html.includes('<title>'), `${name}: framed`);
    assert.ok(html.includes('https://www.jobadabra.top/images/logo-mark.png') && !html.includes('data:'), `${name}: hosted logo`);
    assert.ok(html.includes('>jobadabra.top</a>') && text.trim().endsWith('https://www.jobadabra.top'), `${name}: site link`);
    assert.ok((html.match(/background:#d0612b/g) || []).length <= 1, `${name}: at most one orange button`);
    assert.ok(!/<(script|form|iframe)/i.test(html), `${name}: email-safe`);
    if (spec.essential) { assert.ok(!html.includes('Stop these emails') && !sent[0].headers, `${name}: a security mail has nothing to stop`); continue; }
    const stop = (await stopLink(e, 'me@example.com', spec.list)).replaceAll('&', '&amp;'), settings = (await settingsLink(e, 'me@example.com')).replaceAll('&', '&amp;');
    assert.ok(html.includes(`href="${stop}"`) && html.includes(`href="${settings}"`) && html.includes('Stop these emails') && html.includes('Email settings'), `${name}: footer links`);
    assert.ok(text.includes(stop.replaceAll('&amp;', '&')) && text.includes(settings.replaceAll('&amp;', '&')), `${name}: the text twin has both links`);
  }
});

test('the digest is job rows with a fit chip and one "Open in Jobadabra" button; the sign-in code is a big box with the security line', async () => {
  const {e, sent} = setup();
  await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  await send(e, 'digest', 'me@example.com', SAMPLES.digest, {now});
  await send(e, 'account-code', 'me@example.com', SAMPLES['account-code'], {now});
  assert.equal(sent[0].subject, '3 new job matches');
  assert.ok(sent[0].html.includes('Example Bank · Zürich · Hybrid') && sent[0].html.includes('jp-fit') && sent[0].html.includes('Open in Jobadabra'));
  assert.match(sent[0].text, /Senior Site Reliability Engineer \(Example Bank · Zürich · Hybrid\) fit 86/);
  assert.ok(sent[1].html.includes('482913') && sent[1].html.includes('sent even if you stopped other emails'));
});

test('while the marketing flag is off no service mail carries a Pro or product-news line', async () => {
  for (const [name, spec] of Object.entries(TEMPLATES)) {
    if (spec.list !== 'service') continue;
    const {e, sent} = setup();
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    await send(e, name, 'me@example.com', SAMPLES[name], {now});
    assert.ok(!/\bPro\b|product news|\boffer\b|launch/i.test(sent[0].html.replace(/<title>.*?<\/title>/, '') + sent[0].text), `${name}: no sales line`);
  }
});

test('a template without a title is not sent, and no code sends mail except through send()', async () => {
  TEMPLATES.rogue = {list: 'service', subject: () => 'Rogue', text: () => 'raw', html: () => '<p>raw</p>'};
  try {
    const {e, sent} = setup();
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    assert.equal((await send(e, 'rogue', 'me@example.com', {}, {now})).ok, false);
    assert.equal(sent.length, 0);
  } finally { delete TEMPLATES.rogue; }
  const callers = readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js')).filter(name => /EMAIL\.send\(/.test(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')));
  assert.deepEqual(callers, ['mail.js'], 'only src/mail.js hands mail to the sender, so every mail is framed');
});
