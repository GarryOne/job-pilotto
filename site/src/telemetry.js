// Technical reports from Job Pilotto apps (desktop/lib/telemetry.js scrubs them before sending): POST /report/telemetry
// stores them (D1 "telemetry", 90 days), /telemetry shows the problems users hit (same key as /stats), and a daily
// run (scheduled) picks the top problems and starts the triage workflow on GitHub, which files or updates an issue
// per problem. Design: Notion "📡 Technical reports (telemetry) — design".
import {feedbackList} from './feedback.js';
import {labPlan, labReport} from './recipes.js';
import {allowed, esc, remember} from './stats.js';

export const KINDS = ['crash', 'run_failed', 'form_issue', 'stuck', 'health', 'setup', 'control'];
export const TRIAGE_MIN_USERS = 3, TRIAGE_MIN_TIMES = 20;
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
    case 'control': return {key: `control|${item.fp}|${item.outcome}|${normal(item.why)}`,
      summary: `Control ${text(item.control, 24)} ${text(item.fp, 16)}: ${item.outcome}${item.why ? ` (${text(item.why, 80)})` : ''}`};
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
    FROM telemetry WHERE day >= ? AND kind NOT IN ('health', 'setup') GROUP BY fingerprint ORDER BY users DESC, n DESC LIMIT ?`).bind(from, limit).all()).results || [];
  const installs = (await db.prepare(`SELECT version, platform, COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ?
    GROUP BY version, platform ORDER BY n DESC`).bind(from).all()).results || [];
  // How it helped: each install's latest daily health line, summed (anonymous counts; "ever reached" for the funnel).
  const health = (await db.prepare(`SELECT t.data FROM telemetry t WHERE t.kind = 'health' AND t.day >= ?
    AND t.at = (SELECT MAX(at) FROM telemetry WHERE install = t.install AND kind = 'health')`).bind(from).all()).results || [];
  // Only installs that sent a count add to it; none yet → no number (shown "–", never a false 0).
  const outcomes = {}, counted = {};
  for (const row of health) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    for (const name of OUTCOMES) if (typeof data[name] === 'number') { outcomes[name] = (outcomes[name] || 0) + data[name]; counted[name] = (counted[name] || 0) + 1; }
  }
  outcomes.counted = counted;
  return {from, days, rows, installs, outcomes, reporting: health.length};
}
// Setup funnel (desktop/lib/setup-funnel.js): per install, the furthest step reached; installs that got at least that far.
export const STOP_REASONS = {notion: "Doesn't use Notion", ai: 'AI key or cost', time: 'Too long', privacy: 'Privacy',
  looking: 'Just looking', broke: 'Something broke', other: 'Other'};  // = desktop/lib/setup-funnel.js REASONS
export const SETUP_STEPS = ['welcome', 'ai', 'notion', 'cv', 'draft', 'extras', 'done'];
export async function funnel(db, days, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = (await db.prepare("SELECT install, data FROM telemetry WHERE kind = 'setup' AND day >= ?").bind(from).all()).results || [];
  const furthest = {}, minutesDone = [];
  let trial = 0;
  const trialInstalls = new Set();
  const stopped = {};  // step -> reason -> count ("Leaving setup?" and "Stuck? Tell us")
  for (const row of rows) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    if (data.step === 'stopped') {
      const at = String(data.where || '?'), why = String(data.reason || 'other');
      (stopped[at] ||= {})[why] = (stopped[at][why] || 0) + 1;
      continue;
    }
    const index = SETUP_STEPS.indexOf(data.step);
    if (index < 0) continue;
    furthest[row.install] = Math.max(furthest[row.install] ?? -1, index);
    if (data.step === 'done' && typeof data.minutes === 'number') minutesDone.push(data.minutes);
    if (data.ai === 'trial') trialInstalls.add(row.install);
  }
  trial = trialInstalls.size;
  const reached = SETUP_STEPS.map((step, i) => ({step, n: Object.values(furthest).filter(max => max >= i).length}));
  minutesDone.sort((a, b) => a - b);
  return {stopped, reached, started: Object.keys(furthest).length, medianMinutes: minutesDone.length ? minutesDone[Math.floor(minutesDone.length / 2)] : null, trial};
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
<header><h1>✈ Job Pilotto · app reports</h1><span class="muted">${range} · <a href="/feedback">Live feedback →</a> · <a href="/stats">Website stats →</a></span></header>
<div class="tiles">${tiles.map(([label, value]) => `<div class="card tile"><span class="muted">${label}</span><b>${value}</b></div>`).join('')}</div>
<section class="card" style="margin-bottom:12px"><h2>How it helped</h2><small class="muted">all ${data.reporting} installs reporting, their latest totals</small>
<div class="tiles" style="margin:10px 0 0">${[['🎯 Jobs matched', 'matches'], ['⭐ Good fits (70+)', 'goodFits'], ['🧩 Forms filled', 'formsFilled'],
  ['📨 Applications', 'applied'], ['💬 Human replies', 'replies'], ['📞 Screenings', 'screenings'], ['🧑‍💻 Interviews', 'interviews'], ['🏆 Offers', 'offers']]
  .map(([label, name]) => { const n = data.outcomes?.counted?.[name] || 0;
    return `<div class="tile"><span class="muted">${label}</span><b>${n ? data.outcomes[name] : '–'}</b>${n && n < data.reporting
      ? `<small class="muted">${n} of ${data.reporting} installs</small>` : ''}</div>`; }).join('')}</div>
${Object.keys(data.outcomes?.counted || {}).length ? '' : '<small class="muted">No counts yet: they arrive with each install\'s next daily report.</small>'}</section>
<section class="card" style="margin-bottom:12px"><h2>🚦 Setup funnel</h2><small class="muted">installs that reached each step (last ${data.days < 30 ? 30 : data.days} days)${data.funnel?.medianMinutes != null ? ` · median time to finish: ${data.funnel.medianMinutes} min` : ''}${data.funnel?.trial ? ` · ${data.funnel.trial} used the free AI credit` : ''}</small>
${data.funnel?.started ? `<table style="margin-top:8px">${data.funnel.reached.map(({step, n}, i, all) => `<tr><td style="width:110px">${esc(step)}</td>
  <td><div style="background:var(--amber);height:10px;border-radius:5px;width:${Math.round(n / all[0].n * 100)}%"></div></td>
  <td style="width:60px"><b>${n}</b></td><td class="muted" style="width:90px">${i && all[i - 1].n ? `${Math.round(n / all[i - 1].n * 100)}% of prev` : ''}</td></tr>`).join('')}</table>`
  : '<p class="muted">No setups reported yet.</p>'}
${Object.keys(data.funnel?.stopped || {}).length ? `<h2 style="margin-top:14px">Why they stopped</h2><table>${Object.entries(data.funnel.stopped)
  .map(([at, reasons]) => `<tr><td style="width:110px">${esc(at)}</td><td>${Object.entries(reasons).sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${esc(STOP_REASONS[why] || why)} <b>×${n}</b>`).join(' · ')}</td></tr>`).join('')}</table>` : ''}</section>
<section class="card"><h2>Problems, most users first</h2><table><tr><th>Kind</th><th>Problem (click for a sample)</th><th>Users</th><th>Times</th><th>Versions</th><th>Last</th></tr>
${table || '<tr><td colspan="6" class="muted">No problems reported. 🎉</td></tr>'}</table></section>
<section class="card" style="margin-top:12px"><h2>🧪 Form lab &amp; coverage</h2>
<small class="muted">Share of all real exposure that falls on controls the lab passes at 95% or more: <b>${data.plan?.coverage == null ? '–' : Math.round(data.plan.coverage * 100) + '%'}</b>
 · target 90% · ${data.plan?.exposureTotal || 0} control meetings counted · boards by ${data.plan?.boards?.[0]?.source || 'prior'}</small>
<table style="margin-top:8px"><tr><th>Control</th><th>Met</th><th>Users fail</th><th>Lab</th><th>Recipe</th></tr>
${(data.plan?.head || []).map(item => `<tr><td><code>${esc(item.fingerprint)}</code></td><td>${item.exposure}</td><td>${Math.round(item.userFailRate * 100)}%</td>
  <td>${item.labRate == null ? `untested (${item.labRuns})` : Math.round(item.labRate * 100) + '%'}</td><td>${item.recipe ? 'running' : item.candidate ? 'candidate' : '–'}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">Nothing failing or unproven: nothing to chase.</td></tr>'}</table>
<small class="muted">Lab by board (last 7 days): ${(data.lab || []).slice(0, 8).map(row => `${esc(row.site)} ${esc(row.kind)} ${row.ok}/${row.ok + row.failed}`).join(' · ') || 'no runs yet'}</small></section>
<section class="card" style="margin-top:12px"><h2>💬 Feedback, newest first</h2><small class="muted">From Send feedback in the app (also sent to the Job Pilotto Brain bot). Last ${data.days < 30 ? 30 : data.days} days.</small>
<table style="margin-top:8px"><tr><th>When</th><th>Feedback</th><th>Reply to</th><th>Version</th></tr>
${(data.feedback || []).map(row => `<tr><td class="muted" style="white-space:nowrap">${esc(String(row.at).slice(0, 16).replace('T', ' '))}</td>
  <td style="white-space:pre-wrap">${esc(row.text)}</td><td>${row.contact ? esc(row.contact) : '<span class="muted">–</span>'}</td>
  <td class="muted">${esc(row.version)} · ${esc(row.platform)}<br>${esc(String(row.install).slice(0, 8))}</td></tr>`).join('')
  || '<tr><td colspan="4" class="muted">No feedback yet.</td></tr>'}</table></section>
<p class="muted">Since ${esc(data.from)} (UTC). Scrubbed on each Mac before sending; no answers, CV, emails, names or keys. Kept ${KEEP_DAYS} days.</p>
</main></body></html>`;
}

// GET /telemetry?days=7 (same key or cookie as /stats)
export async function view(request, env, now = new Date()) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  if (new URL(request.url).searchParams.has('key')) return remember(new URL(request.url), env);
  const days = [1, 7, 30].includes(Number(new URL(request.url).searchParams.get('days'))) ? Number(new URL(request.url).searchParams.get('days')) : 7;
  try {
    const [data, feedback, setup] = await Promise.all([problems(env.STATS, days, now), feedbackList(env.STATS, Math.max(days, 30), now).catch(() => []),
      funnel(env.STATS, Math.max(days, 30), now).catch(() => null)]);
    const plan = await labPlan(env.STATS, now).catch(() => null), lab = await labReport(env.STATS, 7, now).catch(() => []);
    return new Response(page({...data, feedback, funnel: setup, plan, lab}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
  } catch (error) {  // e.g. the table isn't there yet: say what to do, not a blank error
    return new Response(`App reports can't be read yet: ${esc(error.message)}. Apply the database migrations: cd site && npx wrangler@4 d1 migrations apply www-stats --remote`,
      {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}

// GET /telemetry/version?v=0.4.0-alpha.50&compare=0.4.0-alpha.40 (the /stats key, as `Authorization: Bearer`):
// positive evidence that a build was used and worked, per exact version, for the canary auto-promote
// (tools/canary_promote.py). Health lines carry runsOk / runsFailed since the previous line (desktop/main.js).
const VERSION = /^[\w.+-]{1,30}$/;
export async function versionEvidence(db, version) {
  const rows = (await db.prepare('SELECT day, at, kind, install, data FROM telemetry WHERE version = ?').bind(version).all()).results || [];
  const health = rows.filter(row => row.kind === 'health');
  const times = list => list.map(row => row.at).filter(at => !Number.isNaN(Date.parse(at))).sort();
  const events = Object.fromEntries(KINDS.map(kind => [kind, rows.filter(row => row.kind === kind).length]));
  let runsOk = 0, runsFailed = 0, runsReported = 0;
  for (const row of health) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    if (typeof data.runsOk !== 'number' && typeof data.runsFailed !== 'number') continue;
    runsReported++;
    runsOk += Number(data.runsOk) || 0;
    runsFailed += Number(data.runsFailed) || 0;
  }
  const all = times(rows), healthTimes = times(health);
  return {version, installs: new Set(rows.map(row => row.install)).size, healthInstalls: new Set(health.map(row => row.install)).size,
    healthDays: new Set(health.map(row => row.day)).size, firstSeen: all[0] || null, lastSeen: all.at(-1) || null,
    healthFirst: healthTimes[0] || null, healthLast: healthTimes.at(-1) || null,
    runs: {ok: runsOk, failed: runsFailed, reports: runsReported}, events};
}
export async function evidence(request, env) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const params = new URL(request.url).searchParams;
  const versions = [params.get('v'), params.get('compare')].filter(Boolean);
  if (!versions.length || !versions.every(v => VERSION.test(v))) return Response.json({ok: false, error: 'give ?v=<app version>'}, {status: 400});
  const result = {};
  for (const v of versions) result[v] = await versionEvidence(env.STATS, v);
  return Response.json({ok: true, keptDays: KEEP_DAYS, versions: result}, {headers: {'Cache-Control': 'no-store'}});
}

// Daily (Worker cron): drop reports older than 90 days, then send the top problems of the last day to the triage
// workflow, which files or updates one GitHub issue per problem (.github/workflows/telemetry-triage.yml).
export async function daily(env, dispatch, now = new Date()) {
  if (!env.STATS) return 0;
  await env.STATS.prepare('DELETE FROM telemetry WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_DAYS * 86400000))).run();
  const {rows: found} = await problems(env.STATS, 7, now, 50);
  // Only what recurs becomes an issue: several installs, or very many times. The rest stays counted, visible on /telemetry, and
  // waits (2 Oct 2026). A control failure that a running recipe already covers is handled there, not here.
  const rows = found.filter(row => row.users >= TRIAGE_MIN_USERS || row.n >= TRIAGE_MIN_TIMES).slice(0, 10);
  if (!rows.length) return 0;
  const brief = rows.map(row => ({fingerprint: row.fingerprint, kind: row.kind, summary: row.summary, users: row.users, times: row.n,
    versions: row.versions, sample: String(row.sample).slice(0, 2500)}));
  let payload = JSON.stringify(brief);
  while (payload.length > 60000 && brief.length > 1) { brief.pop(); payload = JSON.stringify(brief); }
  await dispatch(env, {problems: payload}, 'telemetry-triage.yml');
  return brief.length;
}
