// /admin: the owner's overview of every admin page. At the top, what needs attention this week (pulled from each page's numbers);
// below, one card per page with its key numbers, their last 8 weeks and a link. Everything from the tables the pages already read.
import {PAGES, byWeek, ratio, since, spark, sum} from './admin.js';
import {isOwner, esc, remember} from './stats.js';
import {appTrends, insightTrends} from './trends.js';
import {recentLogins} from './auth.js';

const rows = async (db, sql, ...binds) => { try { return (await db.prepare(sql).bind(...binds).all()).results || []; } catch { return []; } };
const DAY = 86400000;
const dayOf = date => date.toISOString().slice(0, 10);
const pct = value => `${Math.round(value * 100)}%`;
const usd = value => `$${value.toFixed(2)}`;
const PROBLEMS = "('crash', 'run_failed', 'stuck', 'form_issue')";

export async function report(db, now = new Date()) {
  const from = since(now), weekAgo = dayOf(new Date(now.getTime() - 6 * DAY));
  const [app, insights] = await Promise.all([appTrends(db, now), insightTrends(db, now)]);
  const visits = await rows(db, 'SELECT day, visitor FROM visits WHERE day >= ?', from);
  const downloads = await rows(db, 'SELECT day FROM downloads WHERE day >= ?', from);
  const reading = await rows(db, "SELECT day, ok, 1 AS n FROM lab_runs WHERE kind = 'question' AND day >= ?", from);
  const blind = await rows(db, "SELECT day, n AS blind FROM fill_reasons WHERE reason IN ('unread', 'by_you_unread') AND day >= ?", from);
  const exposure = (await rows(db, 'SELECT day, n, required FROM form_exposure WHERE day >= ?', from)).map(row => ({day: row.day, base: row.required || row.n}));
  const jobCost = await rows(db, 'SELECT day, usd FROM ai_cost_runs WHERE day >= ?', from);
  const relay = (await rows(db, 'SELECT day, micro_usd FROM ai_calls WHERE day >= ?', from)).map(row => ({day: row.day, usd: row.micro_usd / 1e6}));
  const snaps = (await rows(db, 'SELECT day, body FROM selfheal_snapshots WHERE day >= ? ORDER BY day', from))
    .map(row => { try { const body = JSON.parse(row.body); return {day: row.day, precision: body.totals?.precision ?? null, recall: body.recall || null}; } catch { return null; } }).filter(Boolean);
  const weekly = list => list.map(row => ({...row}));
  const latest = (list, key) => (week => (week.length ? week.at(-1)[key] : null));
  const cards = {
    website: [{label: 'visitors', values: byWeek(visits, now, list => new Set(list.map(row => `${row.day}|${row.visitor}`)).size)},
      {label: 'downloads', values: byWeek(downloads, now, list => list.length)}],
    app: [app.machines, app.problems],
    insights: [insights.replies, insights.scores],
    'self-healing': [{label: 'precision', values: byWeek(weekly(snaps), now, latest(snaps, 'precision')), format: pct}],
    'ai-cost': [{label: 'scheduled jobs + relay', values: byWeek([...jobCost, ...relay], now, sum('usd')), format: usd, higherIsBetter: false}],
    'form-filling': [{label: 'reading (lab)', values: byWeek(reading, now, ratio('ok', 'n')), format: pct},
      {label: 'blind spots per 100', values: byWeek([...blind, ...exposure], now, list => { const base = sum('base')(list); return base ? (100 * sum('blind')(list)) / base : null; }),
        format: v => v.toFixed(1), higherIsBetter: false}],
    feedback: [app.feedback],
  };
  const recall = snaps.at(-1)?.recall || null;

  // What needs attention, from those numbers: each with where to look.
  const attention = [];
  const last = values => values.at(-1), prev = values => values.at(-2);
  const fresh = await rows(db, `SELECT COUNT(*) AS n FROM (SELECT fingerprint FROM telemetry WHERE kind IN ${PROBLEMS} GROUP BY fingerprint HAVING MIN(day) >= ?)`, weekAgo);
  if (fresh[0]?.n) attention.push({page: '/admin/app', text: `${fresh[0].n} new problem${fresh[0].n === 1 ? '' : 's'} reported by the apps this week`, tone: 'bad'});
  const unread = await rows(db, "SELECT COUNT(DISTINCT fingerprint) AS n FROM lab_runs WHERE kind = 'question' AND ok = 0 AND day >= ?", weekAgo);
  if (unread[0]?.n) attention.push({page: '/admin/form-filling', text: `${unread[0].n} required question${unread[0].n === 1 ? '' : 's'} the form lab could not read`, tone: 'bad'});
  const r = cards['form-filling'][0].values;
  if (last(r) != null && prev(r) != null && last(r) < prev(r)) attention.push({page: '/admin/form-filling', text: `Form reading fell from ${pct(prev(r))} to ${pct(last(r))}`, tone: 'bad'});
  if (recall && recall.planted && recall.caught < recall.planted) attention.push({page: '/admin/self-healing', text: `Self-healing missed ${recall.planted - recall.caught} of ${recall.planted} planted bugs`, tone: 'bad'});
  const c = cards['ai-cost'][0].values;
  if (last(c) != null && prev(c) && last(c) > 1.5 * prev(c) && last(c) - prev(c) > 1) attention.push({page: '/admin/ai-cost', text: `AI cost up from ${usd(prev(c))} to ${usd(last(c))} this week`, tone: 'warn'});
  const p = app.problems.values;
  if (last(p) != null && prev(p) != null && last(p) > prev(p)) attention.push({page: '/admin/app', text: `Problem reports up from ${prev(p)} to ${last(p)}`, tone: 'warn'});
  const f = app.feedback.values;
  if (last(f)) attention.push({page: '/admin/feedback', text: `${last(f)} feedback message${last(f) === 1 ? '' : 's'} this week`, tone: 'info'});
  // Logins to these pages (src/auth.js): a wrong key this week is flagged.
  const logins = await recentLogins(db, 8);
  const failed = (await rows(db, 'SELECT COUNT(*) AS n FROM admin_logins WHERE ok = 0 AND day >= ?', weekAgo))[0]?.n || 0;
  if (failed) attention.unshift({page: '/admin', text: `${failed} login${failed === 1 ? '' : 's'} with a wrong key this week (see Logins below)`, tone: 'bad'});
  return {cards, attention, recall, logins, from, to: dayOf(now)};
}

export function page(data) {
  const cards = PAGES.filter(item => item.path !== '/admin').map(item => {
    const key = item.path.slice('/admin/'.length), series = data.cards[key] || [];
    return `<a class="card dash" href="${item.path}"><h2>${item.icon} ${esc(item.name)}</h2>${series.map(s =>
      `<div class="metric"><small class="muted">${esc(s.label)}</small><div class="line">${spark(s.values, {...s, width: 140, height: 30})}</div></div>`).join('')}
${key === 'self-healing' && data.recall ? `<small class="muted">recall ${data.recall.caught}/${data.recall.planted} planted bugs</small>` : ''}</a>`;
  }).join('');
  const tone = {bad: '🔴', warn: '🟠', info: '🔵'};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Overview · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:0 16px 48px}h1{margin:0;font-size:24px}h2{margin:0 0 8px;font-size:15px}a{color:var(--amber)}.muted{color:var(--muted)}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px;display:block}
.attention li{margin:6px 0;list-style:none}.attention ul{margin:8px 0 0;padding:0}.attention a{color:var(--text);text-decoration:none}.attention a:hover{color:var(--amber)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.dash{color:var(--text);text-decoration:none;margin:0}.dash:hover{border-color:var(--amber)}
.metric{margin-top:8px}.line{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}.line svg{flex:none}
.up{color:#3fb68b;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}td{padding:6px 4px;border-top:1px solid var(--line)}.down{color:#e5484d;font-size:14px}
</style></head><body><main>
<header><h1>🧭 Overview</h1><span class="muted">${esc(data.from)} → ${esc(data.to)} · weeks, oldest first · the last bar is this week</span></header>
<section class="card attention"><h2>Needs your attention</h2>${data.attention.length
  ? `<ul>${data.attention.map(item => `<li>${tone[item.tone]} <a href="${item.page}">${esc(item.text)} →</a></li>`).join('')}</ul>`
  : '<p class="muted">✅ Nothing needs you this week.</p>'}</section>
<div class="grid">${cards}</div>
<section class="card" style="margin-top:12px"><h2>🔐 Logins</h2><small class="muted">Each sign-in with the key (a session then lasts 30 days). Never the key itself.</small>
<table><tr><th>When (UTC)</th><th>Result</th><th>Country</th><th>Device</th><th>Page</th></tr>${(data.logins || []).map(row =>
  `<tr><td>${esc(String(row.at).slice(0, 16).replace('T', ' '))}</td><td>${row.ok ? '✅ signed in' : '🔴 wrong key'}</td><td>${esc(row.country || '–')}</td><td>${esc(row.device)}</td><td>${esc(row.path)}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">No logins recorded yet.</td></tr>'}</table></section>
</main></body></html>`;
}

export async function view(request, env, now = new Date()) {
  if (!await isOwner(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.STATS) return new Response('No database', {status: 503});
  return new Response(page(await report(env.STATS, now)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
