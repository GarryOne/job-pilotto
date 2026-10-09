// The owner's page /ai-cost: everything the product's own scheduled jobs spend on AI (central scout, self-heal, product brain, proposers, form lab...).
// Not the users' Always-on runs: those are paid with their own keys. Owner-only like /stats (STATS_KEY), never a static page.
import {viewer} from './auth.js';   // admins (invited) read this page too
import {isOwner, esc, remember} from './stats.js';
import {equal} from './guard.js';

export const JOBS = {   // job id -> [label, group]; an unknown id still shows, under "other"
  'central-scout': ['Central scout', 'Discovery'],
  'form-lab': ['Form lab', 'Discovery'],
  'recipe-proposer': ['Recipe proposer', 'Discovery'],
  'alias-proposer': ['Alias proposer', 'Discovery'],
  'ui-fix': ['UI fixer', 'Self-heal'],
  'ui-verdict': ['Verdict pass', 'Self-heal'],
  'code-review': ['Code review', 'Self-heal'],
  'finder-review': ['Finder self-review', 'Self-heal'],
  'e2e-screenshot-review': ['E2E screenshot review', 'Self-heal'],
  'e2e-app': ['E2E: the app under test', 'E2E tests'],   // its AI calls in CI suites (desktop/e2e/lib/ai-meter.mjs)
  'e2e-judges': ['E2E: test judges', 'E2E tests'],
  'sentry-fix': ['Sentry fixer', 'Self-heal'],
  'weekly-self-review': ['Weekly self-review', 'Self-heal'],
  'product-brain': ['Product brain', 'Product brain'],
};
const day = at => String(at).slice(0, 10);
const money = n => `$${(Number(n) || 0).toFixed(2)}`;

// Pure: the page's figures from the run rows and the billed days.
// The AI providers a run can report (`provider` in PUT /ai-cost/data; missing: anthropic, what every job spent on before 9 Oct 2026).
export const PROVIDERS = {anthropic: 'Claude (Anthropic)', openai: 'OpenAI'};
const providerOf = row => (row.provider === 'openai' ? 'openai' : 'anthropic');

export function summarize(rows, billed = [], now = new Date()) {
  const today = now.toISOString().slice(0, 10), from = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const recent = rows.filter(row => row.day >= from);
  const jobs = {}, days = {}, providers = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, {id, today: 0, usd: 0, runs: 0}]));
  for (const row of recent) {
    const provider = providers[providerOf(row)];
    provider.usd += row.usd; provider.runs += 1; if (row.day === today) provider.today += row.usd;
    const job = jobs[row.job] ||= {job: row.job, runs: 0, usd: 0, calls: 0, last: ''};
    job.runs += 1; job.usd += row.usd; job.calls += row.calls; if (row.at > job.last) job.last = row.at;
    days[row.day] = (days[row.day] || 0) + row.usd;
  }
  const billedByDay = Object.fromEntries(billed.map(item => [item.day, item.usd]));
  const total = recent.reduce((sum, row) => sum + row.usd, 0);
  const span = Math.max(1, Math.round((Date.parse(today) - Date.parse(recent.reduce((min, row) => (row.day < min ? row.day : min), today))) / 86400000) + 1);
  const billedTotal = Object.entries(billedByDay).filter(([d]) => d >= from).reduce((sum, [, usd]) => sum + usd, 0);
  const overlap = Object.keys(billedByDay).filter(d => d >= from && days[d] !== undefined);   // compare only days where both sides exist
  const trackedOnBilledDays = overlap.reduce((sum, d) => sum + days[d], 0), billedOnTrackedDays = overlap.reduce((sum, d) => sum + billedByDay[d], 0);
  return {
    today: days[today] || 0, total, perDay: total / span, span, runs: recent.length,
    jobs: Object.values(jobs).sort((a, b) => b.usd - a.usd),
    providers: Object.values(providers),   // Claude and OpenAI separately; their sum is `total`
    days: [...new Set([...Object.keys(days), ...Object.keys(billedByDay).filter(d => d >= from)])].sort().reverse().map(d => ({day: d, tracked: days[d] || 0, billed: billedByDay[d] ?? null})),
    billedTotal, covered: billedOnTrackedDays > 0 ? Math.round(100 * trackedOnBilledDays / billedOnTrackedDays) : null,
  };
}

// Pure: per tracked API key, its cost today, over 7 and over 30 days (rows: {day, key, usd}).
export function byKey(rows, now = new Date()) {
  const day = n => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10), today = day(0), week = day(6), month = day(29);
  const keys = {};
  for (const row of rows) {
    if (row.day < month) continue;
    const k = keys[row.key] ||= {key: row.key, today: 0, week: 0, month: 0, last: ''};
    k.month += row.usd; if (row.day >= week) k.week += row.usd; if (row.day === today) k.today += row.usd; if (row.day > k.last) k.last = row.day;
  }
  return Object.values(keys).sort((a, b) => b.month - a.month);
}

export function page(rows, billed = [], keyRows = [], start = '', now = new Date()) {
  const s = summarize(rows, billed, now), keys = byKey(keyRows, now);
  const fresh = start && start > new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);   // the start date is inside the 30 days: say so
  const groups = {};
  for (const job of s.jobs) { const group = (JOBS[job.job] || [])[1] || 'Other'; groups[group] = (groups[group] || 0) + job.usd; }
  const tiles = [
    [fresh ? `💸 Since ${start}` : '💸 Last 30 days', money(s.total), `${s.runs} runs reported`],
    ['📅 Today', money(s.today), 'UTC'],
    ['📈 Per day', money(s.perDay), `average over ${s.span} day${s.span === 1 ? '' : 's'}`],
    ['🧾 Billed by Anthropic', billed.length ? money(s.billedTotal) : '–', billed.length ? `the jobs explain ${s.covered === null ? '–' : s.covered + '%'} of it` : 'no billing report yet (ANTHROPIC_ADMIN_KEY)'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>AI cost · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px}
.tile{margin-bottom:0}.tile b{display:block;font-size:30px;margin:4px 0 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}
td{padding:6px 4px;border-top:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tr.total td{font-weight:700}
</style></head><body><main>
<header><h1>💸 AI cost</h1><span class="muted">scheduled jobs of the product</span></header>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${esc(value)}</b><small class="muted">${esc(note)}</small></div>`).join('')}</div>
<section class="card"><h2>🏷️ By provider</h2><small class="muted">Claude and OpenAI separately, and together</small><div class="wrap"><table><tr><th>Provider</th><th>Today</th><th>Last 30 days</th><th>Share</th><th>Runs</th></tr>
${s.providers.map(p => `<tr><td>${esc(PROVIDERS[p.id])}</td><td class="n">${money(p.today)}</td><td class="n">${money(p.usd)}</td><td class="n">${s.total ? Math.round(100 * p.usd / s.total) : 0}%</td><td class="n">${p.runs}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td class="n">${money(s.today)}</td><td class="n">${money(s.total)}</td><td class="n">${s.total ? '100%' : '–'}</td><td class="n">${s.runs}</td></tr>
</table></div></section>
<div class="grid">
<section class="card"><h2>🧩 By group</h2><div class="wrap"><table><tr><th>Group</th><th>Last 30 days</th></tr>
${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([group, usd]) => `<tr><td>${esc(group)}</td><td class="n">${money(usd)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Nothing reported yet: each job reports at the end of its run.</td></tr>'}
</table></div></section>
<section class="card"><h2>📅 By day</h2><small class="muted">Jobs = reported by the jobs · Billed = Anthropic's cost report</small><div class="wrap"><table><tr><th>Day</th><th>Jobs</th><th>Billed</th></tr>
${s.days.slice(0, 30).map(d => `<tr><td>${esc(d.day)}</td><td class="n">${money(d.tracked)}</td><td class="n">${d.billed === null ? '–' : money(d.billed)}</td></tr>`).join('')}
</table></div></section></div>
<section class="card"><h2>🔑 By API key</h2><small class="muted">Anthropic's usage per key, priced and scaled to the day's bill (lags a few hours)</small><div class="wrap"><table><tr><th>Key</th><th>Today</th><th>Last 7 days</th><th>Last 30 days</th><th>Last used</th></tr>
${keys.map(k => `<tr><td>${esc(k.key)}</td><td class="n">${money(k.today)}</td><td class="n">${money(k.week)}</td><td class="n">${money(k.month)}</td><td class="muted">${esc(k.last)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No key figures yet: ai-cost-billed.yml sends them every 6 hours (ANTHROPIC_ADMIN_KEY).</td></tr>'}
</table></div></section>
<section class="card"><h2>⚙️ By job</h2><div class="wrap"><table><tr><th>Job</th><th>Group</th><th>Runs</th><th>Calls</th><th>Cost</th><th>Per run</th><th>Last run (UTC)</th></tr>
${s.jobs.map(job => `<tr><td>${esc((JOBS[job.job] || [job.job])[0])}</td><td class="muted">${esc((JOBS[job.job] || [])[1] || 'Other')}</td><td class="n">${job.runs}</td><td class="n">${job.calls}</td><td class="n">${money(job.usd)}</td><td class="n">$${(job.usd / job.runs).toFixed(3)}</td><td class="muted">${esc(job.last.slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td></td><td class="n">${s.runs}</td><td class="n">${s.jobs.reduce((sum, job) => sum + job.calls, 0)}</td><td class="n">${money(s.total)}</td><td></td><td></td></tr>
</table></div>
<small class="muted">Not counted: the users' Always-on runs (their own keys), and any job that does not report. A growing gap between Jobs and Billed means a job is missing.</small></section>
</main></body></html>`;
}

// PUT /ai-cost/data (Bearer AI_COST_PUBLISH_KEY): {runs: [{job, run_id, at, usd, calls?, repo?, provider?: anthropic|openai}], billed: [{day, usd}], keys: [{day, key, usd}]}. Checked: key, size, shape; ids are slugs.
export async function ingest(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.AI_COST_PUBLISH_KEY && equal(given, env.AI_COST_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 100000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  const runs = Array.isArray(data?.runs) ? data.runs : [], billed = Array.isArray(data?.billed) ? data.billed : [], keys = Array.isArray(data?.keys) ? data.keys : [];
  const slug = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  const goodRun = run => (run?.provider === undefined || run.provider in PROVIDERS) && slug.test(String(run?.job)) && /^[A-Za-z0-9._-]{1,64}$/.test(String(run?.run_id)) && /^\d{4}-\d{2}-\d{2}T/.test(String(run?.at)) && Number.isFinite(run?.usd) && run.usd >= 0 && run.usd < 1000;
  const goodDay = item => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.day)) && Number.isFinite(item?.usd) && item.usd >= 0 && item.usd < 100000;
  const goodKey = item => goodDay(item) && slug.test(String(item?.key).toLowerCase()) && String(item.key).length <= 64 && !/^sk-/i.test(String(item.key));   // a key's NAME, never the key itself
  if (!runs.length && !billed.length && !keys.length) return new Response('Nothing to record', {status: 400});
  if (!runs.every(goodRun) || !billed.every(goodDay) || !keys.every(goodKey) || runs.length > 200 || billed.length > 100 || keys.length > 400) return new Response('Unexpected shape', {status: 400});
  const statements = [
    ...runs.map(run => env.STATS.prepare('INSERT OR REPLACE INTO ai_cost_runs (job, run_id, day, at, usd, calls, repo, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(run.job, String(run.run_id), day(run.at), run.at, run.usd, Math.max(0, Math.round(Number(run.calls) || 0)), String(run.repo || '').slice(0, 80), run.provider || 'anthropic')),
    ...billed.map(item => env.STATS.prepare('INSERT OR REPLACE INTO ai_cost_billed (day, usd, at) VALUES (?, ?, ?)').bind(item.day, item.usd, new Date().toISOString())),
    ...keys.map(item => env.STATS.prepare('INSERT OR REPLACE INTO ai_cost_keys (day, key, usd, at) VALUES (?, ?, ?, ?)').bind(item.day, String(item.key), item.usd, new Date().toISOString())),
  ];
  await env.STATS.batch(statements);
  return new Response(JSON.stringify({ok: true, runs: runs.length, billed: billed.length, keys: keys.length}), {headers: {'Content-Type': 'application/json'}});
}

// GET /ai-cost/data?day=YYYY-MM-DD&prefix=e2e- (Bearer AI_COST_PUBLISH_KEY): what the jobs whose id starts with `prefix` reported that day (UTC), for a budget
// guard in CI (desktop/e2e/ai-spend.mjs: a day's e2e spend over its budget skips the paid judge and the screenshot review; owner, 7 Oct 2026: "$30 a week"). -> {day, prefix, usd, runs}
export async function spent(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.AI_COST_PUBLISH_KEY && equal(given, env.AI_COST_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  const asked = url.searchParams.get('day') || new Date().toISOString().slice(0, 10), prefix = url.searchParams.get('prefix') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked) || !/^[a-z0-9._-]{0,32}$/.test(prefix)) return new Response('Bad request', {status: 400});
  const row = env.STATS ? await env.STATS.prepare('SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS runs FROM ai_cost_runs WHERE day = ? AND job LIKE ?')
    .bind(asked, `${prefix}%`).first().catch(() => null) : null;
  return new Response(JSON.stringify({day: asked, prefix, usd: Math.round((Number(row?.usd) || 0) * 10000) / 10000, runs: Number(row?.runs) || 0}),
    {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}

// The day measuring starts (wrangler.toml AI_COST_SINCE, YYYY-MM-DD): rows before it stay in the database but are not counted.
// 8 Oct 2026: every product key was replaced by a new one in its own workspace, so the figures start fresh from that day.
export const since = env => (/^\d{4}-\d{2}-\d{2}$/.test(String(env?.AI_COST_SINCE || '')) ? String(env.AI_COST_SINCE) : '');

export async function read(env) {
  try {
    const window = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10), from = since(env) > window ? since(env) : window;
    const runs = (await env.STATS.prepare('SELECT job, run_id, day, at, usd, calls, provider FROM ai_cost_runs WHERE day >= ?').bind(from).all()
      .catch(() => env.STATS.prepare('SELECT job, run_id, day, at, usd, calls FROM ai_cost_runs WHERE day >= ?').bind(from).all())).results || [];   // before migration 0043: no provider
    const billed = (await env.STATS.prepare('SELECT day, usd FROM ai_cost_billed WHERE day >= ?').bind(from).all()).results || [];
    const keys = await env.STATS.prepare('SELECT day, key, usd FROM ai_cost_keys WHERE day >= ?').bind(from).all().then(r => r.results || []).catch(() => []);   // before migration 0036: none
    return {runs, billed, keys};
  } catch { return {runs: [], billed: [], keys: []}; }
}

// GET /ai-cost (?key=<STATS_KEY> once; the cookie after that)
export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const {runs, billed, keys} = env.STATS ? await read(env) : {runs: [], billed: [], keys: []};
  return new Response(page(runs, billed, keys, since(env)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
