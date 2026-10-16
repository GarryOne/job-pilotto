// /admin/monetization: the funnel, the conversion colour, the AI cost per user and the money, from a fake D1 with installs, trials and Pro sales (the Pro tables are a6's contract, migration 0079).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';
import {digestOf} from '../src/guard.js';
import {colourOf, collect} from '../src/monetization-data.js';
import {page} from '../src/monetization.js';

const PRO = `CREATE TABLE pro_accounts (id TEXT PRIMARY KEY, email_hash TEXT, email TEXT, created_at TEXT, status TEXT, credit_micro INTEGER);
CREATE TABLE pro_devices (account TEXT, install TEXT, added_at TEXT, last_seen TEXT);
CREATE TABLE pro_purchases (id TEXT PRIMARY KEY, account TEXT, kind TEXT, amount_cents INTEGER, currency TEXT, credit_micro INTEGER, status TEXT, at TEXT, provider TEXT, provider_ref TEXT, country TEXT, tax_cents INTEGER, fee_cents INTEGER);`;
function d1(withPro = true) {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  if (withPro) db.exec(PRO);
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const now = new Date('2026-10-16T12:00:00Z');
const tel = (db, install, kind, data, at = '2026-10-10T08:00:00Z') => db.prepare('INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data) VALUES (?,?,?,?,?,?,?,?,?)').run(at.slice(0, 10), at, kind, install, '1', 'darwin', kind, kind, JSON.stringify(data));
const health = (db, install, extra, at) => tel(db, install, 'health', {licensed: false, applicationsUsed: 0, allowanceEnded: false, ...extra}, at);
const cost = async (db, install, usd, day = '2026-10-12') => db.prepare("INSERT INTO ai_calls (day, who, action, model, calls, micro_usd) VALUES (?,?,'score','m',1,?)").run(day, (await digestOf(await digestOf(install))).slice(0, 8), Math.round(usd * 1e6));

// 10 installs: i0-i9. i0-i7 finished setup; i0-i5 applied; i0-i3 completed the trial (one by days, one by 20 applications); i0 bought Pro (+ a top-up); a founder (licensed) is left out.
async function seed(withPro = true) {
  const {db, prepare} = d1(withPro);
  for (let i = 0; i < 10; i++) tel(db, `install-${i}-aaaaaaaa`, 'setup', {step: i < 8 ? 'done' : 'ai'}, '2026-10-05T08:00:00Z');
  for (let i = 0; i < 6; i++) health(db, `install-${i}-aaaaaaaa`, {applicationsUsed: i === 1 ? 20 : i + 1, allowanceEnded: i === 0 || i === 2 || i === 3}, '2026-10-15T08:00:00Z');
  tel(db, 'founder-aaaaaaaa', 'setup', {step: 'done'}, '2026-10-05T08:00:00Z'); health(db, 'founder-aaaaaaaa', {licensed: true, applicationsUsed: 40, allowanceEnded: true}, '2026-10-15T08:00:00Z');
  await cost(db, 'install-1-aaaaaaaa', 2.5); await cost(db, 'install-2-aaaaaaaa', 0.5); await cost(db, 'install-0-aaaaaaaa', 1.5);
  if (withPro) {
    db.exec("INSERT INTO pro_accounts VALUES ('a1','h','hidden@example.com','2026-10-12','active',4000000); INSERT INTO pro_devices VALUES ('a1','install-0-aaaaaaaa','2026-10-12','2026-10-15');");
    db.exec("INSERT INTO pro_purchases VALUES ('p1','a1','pro',1900,'usd',5000000,'paid','2026-10-12T10:00:00Z','stripe','x','CH',140,85),('p2','a1','topup5',500,'usd',5000000,'paid','2026-10-14T10:00:00Z','stripe','y','CH',37,45),('p3','b','pro',1900,'usd',5000000,'refunded','2026-10-13T10:00:00Z','stripe','z','DE',300,85)");
  }
  return {STATS: {prepare}, db, WAITLIST: {get: async key => (key === 'freeai:usdm:2026-10' ? String(12_000_000) : null)}, STATS_KEY: 'k3y'};
}

test('colours: >=5% green, 2-5% yellow, <2% red, and "not enough trials yet" under 50 completed trials', () => {
  assert.equal(colourOf(5, 100).colour, 'green'); assert.equal(colourOf(3, 100).colour, 'yellow'); assert.equal(colourOf(1, 100).colour, 'red');
  assert.equal(colourOf(0, 100).colour, 'red'); assert.equal(colourOf(1, 49).colour, 'grey'); assert.match(colourOf(1, 49).note, /not enough trials yet/);
  assert.equal(colourOf(0, 0).colour, 'grey');
});

test('the funnel, the conversion and the cost per user (founders left out; the e-mail never shown)', async () => {
  const env = await seed(), data = await collect(env, 'all', now);
  assert.deepEqual(data.funnel, {installs: 10, activated: 8, applied: 6, trials: 4, pro: 1});
  assert.equal(data.conversion.ofTrials, 0.25); assert.equal(data.conversion.ofInstalls, 0.1); assert.equal(data.conversion.colour, 'grey');   // 4 trials: too few to judge
  assert.equal(data.cost.free.users, 2); assert.equal(data.cost.free.atCap, 1); assert.ok(Math.abs(data.cost.free.average - 1.5) < 1e-9); assert.ok(Math.abs(data.cost.free.median - 2.5) < 1e-9);
  assert.ok(Math.abs(data.cost.pro.average - 1.5) < 1e-9); assert.equal(data.cost.pro.users, 1);
  assert.equal(data.cost.month.usd, 12);
  const html = page(data, {range: 'all', now}); assert.ok(!html.includes('hidden@example.com'));
});

test('the money: revenue with VAT, VAT, fees, refunds, top-ups, AI cost and the profit after the fixed costs', async () => {
  const env = await seed(), {money} = await collect(env, 'all', now);
  assert.equal(money.revenue, 24); assert.equal(money.vat, 1.77); assert.equal(money.fees, 2.15); assert.equal(money.refunds, 19); assert.equal(money.topups, 5);
  assert.ok(Math.abs(money.aiCost - 4.5) < 1e-9);
  assert.ok(money.fixed > 0);
  assert.ok(Math.abs(money.profit - (24 - 1.77 - 2.15 - 4.5 - money.fixed)) < 1e-9);
});

test('no Pro tables yet: a clear "no sales yet" state and the free numbers still show', async () => {
  const env = await seed(false), data = await collect(env, 'all', now);
  assert.equal(data.money, null); assert.equal(data.funnel.pro, 0);
  const html = page(data, {range: 'all', now}); assert.match(html, /No sales yet/);
});

test('the range filter cuts the cohort: installs first seen before the range are not counted', async () => {
  const env = await seed(), data = await collect(env, '24h', now);
  assert.equal(data.funnel.installs, 0); assert.match(page(data, {range: '24h', now}), /Last 24 hours/);
});

test('the route is owner-only and in the admin nav', async () => {
  assert.ok(PAGES.some(p => p.path === '/admin/monetization'));
  const env = await seed();
  assert.equal((await worker.fetch(new Request('https://www.jobpilotto.top/admin/monetization'), env, {})).status, 404);
  const ok = await worker.fetch(new Request('https://www.jobpilotto.top/admin/monetization', {headers: {Cookie: 'jp_stats=k3y'}}), env, {});
  assert.equal(ok.status, 200); assert.match(await ok.text(), /Monetization/);
});
