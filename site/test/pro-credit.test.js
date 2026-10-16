// The Pro plan's accounts and AI credit (src/pro.js, src/pro-ai.js, migrations/0079_pro.sql): the Pro lane of Free AI, the credit ledger, the status the app reads.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {DAY_MESSAGE, freeAi} from '../src/free-ai.js';
import {digestOf, tokenFor} from '../src/guard.js';
import {OVERDRAFT_MICRO, addCredit, aiCallsKey, createAccount, link, percentOf, status, warnOf} from '../src/pro.js';
import {CREDIT_OUT, PRO_PER_MINUTE} from '../src/pro-ai.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const env = (extra = {}) => ({WAITLIST: kv(), STATS: d1(), STATS_SALT: 'salt', PRO_PLAN: 'test', AI: {run: async () => ({choices: [{message: {content: 'hi'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1000, completion_tokens: 1000}}), toMarkdown: async () => []}, ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-16T10:00:30Z');
const ask = (e, key, at = now) => freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': key, 'x-jp-action': 'score'},
  body: JSON.stringify({max_tokens: 10, messages: [{role: 'user', content: 'x'}]})}), e, at);
// A Pro account with `credit` micro-USD, owning the install `install`.
async function proInstall(e, install, credit, extra = 'a@example.com') {
  const account = await createAccount(e, extra, now), who = await digestOf(install);
  assert.equal((await link(e, account, install, now)).ok, true);
  if (credit) await addCredit(e, account, credit, 'purchase', 'test', now);
  return {account, who, key: await keyOf(install)};
}
const row = (e, sql, ...args) => e.STATS.db.prepare(sql).get(...args);

test('the Pro lane: no install day cap, no global stop; only the minute limit, and each call is taken from the credit', async () => {
  const e = env(), pro = await proInstall(e, 'install-pro-01', 5_000_000);
  e.WAITLIST.m.set(`freeai:dusd:${pro.who}:2026-10-16`, String(9 * 1e6));   // far over the Free per-install day cap
  e.WAITLIST.m.set('freeai:usd:2026-10-16', String(10 * 1e6));              // and at the global stop
  e.WAITLIST.m.set(`freeai:life:${pro.who}`, String(99 * 1e6));             // and past the Free lifetime trial budget
  e.WAITLIST.m.set(`freeai:tok:${pro.who}:2026-10-16`, '99999999');          // and the Free token cap
  const response = await ask(e, pro.key);
  assert.equal(response.status, 200);
  const calls = row(e, 'SELECT SUM(micro_usd) AS micro FROM ai_calls').micro, left = row(e, 'SELECT credit_micro FROM pro_accounts WHERE id = ?', pro.account).credit_micro;
  assert.ok(calls > 0);
  assert.equal(5_000_000 - left, calls, 'the credit pays exactly what ai_calls records');
  assert.deepEqual({...row(e, 'SELECT delta_micro, reason, ref FROM pro_credit WHERE reason = ?', 'ai_call')}, {delta_micro: -calls, reason: 'ai_call', ref: 'score'});
  e.WAITLIST.m.set(`freeai:min:${pro.who}:2026-10-16T10:00`, String(PRO_PER_MINUTE));
  assert.equal((await ask(e, pro.key)).status, 429, 'the 50-a-minute limit still applies');
});

test('an install without a Pro account keeps the Free rules', async () => {
  const e = env(), free = await keyOf('install-free-1');
  e.WAITLIST.m.set(`freeai:dusd:${await digestOf('install-free-1')}:2026-10-16`, String(0.5 * 1e6));
  const refused = await ask(e, free);
  assert.equal(refused.status, 429); assert.equal((await refused.json()).error.message, DAY_MESSAGE);
});

test('with the flag off the Pro account is ignored: Free caps apply and nothing is debited', async () => {
  const e = env(), pro = await proInstall(e, 'install-pro-03', 5_000_000);
  e.PRO_PLAN = 'off';
  e.WAITLIST.m.set(`freeai:dusd:${pro.who}:2026-10-16`, String(0.5 * 1e6));
  assert.equal((await ask(e, pro.key)).status, 429);
  assert.equal(row(e, 'SELECT credit_micro FROM pro_accounts').credit_micro, 5_000_000);
});

test('credit used up: no free fallback; the overdraft lets the application in progress finish, then top-up or own key', async () => {
  const e = env(), pro = await proInstall(e, 'install-pro-04', 1);   // one micro-dollar left: the next call goes below zero
  assert.equal((await ask(e, pro.key)).status, 200, 'a call that starts with credit finishes');
  assert.ok(row(e, 'SELECT credit_micro FROM pro_accounts').credit_micro < 0, 'it dipped into the overdraft');
  assert.equal((await ask(e, pro.key)).status, 200, 'still inside the overdraft');
  e.STATS.db.prepare('UPDATE pro_accounts SET credit_micro = ?').run(-OVERDRAFT_MICRO);
  const out = await ask(e, pro.key);
  assert.equal(out.status, 402); assert.equal((await out.json()).error.message, CREDIT_OUT);
  assert.match(CREDIT_OUT, /Add credit/); assert.match(CREDIT_OUT, /own .*key/);
});

test('"AI credit: N% left" is the balance over everything ever added, in steps of 5, with the 30 / 10 / 0 warnings', () => {
  const at = (credit, added) => percentOf({credit_micro: credit, credit_added_micro: added});
  assert.deepEqual([at(5, 5), at(3.5, 5), at(1.5, 5), at(0.4, 5), at(0, 5), at(-0.1, 5), at(0, 0)], [100, 70, 30, 5, 0, 0, 0]);
  assert.deepEqual([100, 70, 35, 30, 10, 5, 0].map(warnOf), [null, null, null, 30, 10, 10, 0]);
});

test('the status the app reads: free, then pro with a percent and a warning, never dollars; 401 for a bad key; 404 when the plan is off', async () => {
  const e = env(), ask2 = (key, extra = e) => status(new Request('https://x/api/pro/status', {headers: {'x-api-key': key}}), extra);
  assert.equal((await ask2('JPF1.install-x-01.deadbeef')).status, 401);
  const none = await (await ask2(await keyOf('install-none-1'))).json();
  assert.deepEqual([none.ok, none.plan], [true, 'free']);
  assert.deepEqual(none.offer, {price: '29', launch: '19'}, 'the app shows the price the site says');
  assert.deepEqual((await (await ask2(await keyOf('install-none-1'), {...e, PRO_LAUNCH_USD: ''})).json()).offer, {price: '29', launch: ''}, 'an empty launch price ends it');
  const pro = await proInstall(e, 'install-pro-05', 5_000_000);
  e.STATS.db.prepare('UPDATE pro_accounts SET credit_micro = ?').run(1_400_000);   // 28%: rounds down to 25, the 30% warning
  const body = await (await ask2(pro.key)).json();
  assert.deepEqual([body.plan, body.creditPercent, body.warn], ['pro', 25, 30]);
  assert.doesNotMatch(JSON.stringify(body), /micro|usd|\$|cents/i, 'a percent and a step, never money');
  assert.equal((await ask2(pro.key, {...e, PRO_PLAN: 'off'})).status, 404);
  e.STATS.db.prepare("UPDATE pro_accounts SET status = 'refunded'").run();
  assert.equal((await (await ask2(pro.key)).json()).plan, 'free', 'a refunded account is Free again');
});

test('devices: 3 per account, an install belongs to one account, the same e-mail is the same account, each refusal is flagged', async () => {
  const e = env(), account = await createAccount(e, 'Same@Example.com', now);
  assert.equal(await createAccount(e, ' same@example.com ', now), account);
  for (const install of ['dev-aaaaaaa1', 'dev-aaaaaaa2', 'dev-aaaaaaa3']) assert.equal((await link(e, account, install, now)).ok, true);
  assert.equal((await link(e, account, 'dev-aaaaaaa1', now)).ok, true, 'a known device again is fine');
  const fourth = await link(e, account, 'dev-aaaaaaa4', now);
  assert.equal(fourth.ok, false); assert.match(fourth.error, /3 devices/);
  const other = await createAccount(e, 'other@example.com', now), second = await link(e, other, 'dev-aaaaaaa1', now);
  assert.equal(second.ok, false); assert.match(second.error, /another account/);
  assert.deepEqual(e.STATS.db.prepare('SELECT kind FROM anomalies ORDER BY kind').all().map(r => r.kind), ['pro-device-limit', 'pro-install-two-accounts']);
});

test('a refund takes the credit back from the balance and from "ever added", floored at 0', async () => {
  const e = env(), account = await createAccount(e, 'r@example.com', now);
  await addCredit(e, account, 5_000_000, 'purchase', 'p1', now);
  e.STATS.db.prepare('UPDATE pro_accounts SET credit_micro = ?').run(1_000_000);   // $4 spent
  await addCredit(e, account, -5_000_000, 'refund', 'p1', now);
  assert.deepEqual({...row(e, 'SELECT credit_micro, credit_added_micro FROM pro_accounts')}, {credit_micro: 0, credit_added_micro: 0});
  await assert.rejects(addCredit(e, account, 1, 'ai_call', 'x', now), /bad reason/);
});

test('what /admin/monetization reads: pro_devices.install is the raw telemetry install id and joins ai_calls; paid Pro is kind pro + status paid', async () => {
  const e = env(), install = 'install-pro-09', pro = await proInstall(e, install, 5_000_000);
  assert.equal(row(e, 'SELECT install FROM pro_devices WHERE account = ?', pro.account).install, install, 'the raw id, the same value as telemetry.install');
  await ask(e, pro.key);
  const call = row(e, 'SELECT who, micro_usd FROM ai_calls');
  assert.equal(call.who, await aiCallsKey(install), 'aiCallsKey(install) is ai_calls.who: the join');
  e.STATS.db.prepare("INSERT INTO pro_purchases (id, account, kind, amount_cents, currency, credit_micro, status, at, provider, provider_ref, country, tax_cents, fee_cents) VALUES ('p1', ?, 'pro', 1900, 'usd', 5000000, 'paid', '2026-10-16T10:00:00Z', 'stripe', 'cs_test_1', 'CH', 142, NULL)").run(pro.account);
  assert.deepEqual({...row(e, "SELECT COUNT(*) AS n, MAX(fee_cents) AS fee FROM pro_purchases WHERE kind = 'pro' AND status = 'paid'")}, {n: 1, fee: null}, 'fee is null until known');
});
