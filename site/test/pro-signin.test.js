// "I have Pro" on another computer (src/pro-signin.js): the code is mailed only for a Pro address (the answer never says), lasts 10 minutes and 5 tries, works only for the install that asked,
// adds the install to the account (max 3; a 4th must name the device to remove), and the whole thing is hidden while PRO_PLAN is off. Fake sender only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {CODE_MINUTES, MAX_TRIES, start, verify} from '../src/pro-signin.js';
import {digestOf, tokenFor} from '../src/guard.js';
import {createAccount, link} from '../src/pro.js';

const sql = file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0084_pro_codes.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const now = new Date('2026-10-16T10:00:00Z');
const setup = (extra = {}) => { const sent = [], e = {MAIL: 'on', PRO_PLAN: 'test', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}, ...extra}; return {e, sent}; };
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const post = async (fn, e, install, body, at = now) => { const r = await fn(new Request('https://x/api', {method: 'POST', headers: {'x-api-key': await keyOf(install)}, body: JSON.stringify(body)}), e, at); return {status: r.status, ...(r.status === 404 ? {} : await r.json())}; };
const codeIn = sent => /\b(\d{6})\b/.exec(sent.at(-1).text)[1];
async function proAccount(e, email = 'pro@example.com', installs = ['install-home']) {
  const id = await createAccount(e, email, now);
  for (const install of installs) await link(e, id, install, now);
  return id;
}

test('a code is mailed to a Pro address and the answer is the same for an address without Pro', async () => {
  const {e, sent} = setup();
  await proAccount(e);
  const real = await post(start, e, 'install-work', {email: 'Pro@Example.com'});
  const unknown = await post(start, e, 'install-work', {email: 'nobody@example.com'});
  assert.deepEqual([real.status, real.ok, real.minutes], [200, true, CODE_MINUTES]);
  assert.deepEqual(unknown, real);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'pro@example.com');
  assert.match(sent[0].text, /code is \d{6}/);
  assert.ok(!sent[0].headers, 'a code mail has no unsubscribe footer');
});

test('the right code adds the install; the code is used up; another install cannot use it', async () => {
  const {e, sent} = setup();
  const id = await proAccount(e);
  await post(start, e, 'install-work', {email: 'pro@example.com'});
  const code = codeIn(sent);
  assert.equal((await post(verify, e, 'install-thief', {email: 'pro@example.com', code})).error, 'expired');
  assert.deepEqual(await post(verify, e, 'install-work', {email: 'pro@example.com', code: ` ${code.slice(0, 3)} ${code.slice(3)} `}), {status: 200, ok: true});
  assert.equal(e.STATS.db.prepare('SELECT account FROM pro_devices WHERE install = ?').get('install-work').account, id);
  assert.equal((await post(verify, e, 'install-work', {email: 'pro@example.com', code})).error, 'expired');
});

test('a wrong code counts down, 5 tries lock it, and an old code expires after 10 minutes', async () => {
  const {e, sent} = setup();
  await proAccount(e);
  await post(start, e, 'install-work', {email: 'pro@example.com'});
  const code = codeIn(sent), wrong = code === '000000' ? '111111' : '000000';
  for (let i = 1; i <= MAX_TRIES; i++) assert.deepEqual((await post(verify, e, 'install-work', {email: 'pro@example.com', code: wrong})).left, MAX_TRIES - i);
  assert.equal((await post(verify, e, 'install-work', {email: 'pro@example.com', code})).error, 'locked', 'even the right code once locked');
  await post(start, e, 'install-work', {email: 'pro@example.com'}, new Date(now.getTime() + 60000));
  const later = new Date(now.getTime() + (CODE_MINUTES + 2) * 60000);
  assert.equal((await post(verify, e, 'install-work', {email: 'pro@example.com', code: codeIn(sent)}, later)).error, 'expired');
});

test('a 4th device must name the device to remove; the code survives the first answer', async () => {
  const {e, sent} = setup();
  const id = await proAccount(e, 'pro@example.com', ['install-a', 'install-b', 'install-c']);
  await post(start, e, 'install-d', {email: 'pro@example.com'});
  const code = codeIn(sent), full = await post(verify, e, 'install-d', {email: 'pro@example.com', code});
  assert.equal(full.status, 409);
  assert.equal(full.error, 'devices');
  assert.equal(full.devices.length, 3);
  assert.ok(!JSON.stringify(full).includes('install-a'), 'the window never sees a raw install id');
  const gone = await digestOf('install-b');
  assert.equal((await post(verify, e, 'install-d', {email: 'pro@example.com', code, remove: gone})).ok, true);
  assert.deepEqual(e.STATS.db.prepare('SELECT install FROM pro_devices WHERE account = ? ORDER BY install').all(id).map(r => r.install), ['install-a', 'install-c', 'install-d']);
});

test('a computer that was on a trial account gives that up for the Pro account; one on another Pro account is refused', async () => {
  const {e, sent} = setup();
  const trial = await createAccount(e, 'trial@example.com', now, {plan: 'trial'});
  await link(e, trial, 'install-work', now);
  const pro = await proAccount(e, 'pro@example.com');
  await post(start, e, 'install-work', {email: 'pro@example.com'});
  assert.equal((await post(verify, e, 'install-work', {email: 'pro@example.com', code: codeIn(sent)})).ok, true);
  assert.equal(e.STATS.db.prepare('SELECT account FROM pro_devices WHERE install = ?').get('install-work').account, pro);
  await proAccount(e, 'other@example.com', ['install-other']);
  await post(start, e, 'install-other', {email: 'pro@example.com'});
  assert.equal((await post(verify, e, 'install-other', {email: 'pro@example.com', code: codeIn(sent)})).error, 'other');
});

test('a trial account is not Pro: no code, and a refunded Pro account gets none', async () => {
  const {e, sent} = setup();
  await createAccount(e, 'trial@example.com', now, {plan: 'trial'});
  const gone = await proAccount(e, 'refunded@example.com');
  e.STATS.db.prepare("UPDATE pro_accounts SET status = 'refunded' WHERE id = ?").run(gone);
  await post(start, e, 'install-x', {email: 'trial@example.com'});
  await post(start, e, 'install-x', {email: 'refunded@example.com'});
  assert.equal(sent.length, 0);
});

test('the sixth code in a day is not mailed (the sender\'s limit), and the old code stays the live one', async () => {
  const {e, sent} = setup();
  await proAccount(e);
  for (let i = 0; i < 7; i++) await post(start, e, 'install-work', {email: 'pro@example.com'});
  assert.equal(sent.length, 6);
  assert.equal((await post(verify, e, 'install-work', {email: 'pro@example.com', code: codeIn(sent)})).ok, true);
});

test('hidden while PRO_PLAN is off, and closed to a caller without an install key', async () => {
  const off = setup({PRO_PLAN: 'off'}).e;
  assert.equal((await post(start, off, 'install-work', {email: 'pro@example.com'})).status, 404);
  assert.equal((await post(verify, off, 'install-work', {email: 'pro@example.com', code: '123456'})).status, 404);
  const {e} = setup();
  assert.equal((await start(new Request('https://x/api', {method: 'POST', body: '{}'}), e, now)).status, 401);
  assert.equal((await post(start, e, 'install-work', {email: 'nope'})).status, 400);
});
