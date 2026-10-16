// What the Monetization page (src/monetization.js) shows, computed from D1 and KV: the funnel of installs -> Pro, the conversion and its colour, the AI cost per free and per Pro user, and the money.
// Reads: telemetry (first seen, setup done, the latest health line: licensed, applicationsUsed, allowanceEnded), ai_calls, and a6's Pro tables (pro_devices, pro_purchases; migration 0079_pro.sql, spec 2026-10-16-pro-plan.md §1).
// Counts and install ids only: no e-mail is ever selected. Founders (licensed installs) are not trials. Guard: test/monetization.test.js
import {digestOf} from './guard.js';
import {monthStopUsd, trialUsd} from './free-ai.js';
import {CONVERSION_GREEN, CONVERSION_YELLOW, FIXED_COSTS_YEAR, TRIAL_APPLICATIONS, TRIAL_MIN_FOR_VERDICT} from './monetization-config.js';

const DAY = 86400000;
export const RANGES = {'24h': {name: 'Last 24 hours', ms: DAY}, '7d': {name: 'Last 7 days', ms: 7 * DAY}, '30d': {name: 'Last 30 days', ms: 30 * DAY}, all: {name: 'All time', ms: Infinity}};
export const rangeOf = value => (RANGES[value] ? value : '30d');
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all().catch(() => ({results: null}))).results;   // null: the table is not there (yet)

export function colourOf(pro, trials) {
  if (!trials || trials < TRIAL_MIN_FOR_VERDICT) return {colour: 'grey', note: `not enough trials yet (${trials} of ${TRIAL_MIN_FOR_VERDICT})`};
  const rate = pro / trials;
  return {colour: rate >= CONVERSION_GREEN ? 'green' : rate >= CONVERSION_YELLOW ? 'yellow' : 'red', note: `${trials} trials completed`};
}
const parse = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };
const stats = list => { const sorted = [...list].sort((a, b) => a - b); return {average: sorted.length ? sorted.reduce((s, n) => s + n, 0) / sorted.length : 0, median: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 2))] : 0}; };

export async function collect(env, range = '30d', now = new Date()) {
  range = rangeOf(range);
  const db = env.STATS, since = RANGES[range].ms === Infinity ? '' : new Date(now.getTime() - RANGES[range].ms).toISOString();
  const first = await rows(db, 'SELECT install, MIN(at) AS first FROM telemetry GROUP BY install') || [];
  const done = new Set(((await rows(db, "SELECT DISTINCT install FROM telemetry WHERE kind = 'setup' AND json_extract(data, '$.step') = 'done'")) || []).map(r => r.install));
  const latest = new Map(((await rows(db, "SELECT install, data FROM (SELECT install, data, MAX(at) FROM telemetry WHERE kind = 'health' GROUP BY install)")) || []).map(r => [r.install, parse(r.data)]));
  const devices = await rows(db, "SELECT DISTINCT d.install, d.account FROM pro_devices d JOIN pro_purchases p ON p.account = d.account AND p.kind = 'pro' AND p.status = 'paid'");
  const proInstalls = new Set((devices || []).map(r => r.install)), hasPro = devices !== null;
  const free = first.filter(r => !latest.get(r.install)?.licensed);
  const cohort = free.filter(r => !since || r.first >= since);
  const used = r => Number(latest.get(r.install)?.applicationsUsed) || 0;
  const downloads = (await rows(db, `SELECT COUNT(*) AS n FROM downloads ${since ? 'WHERE at >= ?' : ''}`, ...(since ? [since] : [])))?.[0]?.n || 0;
  const funnel = {downloads, installs: cohort.length, setup: cohort.filter(r => done.has(r.install)).length, activated: cohort.filter(r => used(r) >= 1).length,
    trials: cohort.filter(r => used(r) >= TRIAL_APPLICATIONS || latest.get(r.install)?.allowanceEnded).length, pro: cohort.filter(r => proInstalls.has(r.install)).length};
  const verdict = colourOf(funnel.pro, funnel.trials);
  const conversion = {ofTrials: funnel.trials ? funnel.pro / funnel.trials : 0, ofSignups: funnel.setup ? funnel.pro / funnel.setup : 0, ...verdict};

  // AI cost: ai_calls.who is the digest of the install's digest (free-ai.js records access.who through aicost.js, which digests again).
  const whoOf = new Map(await Promise.all(first.filter(r => !latest.get(r.install)?.licensed).map(async r => [(await digestOf(await digestOf(r.install))).slice(0, 8), r.install])));
  const from = since ? since.slice(0, 10) : '';
  const inRange = (await rows(db, `SELECT who, SUM(micro_usd) AS micro FROM ai_calls ${from ? 'WHERE day >= ?' : ''} GROUP BY who`, ...(from ? [from] : []))) || [];
  const lifetime = new Map(((await rows(db, 'SELECT who, SUM(micro_usd) AS micro FROM ai_calls GROUP BY who')) || []).map(r => [r.who, r.micro / 1e6]));
  const freeUsd = [], proUsd = []; let aiCost = 0;
  for (const r of inRange) { aiCost += r.micro / 1e6; const install = whoOf.get(r.who); if (install) (proInstalls.has(install) ? proUsd : freeUsd).push(r.micro / 1e6); }
  const atCap = freeUsd.length ? [...whoOf].filter(([who, install]) => !proInstalls.has(install) && (lifetime.get(who) || 0) >= trialUsd(env) * 0.99).length : 0;
  const month = now.toISOString().slice(0, 7), monthUsd = (Number(await env.WAITLIST?.get(`freeai:usdm:${month}`).catch(() => 0)) || 0) / 1e6;
  const cost = {free: {users: freeUsd.length, ...stats(freeUsd), atCap}, pro: {users: proUsd.length, ...stats(proUsd), total: proUsd.reduce((s, n) => s + n, 0)}, month: {usd: monthUsd, cap: monthStopUsd(env)}, trialUsd: trialUsd(env), total: aiCost};

  // Money: by purchase date. Revenue is what was paid and kept (VAT included); a refund is listed beside it, the fee on it is still lost.
  let money = null;
  const sales = await rows(db, `SELECT kind, amount_cents, tax_cents, fee_cents, status FROM pro_purchases ${since ? 'WHERE at >= ?' : ''}`, ...(since ? [since] : []));
  if (sales && sales.length) {
    const sum = (list, key) => list.reduce((s, r) => s + (Number(r[key]) || 0), 0) / 100, paid = sales.filter(r => r.status === 'paid');
    const spanDays = RANGES[range].ms === Infinity ? Math.max(1, (now - new Date(first.map(r => r.first).sort()[0] || now)) / DAY) : RANGES[range].ms / DAY;
    const fixed = FIXED_COSTS_YEAR.reduce((s, [, usd]) => s + usd, 0) * spanDays / 365;
    money = {revenue: sum(paid, 'amount_cents'), vat: sum(paid, 'tax_cents'), fees: sum(sales, 'fee_cents'), refunds: sum(sales.filter(r => r.status === 'refunded'), 'amount_cents'),
      topups: sum(paid.filter(r => String(r.kind).startsWith('topup')), 'amount_cents'), aiCost, fixed, buyers: sales.filter(r => r.kind === 'pro' && r.status === 'paid').length};
    money.profit = money.revenue - money.vat - money.fees - money.aiCost - money.fixed;
  }
  return {range, funnel, conversion, cost, money, hasPro, fixedCosts: FIXED_COSTS_YEAR};
}
