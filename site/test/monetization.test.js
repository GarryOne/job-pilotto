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
import {monthStopUsd} from '../src/free-ai.js';
import {FIXED_COSTS_YEAR} from '../src/monetization-config.js';

const PRO_TABLES = ['pro_accounts', 'pro_devices', 'pro_purchases', 'pro_credit', 'payment_events'];   // the real ones come from migrations/0079_pro.sql; a page without them is tested by dropping them
function d1(withPro = true) {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  if (!withPro) for (const table of PRO_TABLES) db.exec(`DROP TABLE ${table}`);
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
  for (const [at, platform] of [['2026-10-04T08:00:00Z', 'mac'], ['2026-10-04T09:00:00Z', 'windows'], ['2026-10-15T09:00:00Z', 'mac']]) db.prepare("INSERT INTO downloads (day, at, visitor, platform, button, page, source, country, device) VALUES (?,?,'v',?,'hero','home','direct','CH','desktop')").run(at.slice(0, 10), at, platform);
  await cost(db, 'install-1-aaaaaaaa', 2.5); await cost(db, 'install-2-aaaaaaaa', 0.5); await cost(db, 'install-0-aaaaaaaa', 1.5);
  if (withPro) {
    db.exec("INSERT INTO pro_accounts (id, email_hash, email, created_at, status, credit_micro) VALUES ('a1','h','hidden@example.com','2026-10-12','active',4000000); INSERT INTO pro_devices (account, install, added_at, last_seen) VALUES ('a1','install-0-aaaaaaaa','2026-10-12','2026-10-15');");
    db.exec("INSERT INTO pro_purchases (id, account, kind, amount_cents, currency, credit_micro, status, at, provider, provider_ref, country, tax_cents, fee_cents) VALUES ('p1','a1','pro',1900,'usd',5000000,'paid','2026-10-12T10:00:00Z','stripe','x','CH',140,85),('p2','a1','topup5',500,'usd',5000000,'paid','2026-10-14T10:00:00Z','stripe','y','CH',37,45),('p3','b','pro',1900,'usd',5000000,'refunded','2026-10-13T10:00:00Z','stripe','z','DE',300,85)");
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
  assert.deepEqual(data.funnel, {downloads: 3, installs: 10, setup: 8, activated: 6, trials: 4, pro: 1});
  assert.equal(data.conversion.ofTrials, 0.25); assert.equal(data.conversion.ofSignups, 0.125); assert.equal(data.conversion.colour, 'grey');   // 4 trials: too few to judge
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

test('the month cap on the page is the one free-ai.js enforces ($200 from wrangler.toml), and the fixed costs are the projections page figures', async () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), wrangled = Number(toml.match(/^FREE_AI_MONTH_STOP_USD\s*=\s*"(\d+)"/m)[1]);
  const env = {...(await seed()), FREE_AI_MONTH_STOP_USD: String(wrangled)};
  assert.equal(wrangled, 200); assert.equal((await collect(env, 'all', now)).cost.month.cap, monthStopUsd(env));
  assert.equal((await collect(await seed(), 'all', now)).cost.month.cap, monthStopUsd({}));   // unset: the same default, never a second one
  assert.deepEqual(Object.fromEntries(FIXED_COSTS_YEAR), {'Cloudflare Workers Paid': 60, Domain: 5, 'Apple Developer': 99, 'Windows signing': 250, 'Bookkeeping SaaS': 100});
});

test('the funnel is six steps (downloads, first run, signup = setup finished, activated, trial, Pro) with the drop from the step before', async () => {
  const env = await seed(), data = await collect(env, 'all', now), html = page(data, {range: 'all', now});
  for (const label of ['Download clicks', 'First run', 'Signup: setup finished', 'Activated: first application', 'Trial completed', 'Pro']) assert.ok(html.includes(label), label);
  assert.match(html, /8 · −20%/);   // 10 first runs -> 8 finished setup
  assert.match(html, /10 · –</);                  // 10 first runs from 3 download clicks: a step larger than the one before shows no drop
  assert.match(html, /Signups/); assert.match(html, /12.5% of signups/);   // Pro 1 of 8 who finished setup
  assert.equal((await collect(env, '7d', now)).funnel.downloads, 1);       // only the click of 15 Oct is in the last 7 days
});
