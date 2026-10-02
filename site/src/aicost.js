// What the AI costs us, per step and per user, on the relay that carries included AI (src/trial.js). Counts and money only: no prompt, no answer,
// no job text, and the license holder is a short digest. This is the evidence the pass price and the credit budget rest on.
import {digestOf} from './guard.js';

export const ACTIONS = ['enrich', 'score', 'kit', 'prep', 'insight', 'mail', 'inbox', 'review', 'interview', 'opportunity', 'added', 'import'];
const day = date => date.toISOString().slice(0, 10);

// One successful call. `usd` is the call's cost from its own token usage (trial.js costUsd). Never throws into the relay.
export async function record(env, licenseId, action, model, usage, usd, now = new Date()) {
  if (!env.STATS) return false;
  try {
    const who = (await digestOf(String(licenseId))).slice(0, 8);
    const step = ACTIONS.includes(String(action)) ? String(action) : 'other';
    const cached = (usage?.cache_read_input_tokens || 0), tokensIn = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0);
    await env.STATS.prepare(`INSERT INTO ai_calls (day, who, action, model, calls, tokens_in, tokens_out, cache_read, micro_usd) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (day, who, action, model) DO UPDATE SET calls = calls + 1, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out,
      cache_read = cache_read + excluded.cache_read, micro_usd = micro_usd + excluded.micro_usd`)
      .bind(day(now), who, step, String(model || '').slice(0, 40), tokensIn, usage?.output_tokens || 0, cached, Math.round((Number(usd) || 0) * 1e6)).run();
    return true;
  } catch { return false; }
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);

// For the owner's page: cost per step, and per user per active day (the number a pass has to cover).
export async function report(db, days = 30, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const all = async sql => (await db.prepare(sql).bind(from).all().catch(() => ({results: []}))).results || [];
  const steps = (await all('SELECT action, SUM(calls) AS calls, SUM(micro_usd) AS micro, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout FROM ai_calls WHERE day >= ? GROUP BY action ORDER BY micro DESC'))
    .map(row => ({action: row.action, calls: row.calls, usd: row.micro / 1e6, perCall: row.calls ? row.micro / 1e6 / row.calls : 0, tokensIn: row.tin, tokensOut: row.tout}));
  const perUserDay = (await all('SELECT who, day, SUM(micro_usd) AS micro FROM ai_calls WHERE day >= ? GROUP BY who, day')).map(row => row.micro / 1e6).sort((a, b) => a - b);
  const users = new Set((await all('SELECT DISTINCT who FROM ai_calls WHERE day >= ?')).map(row => row.who)).size;
  const total = steps.reduce((sum, step) => sum + step.usd, 0);
  const mean = perUserDay.length ? perUserDay.reduce((sum, n) => sum + n, 0) / perUserDay.length : 0;
  return {days, users, total, steps, activeUserDays: perUserDay.length,
    perUserDay: {mean, median: percentile(perUserDay, 0.5), p95: percentile(perUserDay, 0.95), max: perUserDay.at(-1) || 0}, monthPerActiveUser: mean * 30};
}
