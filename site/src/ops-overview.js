// /admin/operations/overview: where our engineering time goes (owner, 15 Oct 2026). CI (ops-overview.yml, on every push to main and hourly) sends each NEW merged PR once
// (PUT /ops/data, Bearer SELFHEAL_PUBLISH_KEY; GET lists the numbers already stored, so CI looks up a PR's runs only once); the site keeps one row per PR (ops_prs) and, after each
// write, ONE snapshot row (ops_snapshot) with the last 30 days per day and category plus the latest 20 PRs. The page reads that one row: no table scan per load (D1 free plan).
// Categories: src/ops-categories.js. No AI. Guard: test/ops-overview.test.js.
import {viewer} from './auth.js';
import {equal} from './guard.js';
import {esc, remember} from './stats.js';
import {CATEGORIES, CATEGORY_IDS} from './ops-categories.js';
import {filterLinks} from './admin.js';

const DAY = 86400000, KEEP_DAYS = 30, LATEST = 20, BAR_DAYS = 14;
const dayOf = date => date.toISOString().slice(0, 10);
const PERIODS = [['1', 'Today'], ['7', '7 days'], ['30', '30 days']];

function authorized(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(env.SELFHEAL_PUBLISH_KEY && equal(given, env.SELFHEAL_PUBLISH_KEY));
}

// The snapshot from the stored rows: the last 30 days grouped by day and category (≤ ~1500 rows read, once per write, never per page load).
export async function buildSnapshot(db, now = new Date()) {
  const from = dayOf(new Date(now.getTime() - (KEEP_DAYS - 1) * DAY));
  const [{results: daily = []}, {results: latest = []}] = await Promise.all([
    db.prepare('SELECT day, category, COUNT(*) AS prs, SUM(lines) AS lines, SUM(hours) AS hours, SUM(ci_min) AS ci FROM ops_prs WHERE day >= ? GROUP BY day, category').bind(from).all(),
    db.prepare('SELECT number, title, category, mixed, lines, hours, ci_min AS ci, merged_at AS mergedAt FROM ops_prs ORDER BY merged_at DESC LIMIT ?').bind(LATEST).all()]);
  return {schema: 1, at: now.toISOString(), daily: daily.map(row => ({...row})), latest: latest.map(row => ({...row}))};
}

const clean = pr => Number.isInteger(pr?.number) && pr.number > 0 && /^\d{4}-\d{2}-\d{2}T/.test(pr.mergedAt || '') && CATEGORY_IDS.includes(pr.category);
// PUT /ops/data {prs: [row]}: each PR once (a repeat is ignored); then the snapshot is rebuilt. GET /ops/data: the numbers stored for the last 35 days.
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  const json = body => new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json'}});
  if (request.method === 'GET') {
    const {results = []} = await env.STATS.prepare('SELECT number FROM ops_prs WHERE day >= ?').bind(dayOf(new Date(now.getTime() - 35 * DAY))).all();
    return json({have: results.map(row => row.number)});
  }
  const text = await request.text();
  if (text.length > 400000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(text); } catch { return new Response('Not JSON', {status: 400}); }
  if (!Array.isArray(data?.prs) || data.prs.length > 500) return new Response('Unexpected shape', {status: 400});
  const rows = data.prs.filter(clean);
  const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const write = env.STATS.prepare('INSERT OR IGNORE INTO ops_prs (number, day, merged_at, category, mixed, lines, hours, ci_min, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  if (rows.length) await env.STATS.batch(rows.map(pr => write.bind(pr.number, pr.mergedAt.slice(0, 10), pr.mergedAt, pr.category, pr.mixed ? 1 : 0, num(pr.lines), num(pr.hours), num(pr.ciMinutes), String(pr.title || '').slice(0, 120))));
  const snapshot = await buildSnapshot(env.STATS, now);
  await env.STATS.prepare('INSERT INTO ops_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return json({ok: true, stored: rows.length, ignored: data.prs.length - rows.length});
}

// ---- the page ----
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const one = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 1});
const label = id => CATEGORIES.find(category => category.id === id)?.label || id;
const swatch = id => `<span class="sw" style="background:${CATEGORIES.find(category => category.id === id)?.color || '#8d949c'}"></span>`;

// Per category over the last `days` days (1 = today): prs, lines, hours (summed), ci minutes.
export function windowOf(snapshot, days, now = new Date()) {
  const from = dayOf(new Date(now.getTime() - (days - 1) * DAY)), rows = (snapshot?.daily || []).filter(row => row.day >= from);
  const out = Object.fromEntries(CATEGORY_IDS.map(id => [id, {prs: 0, lines: 0, hours: 0, ci: 0}]));
  for (const row of rows) { const cell = out[row.category]; if (cell) { cell.prs += row.prs || 0; cell.lines += row.lines || 0; cell.hours += row.hours || 0; cell.ci += row.ci || 0; } }
  return out;
}
const totalOf = byCategory => Object.values(byCategory).reduce((sum, cell) => ({prs: sum.prs + cell.prs, lines: sum.lines + cell.lines, hours: sum.hours + cell.hours, ci: sum.ci + cell.ci}), {prs: 0, lines: 0, hours: 0, ci: 0});

function tiles(snapshot, now) {
  return `<div class="tiles">${PERIODS.map(([days, name]) => {
    const w = windowOf(snapshot, Number(days), now), total = totalOf(w);
    return `<section class="card tile"><span class="muted">${name}</span><b>${pct(w.forms.prs, total.prs)}</b><span class="muted">${num(w.forms.prs)} of ${num(total.prs)} merged PRs changed how forms are filled</span></section>`;
  }).join('')}</div>`;
}

function table(snapshot, days, now) {
  const w = windowOf(snapshot, days, now), total = totalOf(w);
  const rows = CATEGORIES.filter(category => w[category.id].prs).sort((a, b) => w[b.id].prs - w[a.id].prs).map(category => {
    const cell = w[category.id];
    return `<tr><td>${swatch(category.id)}${esc(category.label)}<div class="muted small">${esc(category.hint)}</div></td><td class="num">${num(cell.prs)}</td><td class="num">${pct(cell.prs, total.prs)}</td><td class="num">${num(cell.lines)}</td>
<td class="num">${one(cell.prs ? cell.hours / cell.prs : 0)}</td><td class="num">${one(cell.ci)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No merged PRs in this period.</td></tr>';
  const foot = total.prs ? `<tr class="total"><td>All</td><td class="num">${num(total.prs)}</td><td class="num">100%</td><td class="num">${num(total.lines)}</td><td class="num">${one(total.hours / total.prs)}</td><td class="num">${one(total.ci)}</td></tr>` : '';
  return `<table><tr><th>Category</th><th class="num">PRs</th><th class="num">Share</th><th class="num">Lines changed</th><th class="num">Open→merge, avg h</th><th class="num">CI minutes</th></tr>${rows}${foot}</table>`;
}

// The last 14 days, one stacked bar per day (PRs by category).
export function bars(snapshot, now = new Date()) {
  const days = Array.from({length: BAR_DAYS}, (_, i) => dayOf(new Date(now.getTime() - (BAR_DAYS - 1 - i) * DAY)));
  const per = days.map(day => Object.fromEntries(CATEGORY_IDS.map(id => [id, (snapshot?.daily || []).find(row => row.day === day && row.category === id)?.prs || 0])));
  const max = Math.max(1, ...per.map(counts => Object.values(counts).reduce((a, b) => a + b, 0)));
  const W = 1000, H = 170, gap = 8, bw = (W - gap * (BAR_DAYS - 1)) / BAR_DAYS, plot = H - 22;
  const shapes = per.map((counts, i) => {
    let y = plot;
    const x = i * (bw + gap), total = Object.values(counts).reduce((a, b) => a + b, 0);
    const parts = CATEGORIES.filter(category => counts[category.id]).map(category => {
      const h = (counts[category.id] / max) * (plot - 14); y -= h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${category.color}"><title>${esc(days[i])} · ${esc(category.label)}: ${counts[category.id]} PRs</title></rect>`;
    }).join('');
    return `${parts}${total ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" fill="#8d949c" font-size="11">${total}</text>` : ''}<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#8d949c" font-size="11">${days[i].slice(5)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Merged PRs per day, by category, last ${BAR_DAYS} days">${shapes}</svg>`;
}

export function page(snapshot, {days = 7, repo = 'GarryOne/job-pilotto', now = new Date()} = {}) {
  const period = PERIODS.find(([value]) => Number(value) === days) || PERIODS[1];
  const filters = filterLinks(PERIODS.map(([value, name]) => [value, name, `?days=${value}`]), period[0]);
  const body = !snapshot ? `<section class="card"><h2>No data yet</h2><p class="muted">The workflow <code>ops-overview.yml</code> publishes the merged PRs on every push to main and hourly; the first run fills this page.</p></section>`
    : `${tiles(snapshot, now)}
<section class="card"><h2>By category · ${esc(period[1])}</h2>${filters}${table(snapshot, Number(period[0]), now)}</section>
<section class="card"><h2>Merged PRs per day · last ${BAR_DAYS} days</h2><p class="legend">${CATEGORIES.map(category => `<span>${swatch(category.id)}${esc(category.label)}</span>`).join('')}</p>${bars(snapshot, now)}</section>
<section class="card"><h2>Latest ${LATEST} merged PRs</h2><table><tr><th>PR</th><th>Category</th><th class="num">Lines</th><th class="num">Open→merge h</th></tr>${(snapshot.latest || []).map(pr =>
  `<tr><td><a href="https://github.com/${esc(repo)}/pull/${Number(pr.number)}">#${Number(pr.number)}</a> ${esc(pr.title)}</td><td class="nowrap">${swatch(pr.category)}${esc(label(pr.category))}</td><td class="num">${num(pr.lines)}</td><td class="num">${one(pr.hours)}</td></tr>`).join('')
  || '<tr><td colspan="4" class="muted">No merged PRs yet.</td></tr>'}</table></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Overview · Operations · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:30px;margin:4px 0}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}.small{font-size:12px;margin-left:18px}.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:#8d949c;margin:8px 0}
.filters{margin:8px 0}tr.total td{font-weight:700}h2{margin:0}</style></head><body><main>
<header><h1>⏱️ Where our time goes</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · merged PRs, by what they change` : ''}</span></header>
${body}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM ops_snapshot WHERE id = 1').first() : null; snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  const days = Number(url.searchParams.get('days')) || 7;
  return new Response(page(snapshot, {days, repo: env.GITHUB_REPO || undefined}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
