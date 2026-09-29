// Technical reports from Job Pilotto apps (desktop/lib/telemetry.js scrubs them before sending): POST /report/telemetry
// stores them (D1 "telemetry", 90 days), /telemetry shows the problems users hit (same key as /stats), and a daily
// run (scheduled) picks the top problems and starts the triage workflow on GitHub, which files or updates an issue
// per problem. Design: Notion "📡 Technical reports (telemetry) — design".
import {allowed, esc} from './stats.js';

export const KINDS = ['crash', 'run_failed', 'form_issue', 'stuck', 'health'];
const MAX_EVENTS = 50, MAX_BYTES = 8000, PER_INSTALL_PER_DAY = 1000, KEEP_DAYS = 90;
const day = date => date.toISOString().slice(0, 10);
const text = (value, max = 300) => String(value ?? '').slice(0, max);

// A second scrub on the server, in case an old app sends something it shouldn't: keys, emails, home folders.
export function scrub(value) {
  return String(value ?? '').replace(/sk-ant-[\w-]+|\bntn_\w+|\bsecret_\w+|\bgh[pousr]_\w+|github_pat_\w+|GOCSPX-[\w-]+|\b\d{6,12}:AA[\w-]{20,}/g, '<secret>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>').replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>');
}

// The same problem across users and versions: numbers, ids and quoted values don't make it a different one.
const normal = value => String(value ?? '').replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b|[0-9a-f-]{36}/gi, '<id>').replace(/\d+/g, '#')
  .replace(/(["'])[^"']{0,80}\1/g, '"…"').slice(0, 160);
export function describe(item) {
  const frame = String(item.stack || '').split('\n').map(line => line.trim()).find(line => /\.(m?js|cjs|py)\b/.test(line)) || '';
  const place = frame.replace(/:\d+(:\d+)?\)?$/, '').replace(/.*\/(desktop|renderer|lib|pages|src|extension)\//, '$1/').slice(-80);
  switch (item.kind) {
    case 'crash': return {key: `crash|${item.where}|${item.type}|${place}|${normal(item.message)}`,
      summary: `${item.type || 'Error'}: ${text(item.message, 140)}${place ? ` (${place})` : ''}`};
    case 'run_failed': return {key: `run|${item.job}|${normal(item.error)}`, summary: `${item.job}: ${text(item.error, 150)}${item.cutOff ? ' (cut off)' : ''}`};
    case 'form_issue': return {key: `form|${item.site}|${normal(item.label)}|${item.reason}`, summary: `${item.site}: ${text(item.label, 80)} (${item.reason || 'not filled'})`};
    case 'stuck': return {key: `stuck|${item.action}|${item.page}`, summary: `Stuck: ${item.action} (${item.page || 'app'})`};
    default: return {key: 'health', summary: 'health'};
  }
}
async function hash(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST /report/telemetry {events: [...]}: checked, limited per install per day, stored.
export async function collect(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, MAX_EVENTS)
    .filter(item => item && KINDS.includes(item.kind) && /^[\w-]{8,64}$/.test(String(item.install || '')));
  if (!events.length) return Response.json({ok: false, error: 'no events'}, {status: 400});
  const today = day(now);
  const kv = env.WAITLIST, countKey = `telemetry:${events[0].install}:${today}`;
  const count = kv ? Number(await kv.get(countKey)) || 0 : 0;
  if (count >= PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  if (kv) await kv.put(countKey, String(count + events.length), {expirationTtl: 2 * 86400});
  for (const item of events) {
    const data = scrub(JSON.stringify(item)).slice(0, MAX_BYTES);
    const {key, summary} = describe(item);
    await env.STATS.prepare('INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(today, text(item.at, 30), item.kind, text(item.install, 64), text(item.version, 30), text(item.platform, 20),
        await hash(key), scrub(summary).slice(0, 300), data).run();
  }
  return Response.json({ok: true, stored: events.length});
}

// The problems of the last `days`, most users first: one row per fingerprint, with its latest sample.
export async function problems(db, days, now = new Date(), limit = 50) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = (await db.prepare(`SELECT fingerprint, kind, MAX(summary) AS summary, COUNT(*) AS n, COUNT(DISTINCT install) AS users,
      GROUP_CONCAT(DISTINCT version) AS versions, MIN(day) AS first, MAX(at) AS last, MAX(data) AS sample
    FROM telemetry WHERE day >= ? AND kind != 'health' GROUP BY fingerprint ORDER BY users DESC, n DESC LIMIT ?`).bind(from, limit).all()).results || [];
  const installs = (await db.prepare(`SELECT version, platform, COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ?
    GROUP BY version, platform ORDER BY n DESC`).bind(from).all()).results || [];
  // How it helped: each install's latest daily health line, summed (anonymous counts; "ever reached" for the funnel).
  const health = (await db.prepare(`SELECT t.data FROM telemetry t WHERE t.kind = 'health' AND t.day >= ?
    AND t.at = (SELECT MAX(at) FROM telemetry WHERE install = t.install AND kind = 'health')`).bind(from).all()).results || [];
  const outcomes = {};
  for (const row of health) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    for (const name of OUTCOMES) if (typeof data[name] === 'number') outcomes[name] = (outcomes[name] || 0) + data[name];
  }
  return {from, days, rows, installs, outcomes, reporting: health.length};
}
export const OUTCOMES = ['matches', 'goodFits', 'formsFilled', 'applied', 'replies', 'screenings', 'interviews', 'offers'];

function page(data) {
  const {rows, installs} = data;
  const total = installs.reduce((sum, row) => sum + row.n, 0);
  const count = kind => rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.n, 0);
  const range = [1, 7, 30].map(n => n === data.days ? `<b>${n === 1 ? 'today' : `${n} days`}</b>` : `<a href="?days=${n}">${n === 1 ? 'today' : `${n} days`}</a>`).join(' · ');
  const tiles = [['🖥️ Installs reporting', total], ['💥 Crashes', count('crash')], ['🔁 Failed runs', count('run_failed')], ['🧩 Form issues', count('form_issue')]];
  const table = rows.map(row => `<tr><td><span class="kind ${row.kind}">${esc(row.kind.replace('_', ' '))}</span></td>
    <td><details><summary>${esc(row.summary)}</summary><pre>${esc(JSON.stringify(JSON.parse(row.sample || '{}'), null, 1))}</pre></details></td>
    <td><b>${row.users}</b></td><td>${row.n}</td><td class="muted">${esc(row.versions)}</td><td class="muted">${esc(String(row.last).slice(0, 16).replace('T', ' '))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Job Pilotto app reports</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--red:#e5776b;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0 0 6px;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}.tile b{display:block;font-size:32px;margin-top:4px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 4px}
td{padding:8px 4px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}summary{cursor:pointer}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted);margin:8px 0 0}.kind{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--line);white-space:nowrap}
.kind.crash{color:var(--red)}.kind.run_failed{color:var(--amber)}.kind.form_issue{color:var(--teal)}
</style></head><body><main>
<header><h1>✈ Job Pilotto · app reports</h1><span class="muted">${range} · <a href="/stats">Website stats →</a></span></header>
<div class="tiles">${tiles.map(([label, value]) => `<div class="card tile"><span class="muted">${label}</span><b>${value}</b></div>`).join('')}</div>
<section class="card" style="margin-bottom:12px"><h2>How it helped</h2><small class="muted">all ${data.reporting} installs reporting, their latest totals</small>
<div class="tiles" style="margin:10px 0 0">${[['🎯 Jobs matched', 'matches'], ['⭐ Good fits (70+)', 'goodFits'], ['🧩 Forms filled', 'formsFilled'],
  ['📨 Applications', 'applied'], ['💬 Human replies', 'replies'], ['📞 Screenings', 'screenings'], ['🧑‍💻 Interviews', 'interviews'], ['🏆 Offers', 'offers']]
  .map(([label, name]) => `<div class="tile"><span class="muted">${label}</span><b>${data.outcomes?.[name] ?? 0}</b></div>`).join('')}</div></section>
<section class="card"><h2>Problems, most users first</h2><table><tr><th>Kind</th><th>Problem (click for a sample)</th><th>Users</th><th>Times</th><th>Versions</th><th>Last</th></tr>
${table || '<tr><td colspan="6" class="muted">No problems reported. 🎉</td></tr>'}</table></section>
<p class="muted">Since ${esc(data.from)} (UTC). Scrubbed on each Mac before sending; no answers, CV, emails, names or keys. Kept ${KEEP_DAYS} days.</p>
</main></body></html>`;
}

// GET /telemetry?days=7 (same key or cookie as /stats)
export async function view(request, env, now = new Date()) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const days = [1, 7, 30].includes(Number(new URL(request.url).searchParams.get('days'))) ? Number(new URL(request.url).searchParams.get('days')) : 7;
  try {
    return new Response(page(await problems(env.STATS, days, now)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
  } catch (error) {  // e.g. the table isn't there yet: say what to do, not a blank error
    return new Response(`App reports can't be read yet: ${esc(error.message)}. Apply the database migrations: cd site && npx wrangler@4 d1 migrations apply www-stats --remote`,
      {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}

// Daily (Worker cron): drop reports older than 90 days, then send the top problems of the last day to the triage
// workflow, which files or updates one GitHub issue per problem (.github/workflows/telemetry-triage.yml).
export async function daily(env, dispatch, now = new Date()) {
  if (!env.STATS) return 0;
  await env.STATS.prepare('DELETE FROM telemetry WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_DAYS * 86400000))).run();
  const {rows} = await problems(env.STATS, 1, now, 10);
  if (!rows.length) return 0;
  const brief = rows.map(row => ({fingerprint: row.fingerprint, kind: row.kind, summary: row.summary, users: row.users, times: row.n,
    versions: row.versions, sample: String(row.sample).slice(0, 2500)}));
  let payload = JSON.stringify(brief);
  while (payload.length > 60000 && brief.length > 1) { brief.pop(); payload = JSON.stringify(brief); }
  await dispatch(env, {problems: payload}, 'telemetry-triage.yml');
  return brief.length;
}
