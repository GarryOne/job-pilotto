// Technical reports from Job Pilotto apps (desktop/lib/telemetry.js scrubs them before sending): POST /report/telemetry
// stores them (D1 "telemetry", 90 days), /telemetry shows the problems users hit (same key as /stats), and a daily
// run (scheduled) picks the top problems and starts the triage workflow on GitHub, which files or updates an issue
// per problem. Design: Notion "📡 Technical reports (telemetry) — design".
import {filterLinks} from './admin.js';
import {viewer} from './auth.js';   // admins (invited) read this page too
import {trendChip} from './admin.js';
import {appTrends} from './trends.js';
const chip = (data, key) => (data.trends?.[key] ? trendChip(data.trends[key].label, data.trends[key].values, data.trends[key]) : '');   // its weeks (src/trends.js)

import {feedbackList} from './feedback.js';
import {flags} from './guard.js';
import {report as knowledgeReport} from './knowledge.js';
import {labPlan, labReport} from './recipes.js';
import {isOwner, esc, remember} from './stats.js';

export const KINDS = ['crash', 'run_failed', 'run_warning', 'form_issue', 'stuck', 'health', 'setup', 'control', 'advice'];
export const TRIAGE_MIN_USERS = 3, TRIAGE_MIN_TIMES = 20;
// What becomes a GitHub issue: [installs, times] by kind (either is enough). Crashes, stuck runs and failed runs are rare and always
// worth reading, from the first install; a run that ended with warnings (AI not answering, Notion refusing) must repeat (3 times) or come from 3 installs;
// form and control reports are many, so they wait for several installs (2 Oct 2026: a friend's search hung for 40 minutes and, with
// the old 3-installs-or-20-times rule, would never have reached an issue).
export const TRIAGE_AT = {crash: [1, 1], stuck: [1, 1], run_failed: [1, 1], run_warning: [3, 3]};
export const triageWorthy = row => { const [users, times] = TRIAGE_AT[row.kind] || [TRIAGE_MIN_USERS, TRIAGE_MIN_TIMES]; return row.users >= users || row.n >= times; };
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
    case 'run_warning': return {key: `warn|${item.job}|${normal(item.warning)}`, summary: `${item.job}: ${text(item.warning, 150)} (ended with warnings)`};
    case 'form_issue': return {key: `form|${item.site}|${normal(item.label)}|${item.reason}`, summary: `${item.site}: ${text(item.label, 80)} (${item.reason || 'not filled'})`};
    case 'control': return {key: `control|${item.fp}|${item.outcome}|${normal(item.why)}`,
      summary: `Control ${text(item.control, 24)} ${text(item.fp, 16)}: ${item.outcome}${item.why ? ` (${text(item.why, 80)})` : ''}`};
    case 'advice': return {key: `advice|${item.where}|${item.advice}|${item.act}`, summary: `Advice ${text(item.advice, 20)} on ${text(item.where, 20)}: ${text(item.act, 10)}${item.source ? ` (${text(item.source, 30)})` : ''}`};
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
  // Machines, not (version, platform) rows: one install that updated twice reports under three versions but is one machine.
  const unique = (await db.prepare('SELECT COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ?').bind(from).first())?.n || 0;
  const everSeen = (await db.prepare('SELECT COUNT(DISTINCT install) AS n FROM telemetry').first())?.n || 0;
  // Each machine once: the version it last reported (what is installed now), when it first and last reported, and every version it has run.
  const machines = (await db.prepare(`SELECT install, platform, version AS current, MAX(at) AS last FROM telemetry
    GROUP BY install ORDER BY last DESC LIMIT 50`).all()).results || [];
  const history = (await db.prepare('SELECT install, version, MIN(at) AS at FROM telemetry GROUP BY install, version ORDER BY at').all()).results || [];
  for (const m of machines) {
    const own = history.filter(h => h.install === m.install);
    m.versions = own.map(h => h.version);
    m.first = own[0]?.at;
  }
  const platforms = (await db.prepare('SELECT platform, COUNT(DISTINCT install) AS n FROM telemetry WHERE day >= ? GROUP BY platform ORDER BY n DESC').bind(from).all()).results || [];
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
  return {from, days, rows, installs, unique, everSeen, platforms, machines, outcomes, reporting: health.length};
}
// Machines by the channel they came from (the install link's ?src=, reported once by the app with its anonymous id):
// how many installed, how many finished setup, how many are active (reported on 2+ days). "unknown" = installed from a
// download button, or before the app reported a channel. A channel is a label, never a person.
export async function channels(db, days, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  return (await db.prepare(`WITH per AS (
      SELECT install, MAX(json_extract(data, '$.source')) AS source,
        COUNT(DISTINCT CASE WHEN kind = 'health' THEN day END) AS health_days,
        MAX(CASE WHEN kind = 'setup' AND json_extract(data, '$.step') = 'done' THEN 1 ELSE 0 END) AS done
      FROM telemetry WHERE day >= ? GROUP BY install)
    SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS machines, SUM(done) AS done, SUM(health_days >= 2) AS active
    FROM per GROUP BY COALESCE(source, 'unknown') ORDER BY machines DESC, source LIMIT 30`).bind(from).all()).results || [];
}

// Setup funnel (desktop/lib/setup-funnel.js): per install, the furthest step reached; installs that got at least that far.
export const STOP_REASONS = {notion: "Doesn't use Notion", ai: 'AI key or cost', time: 'Too long', privacy: 'Privacy',
  looking: 'Just looking', broke: 'Something broke', other: 'Other'};  // = desktop/lib/setup-funnel.js REASONS
export const GATE_WHY = {no_notion: "Doesn't use Notion", privacy: 'Privacy', later: 'Later', other: 'Something else'};  // = desktop/lib/notion-gate.js WHY
export const SETUP_STEPS = ['welcome', 'ai', 'notion', 'cv', 'draft', 'extras', 'done'];  // 'notion': older apps only (it left the wizard 3 Oct 2026); "reached" counts furthest ≥ step, so newer installs pass it
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

// Who refuses Notion (desktop/lib/notion-gate.js gateEvent; Notion later, 3 Oct 2026): per install, did it ever connect after
// seeing the prompt, and why not. REVISIT_AT / REVISIT_RATE = the trigger written in docs/superpowers/specs/2026-10-03-notion-later.md.
export const GATE_REVISIT_INSTALLS = 30, GATE_REVISIT_RATE = 0.4;
export async function gateStats(db, days, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = (await db.prepare("SELECT install, data FROM telemetry WHERE kind = 'setup' AND day >= ?").bind(from).all()).results || [];
  const perInstall = {}, byReason = {}, whys = {};
  for (const row of rows) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    if (data.step !== 'notion_gate') continue;
    const mine = perInstall[row.install] ||= {prompts: 0, connected: false};
    const reason = String(data.reason || 'none');
    const line = byReason[reason] ||= {reason, shown: 0, connected: 0, not_now: 0, closed: 0, failed: 0, viewed: 0};
    if (data.outcome in line) line[data.outcome] += 1;
    if (data.outcome === 'viewed') continue;  // seeing a locked page is not a refusal
    mine.prompts += 1;
    line.shown += 1;
    if (data.outcome === 'connected') mine.connected = true;
    if (data.outcome === 'not_now' && data.why) whys[data.why] = (whys[data.why] || 0) + 1;
  }
  const saw = Object.values(perInstall).filter(item => item.prompts > 0);
  const never = saw.filter(item => !item.connected);
  const topWhy = Object.entries(whys).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const neverRate = saw.length ? never.length / saw.length : 0;
  return {installs: saw.length, connected: saw.length - never.length, never: never.length, neverRate,
    repeaters: never.filter(item => item.prompts >= 3).length, whys, topWhy,
    reasons: Object.values(byReason).sort((a, b) => b.shown - a.shown),
    revisit: saw.length >= GATE_REVISIT_INSTALLS && neverRate > GATE_REVISIT_RATE && topWhy === 'no_notion'};
}

export const OUTCOMES = ['matches', 'goodFits', 'formsFilled', 'applied', 'replies', 'screenings', 'interviews', 'offers'];

const STEP_LABELS = {ai: 'AI', cv: 'CV'};
const OS_NAMES = {darwin: 'macOS', win32: 'Windows', linux: 'Linux'};

function page(data) {
  const {rows, installs} = data;
  const count = kind => rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.n, 0);
  const range = filterLinks([1, 7, 30].map(n => [n, n === 1 ? 'today' : `${n} days`, `?days=${n}`]), data.days);
  const tiles = [['🖥️ Machines reporting', data.unique, `${data.everSeen} ever seen` + (data.platforms.length ? ' · ' + data.platforms.map(p => `${p.n} ${esc(OS_NAMES[p.platform] || p.platform)}`).join(', ') : '')], ['💥 Crashes', count('crash')], ['🔁 Failed runs', count('run_failed')], ['🧩 Form issues', count('form_issue')]];
  const table = rows.map(row => `<tr><td><span class="kind ${row.kind}">${esc(row.kind.replace('_', ' '))}</span></td>
    <td><details><summary>${esc(row.summary)}</summary><pre>${esc(JSON.stringify(JSON.parse(row.sample || '{}'), null, 1))}</pre></details></td>
    <td><b>${row.users}</b></td><td>${row.n}</td><td class="muted">${esc(row.versions)}</td><td class="muted">${esc(String(row.last).slice(0, 16).replace('T', ' '))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>App · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--red:#e5776b;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0 0 6px;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}.tile b{display:block;font-size:32px;margin-top:4px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 4px}
td{padding:8px 4px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}summary{cursor:pointer}
.funnel td{vertical-align:middle;padding:7px 14px 7px 0;white-space:nowrap}.funnel td.step{width:120px}.funnel td.bar{width:100%;white-space:normal}.funnel td.bar div{background:var(--amber);height:12px;border-radius:6px}.funnel td.n{text-align:right;font-variant-numeric:tabular-nums}.funnel tr:last-child td.bar div{background:var(--teal)}
.machines{font-size:14px}.machines td,.machines th{white-space:nowrap;padding:10px 18px 10px 0;vertical-align:middle}.machines td.vs{white-space:normal;line-height:2}.machines .v{display:inline-block;white-space:nowrap;margin:0 4px 0 0;padding:0 8px;border-radius:99px;background:var(--line);color:var(--muted);font-size:12px}.machines .v.now{background:var(--amber);color:#000;font-weight:700;font-size:13px}.machines td.num{font-variant-numeric:tabular-nums}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted);margin:8px 0 0}.kind{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--line);white-space:nowrap}
.kind.crash{color:var(--red)}.kind.run_failed{color:var(--amber)}.kind.form_issue{color:var(--teal)}
</style></head><body><main>
<header><h1>🖥️ App</h1><span class="muted">${range}</span></header>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${value}</b>${note ? `<small class="muted">${note}</small>` : ''}</div>`).join('')}</div>
<section class="card" style="margin-bottom:12px"><h2>Problems, most users first${chip(data, 'problems')}</h2><table><tr><th>Kind</th><th>Problem (click for a sample)</th><th>Users</th><th>Times</th><th>Versions</th><th>Last</th></tr>
${table || '<tr><td colspan="6" class="muted">No problems reported. 🎉</td></tr>'}</table></section>
<section class="card" style="margin-bottom:12px"><h2>🖥️ Machines${chip(data, 'machines')}</h2><small class="muted">one row per install: the version it runs now, and every version it has run (id shown as a short prefix)</small>
<div style="overflow-x:auto"><table class="machines"><tr><th>Install</th><th>OS</th><th>Version</th><th>First seen</th><th>Last seen</th><th>Earlier versions</th></tr>${data.machines.map(m => `<tr><td><code>${esc(String(m.install).slice(0, 6))}</code></td><td>${esc(OS_NAMES[m.platform] || m.platform)}</td><td><span class="v now">${esc(m.current)}</span></td><td class="muted num">${esc(String(m.first || '').slice(0, 10))}</td><td class="muted num">${esc(String(m.last || '').slice(0, 16).replace('T', ' '))}</td><td class="vs">${m.versions.filter(v => v !== m.current).map(v => `<span class="v">${esc(v)}</span>`).join('') || '<span class="muted">–</span>'}</td></tr>`).join('')
  || '<tr><td colspan="6" class="muted">No machine has reported yet.</td></tr>'}</table></div></section>
<section class="card" style="margin-bottom:12px"><h2>How it helped${chip(data, 'helped')}</h2><small class="muted">all ${data.reporting} installs reporting, their latest totals</small>
<div class="tiles" style="margin:10px 0 0">${[['🎯 Jobs matched', 'matches'], ['⭐ Good fits (70+)', 'goodFits'], ['🧩 Forms filled', 'formsFilled'],
  ['📨 Applications', 'applied'], ['💬 Human replies', 'replies'], ['📞 Screenings', 'screenings'], ['🧑‍💻 Interviews', 'interviews'], ['🏆 Offers', 'offers']]
  .map(([label, name]) => { const n = data.outcomes?.counted?.[name] || 0;
    return `<div class="tile"><span class="muted">${label}</span><b>${n ? data.outcomes[name] : '–'}</b>${n && n < data.reporting
      ? `<small class="muted">${n} of ${data.reporting} installs</small>` : ''}</div>`; }).join('')}</div>
${Object.keys(data.outcomes?.counted || {}).length ? '' : '<small class="muted">No counts yet: they arrive with each install\'s next daily report.</small>'}</section>
<section class="card" style="margin-bottom:12px"><h2>📣 Channels${chip(data, 'channels')}</h2><small class="muted">where installs came from (last ${data.days < 30 ? 30 : data.days} days): finished setup, and active = reported on 2+ days</small>
<div style="overflow-x:auto"><table class="machines"><tr><th>Channel</th><th>Machines</th><th>Finished setup</th><th>Active</th></tr>${(data.channels || []).map(c => `<tr><td>${esc(c.source)}</td><td class="num">${c.machines}</td><td class="num">${c.done}</td><td class="num">${c.active}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No machine has reported yet.</td></tr>'}</table></div>
<small class="muted" style="display:block;margin-top:6px">A channel comes from the Terminal command's link (<code>?utm_source=reddit-devops</code>) or, for a download button, from the click on the same network in the 7 days before the app's first start (since 7 Oct 2026). "direct" = typed or bookmarked; "unknown" = no such click, or installed before 7 Oct 2026.</small></section>
<section class="card" style="margin-bottom:12px"><h2>🚦 Setup funnel${chip(data, 'setup')}</h2><small class="muted">installs that reached each step (last ${data.days < 30 ? 30 : data.days} days)${data.funnel?.medianMinutes != null ? ` · median time to finish: ${data.funnel.medianMinutes} min` : ''}${data.funnel?.trial ? ` · ${data.funnel.trial} used the free AI credit` : ''}</small>
${data.funnel?.started ? `<table class="funnel">${data.funnel.reached.map(({step, n}, i, all) => {
  const lost = i ? all[i - 1].n - n : 0;
  return `<tr><td class="step"><span class="muted">${i + 1}</span> ${esc(STEP_LABELS[step] || step.charAt(0).toUpperCase() + step.slice(1))}</td>
  <td class="bar"><div style="width:${Math.max(2, Math.round(n / all[0].n * 100))}%"></div></td>
  <td class="n"><b>${n}</b></td><td class="muted n">${Math.round(n / all[0].n * 100)}%</td><td class="n" style="color:var(--red)">${lost ? `−${lost}` : ''}</td></tr>`;
}).join('')}</table><small class="muted" style="display:block;margin-top:6px">% of the ${data.funnel.reached[0].n} installs that started · red: lost since the step before</small>`
  : '<p class="muted">No setups reported yet.</p>'}
${Object.keys(data.funnel?.stopped || {}).length ? `<h2 style="margin-top:14px">Why they stopped</h2><table>${Object.entries(data.funnel.stopped)
  .map(([at, reasons]) => `<tr><td style="width:110px">${esc(at)}</td><td>${Object.entries(reasons).sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${esc(STOP_REASONS[why] || why)} <b>×${n}</b>`).join(' · ')}</td></tr>`).join('')}</table>` : ''}</section>
<section class="card" style="margin-bottom:12px"><h2>🗂️ Notion prompt${chip(data, 'notion')}</h2><small class="muted">installs that were asked to connect Notion (last ${data.days < 30 ? 30 : data.days} days): did they, and why not</small>
${data.gate?.installs ? `<p style="margin:8px 0"><b>${data.gate.installs}</b> asked · <b>${data.gate.connected}</b> connected · <b>${data.gate.never}</b> never (${Math.round(data.gate.neverRate * 100)}%)${data.gate.repeaters ? ` · ${data.gate.repeaters} asked 3+ times without connecting` : ''}</p>
<table><tr><th>Asked for</th><th>Shown</th><th>Connected</th><th>Not now</th><th>Closed</th><th>Failed</th><th>Page opened</th></tr>${data.gate.reasons.map(r => `<tr><td>${esc(r.reason)}</td><td class="num">${r.shown}</td><td class="num">${r.connected}</td><td class="num">${r.not_now}</td><td class="num">${r.closed}</td><td class="num">${r.failed}</td><td class="num">${r.viewed}</td></tr>`).join('')}</table>
${Object.keys(data.gate.whys).length ? `<p class="muted" style="margin-top:8px">Why not: ${Object.entries(data.gate.whys).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${esc(GATE_WHY[why] || why)} <b>×${n}</b>`).join(' · ')}</p>` : ''}
<small class="muted" style="display:block;margin-top:6px">Revisit local tracking without Notion when, over ${GATE_REVISIT_INSTALLS}+ installs asked, more than ${Math.round(GATE_REVISIT_RATE * 100)}% never connect and "I don't use Notion" is the top reason. ${data.gate.revisit ? '<b style="color:var(--red)">That is the case now.</b>' : 'Not yet.'}</small>`
  : '<p class="muted">Nobody has been asked yet.</p>'}</section>
<section class="card" style="margin-top:12px"><h2>🧪 Form lab &amp; coverage${chip(data, 'lab')}</h2>
<small class="muted">Share of all real exposure that falls on controls the lab passes at 95% or more: <b>${data.plan?.coverage == null ? '–' : Math.round(data.plan.coverage * 100) + '%'}</b>
 · target 90% · ${data.plan?.exposureTotal || 0} control meetings counted · boards by ${data.plan?.boards?.[0]?.source || 'prior'}</small>
<table style="margin-top:8px"><tr><th>Control</th><th>Met</th><th>Users fail</th><th>Lab</th><th>Recipe</th></tr>
${(data.plan?.head || []).map(item => `<tr><td><code>${esc(item.fingerprint)}</code></td><td>${item.exposure}</td><td>${Math.round(item.userFailRate * 100)}%</td>
  <td>${item.labRate == null ? `untested (${item.labRuns})` : Math.round(item.labRate * 100) + '%'}</td><td>${item.recipe ? 'running' : item.candidate ? 'candidate' : '–'}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">Nothing failing or unproven: nothing to chase.</td></tr>'}</table>
<small class="muted">Lab by board (last 7 days): ${(data.lab || []).slice(0, 8).map(row => `${esc(row.site)} ${esc(row.kind)} ${row.ok}/${row.ok + row.failed}`).join(' · ') || 'no runs yet'}</small></section>
<section class="card" style="margin-top:12px"><h2>🧬 What installs ask and where they stall${chip(data, 'asks')}</h2>
<small class="muted">Questions no answer matched, reported by ${3} or more installs (the form's own wording), and where applications got to per board (last 7 days).</small>
<table style="margin-top:8px"><tr><th>Question</th><th>Kind</th><th>Times</th><th>Installs</th><th>Boards</th></tr>
${(data.knowledge?.questions || []).slice(0, 15).map(row => `<tr><td>${esc(row.label)}</td><td>${esc(row.kind)}</td><td>${row.n}</td><td>${row.installs}</td><td class="muted">${esc((row.boards || []).slice(0, 3).join(', '))}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">No question has reached 3 installs yet.</td></tr>'}</table>
<table style="margin-top:8px"><tr><th>Board</th><th>How applications went (told by users, last 7 days)</th></tr>
${Object.entries((data.knowledge?.outcomes || []).reduce((all, row) => { (all[row.board] ||= []).push(`${esc(row.outcome)} <b>×${row.n}</b>`); return all; }, {})).slice(0, 12)
  .map(([board, parts]) => `<tr><td>${esc(board)}</td><td>${parts.join(' · ')}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No outcomes told yet.</td></tr>'}</table>
<table style="margin-top:8px"><tr><th>Board</th><th>Where applications got to</th></tr>
${Object.entries((data.knowledge?.flows || []).reduce((all, row) => { (all[row.board] ||= []).push(`${esc(row.state)} <b>×${row.n}</b>`); return all; }, {})).slice(0, 12)
  .map(([board, parts]) => `<tr><td>${esc(board)}</td><td>${parts.join(' · ')}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No flow outcomes yet.</td></tr>'}</table></section>
<section class="card" style="margin-top:12px"><h2>🛡️ Access guard${chip(data, 'guard')}</h2>
<small class="muted">Who hit a limit or touched a decoy (last 7 days; installs are shown only as a short digest). ${data.guard ? data.guard.honeypots : 0} honeypot fingerprints planted.</small>
<table style="margin-top:8px"><tr><th>What</th><th>Who</th><th>Times</th></tr>
${(data.guard?.seen || []).map(row => `<tr><td>${esc(row.kind)}</td><td><code>${esc(row.who)}</code></td><td>${row.n}</td></tr>`).join('')
  || '<tr><td colspan="3" class="muted">Nothing odd. 🎉</td></tr>'}</table>
${(data.guard?.revoked || []).length ? `<small class="muted">Revoked: ${(data.guard.revoked).map(row => `<code>${esc(row.who)}</code> (${esc(row.reason)})`).join(' · ')}</small>` : ''}</section>
<section class="card" style="margin-top:12px"><h2>💬 Feedback${chip(data, 'feedback')}</h2><p style="margin:6px 0 0">${(data.feedback || []).length
  ? `${(data.feedback || []).length} message${(data.feedback || []).length === 1 ? '' : 's'} in the last ${data.days < 30 ? 30 : data.days} days · <a href="/admin/feedback">Open Feedback →</a>`
  : '<span class="muted">No feedback yet.</span> <a href="/admin/feedback">Feedback →</a>'}</p></section>
<p class="muted">Since ${esc(data.from)} (UTC). Scrubbed on each Mac before sending; no answers, CV, emails, names or keys. Kept ${KEEP_DAYS} days.</p>
</main></body></html>`;
}

// GET /telemetry?days=7 (same key or cookie as /stats)
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  if (new URL(request.url).searchParams.has('key')) return remember(new URL(request.url), env, request);
  const days = [1, 7, 30].includes(Number(new URL(request.url).searchParams.get('days'))) ? Number(new URL(request.url).searchParams.get('days')) : 7;
  try {
    const [data, feedback, setup, byChannel, gate] = await Promise.all([problems(env.STATS, days, now), feedbackList(env.STATS, Math.max(days, 30), now).catch(() => []),
      funnel(env.STATS, Math.max(days, 30), now).catch(() => null), channels(env.STATS, Math.max(days, 30), now).catch(() => []),
      gateStats(env.STATS, Math.max(days, 30), now).catch(() => null)]);
    const plan = await labPlan(env.STATS, now).catch(() => null), lab = await labReport(env.STATS, 7, now).catch(() => []), guardData = await flags(env.STATS, 7, now).catch(() => null), learned = await knowledgeReport(env.STATS, 7, now).catch(() => null), trends = await appTrends(env.STATS, now).catch(() => null);
    return new Response(page({...data, feedback, funnel: setup, gate, channels: byChannel, plan, lab, guard: guardData, knowledge: learned, trends}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
  } catch (error) {  // e.g. the table isn't there yet: say what to do, not a blank error
    return new Response(`App reports can't be read yet: ${esc(error.message)}. Apply the database migrations: cd site && npx wrangler@4 d1 migrations apply www-stats --remote`,
      {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}

// GET /telemetry/version?v=0.5.3&compare=0.5.1 (the /stats key, as `Authorization: Bearer`):
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
  if (!await isOwner(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const params = new URL(request.url).searchParams;
  const versions = [params.get('v'), params.get('compare')].filter(Boolean);
  if (!versions.length || !versions.every(v => VERSION.test(v))) return Response.json({ok: false, error: 'give ?v=<app version>'}, {status: 400});
  const result = {};
  for (const v of versions) result[v] = await versionEvidence(env.STATS, v);
  return Response.json({ok: true, keptDays: KEEP_DAYS, versions: result}, {headers: {'Cache-Control': 'no-store'}});
}

// Daily (Worker cron): drop reports older than 90 days, then send the top problems of the last day to the triage
// queue, which the private repo's triage pulls and files as one issue per problem.
export async function daily(env, dispatch, now = new Date()) {
  if (!env.STATS) return 0;
  await env.STATS.prepare('DELETE FROM telemetry WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_DAYS * 86400000))).run();
  const {rows: found} = await problems(env.STATS, 7, now, 50);
  // Only what recurs becomes an issue: several installs, or very many times. The rest stays counted, visible on /telemetry, and
  // waits (2 Oct 2026). A control failure that a running recipe already covers is handled there, not here.
  const rows = found.filter(triageWorthy).slice(0, 10);
  if (!rows.length) return 0;
  const brief = rows.map(row => ({fingerprint: row.fingerprint, kind: row.kind, summary: row.summary, users: row.users, times: row.n,
    versions: row.versions, sample: String(row.sample).slice(0, 2500)}));
  let payload = JSON.stringify(brief);
  while (payload.length > 60000 && brief.length > 1) { brief.pop(); payload = JSON.stringify(brief); }
  await dispatch(env, {problems: payload}, 'telemetry-triage.yml');
  return brief.length;
}
