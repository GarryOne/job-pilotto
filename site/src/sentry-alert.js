// Every 5 minutes the Worker asks Sentry for the app's production issues and tells the owner, in the separate "Job Pilotto Sentry" Telegram bot,
// about each one that is NEW, REGRESSED (came back after being resolved) or SPIKING (this hour 10x its usual hourly count). Never one message per event.
// State in D1 (sentry_alerts: which issue was told as what, when); limits: an issue is told once per kind per cooldown, at most 20 messages an hour, then one "N more".
// Needs SENTRY_AUTH_TOKEN (read-only, as /admin/sentry), SENTRY_TELEGRAM_TOKEN + SENTRY_TELEGRAM_CHAT (Worker secrets); wrangler var SENTRY_TELEGRAM = "on"|"off".
// The owner's own app already tells fill errors to the owner's main Telegram (desktop/lib/real-errors.js); that is left alone. Guarded by test/sentry-alert.test.js.
import {fixer, status} from './sentry.js';

const SENTRY = 'https://de.sentry.io/api/0', ORG = 'job-pilotto', PROJECT = 'job-pilotto-app';
const HOUR = 3600000;
export const MAX_PER_HOUR = 20;
export const SPIKE_FACTOR = 10, SPIKE_MIN = 20;       // this hour's events: at least 10x the other hours' average, and at least 20
const NEW_WITHIN = 2 * HOUR;                          // first seen this recently counts as new (a first run on old issues stays quiet)
// Once per kind per cooldown: a new issue once ever, a regression once a week (Sentry keeps the "regressed" label for days), a spike once an hour.
export const COOLDOWN = {new: 1e12, regressed: 7 * 24 * HOUR, spike: HOUR};
const PLANT_TYPE = 'RecallPlant';                     // the recall benchmark's planted errors (tools/sentry-fixer/lib.mjs): never real

const get = async (path, env, fetcher) => {
  const response = await fetcher(`${SENTRY}${path}`, {headers: {Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`}});
  if (!response.ok) throw new Error(`Sentry HTTP ${response.status}`);
  return response.json();
};

// Production only (the end-to-end runs report as environment e2e and never reach the bot), never a planted test error.
export async function recentIssues(env, fetcher = fetch) {
  const list = await get(`/projects/${ORG}/${PROJECT}/issues/?statsPeriod=24h&query=is:unresolved&sort=date&limit=100&environment=production`, env, fetcher);
  return (Array.isArray(list) ? list : []).filter(item => item?.metadata?.type !== PLANT_TYPE && !/planted/i.test(String(item?.title)));
}

// The last hourly bucket of Sentry's 24h series against the average of the rest.
export function spiking(item) {
  const series = (item.stats?.['24h'] || []).map(point => Number(point[1]) || 0);
  if (series.length < 4) return false;
  const now = series.at(-1), rest = series.slice(0, -1), usual = rest.reduce((sum, n) => sum + n, 0) / rest.length;
  return now >= SPIKE_MIN && now >= SPIKE_FACTOR * Math.max(usual, 0.1);
}

export function kindOf(item, now) {
  if (item.substatus === 'regressed') return 'regressed';
  if (item.substatus === 'new' || now - Date.parse(item.firstSeen) <= NEW_WITHIN) return 'new';
  if (spiking(item) || item.substatus === 'escalating') return 'spike';
  return null;
}

const ICON = {new: '🆕', regressed: '🔁', spike: '📈'}, WORD = {new: 'New', regressed: 'Came back', spike: 'Spike'};
const text = value => String(value ?? '').replace(/[<>&]/g, char => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[char]));

export function message(item, kind, {version, fix, base}) {
  const pr = fix && status(item.shortId, fix);
  return [`${ICON[kind]} <b>${WORD[kind]}</b> · ${item.level === 'fatal' ? '💥 crash' : text(item.level)}`,
    `<b>${text(String(item.title).slice(0, 200))}</b>`,
    item.culprit ? `<code>${text(String(item.culprit).slice(0, 120))}</code>` : '',
    `👥 ${Number(item.userCount) || 0} users · 🔁 ${Number(item.count) || 0} events${version ? ` · v${text(version)}` : ''}`,
    `First seen ${text(String(item.firstSeen || '').slice(0, 16).replace('T', ' '))} UTC`,
    `<a href="${text(item.permalink)}">Sentry ${text(item.shortId)}</a> · <a href="${base}/admin/sentry">/admin/sentry</a>`,
    pr ? `🛠️ Fixer: <a href="${text(pr.url)}">${text(pr.text)}</a>` : ''].filter(Boolean).join('\n');
}

async function send(env, body, fetcher) {
  const response = await fetcher(`https://api.telegram.org/bot${env.SENTRY_TELEGRAM_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: env.SENTRY_TELEGRAM_CHAT, text: body, parse_mode: 'HTML', disable_web_page_preview: true})});
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
}

// Returns what it did: {told, held, skipped}. Silent (no throw) when switched off or not set up.
export async function check(env, fetcher = fetch, now = Date.now()) {
  const none = {told: 0, held: 0, skipped: 0};
  if (env.SENTRY_TELEGRAM === 'off' || !env.SENTRY_AUTH_TOKEN || !env.SENTRY_TELEGRAM_TOKEN || !env.SENTRY_TELEGRAM_CHAT || !env.STATS) return none;
  const base = env.SITE_URL || 'https://www.jobadabra.top';
  const due = [];
  for (const item of await recentIssues(env, fetcher)) {
    const kind = kindOf(item, now);
    if (!kind) continue;
    const row = await env.STATS.prepare('SELECT told_at FROM sentry_alerts WHERE issue_id = ? AND kind = ?').bind(String(item.id), kind).first();
    if (row && now - Date.parse(row.told_at) < COOLDOWN[kind]) continue;
    due.push({item, kind});
  }
  if (!due.length) return none;
  const lastHour = await env.STATS.prepare('SELECT COUNT(*) AS n FROM sentry_alerts WHERE sent = 1 AND told_at >= ?').bind(new Date(now - HOUR).toISOString()).first();
  let room = Math.max(0, MAX_PER_HOUR - Number(lastHour?.n || 0)), told = 0, held = 0;
  const fix = await fixer(env, fetcher).catch(() => null);
  const remember = (item, kind, sent) => env.STATS.prepare('INSERT OR REPLACE INTO sentry_alerts (issue_id, kind, told_at, count, sent) VALUES (?, ?, ?, ?, ?)')
    .bind(String(item.id), kind, new Date(now).toISOString(), Number(item.count) || 0, sent).run();
  for (const {item, kind} of due) {
    if (room <= 0) { held++; await remember(item, kind, 0); continue; }   // over the hourly limit: counted in the one summary, not told again
    const version = await get(`/issues/${item.id}/tags/release/`, env, fetcher).then(tag => tag?.topValues?.[0]?.name).catch(() => '');
    await send(env, message(item, kind, {version, fix, base}), fetcher);
    await remember(item, kind, 1);
    room--; told++;
  }
  if (held) await send(env, `📬 ${held} more Sentry issue${held === 1 ? '' : 's'} this hour (new, back or spiking). <a href="${base}/admin/sentry">/admin/sentry</a>`, fetcher);
  return {told, held, skipped: 0};
}

// Old rows are not needed once their cooldown is long past (a week plus a day).
export async function purge(env, now = Date.now()) {
  if (env.STATS) await env.STATS.prepare('DELETE FROM sentry_alerts WHERE told_at < ?').bind(new Date(now - 8 * 24 * HOUR).toISOString()).run();
}
