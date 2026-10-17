// /admin/operations/overview: where our engineering time goes (owner, 15 Oct 2026). CI (ops-overview.yml, on every push to main and hourly) sends each NEW merged PR once
// (PUT /ops/data, Bearer SELFHEAL_PUBLISH_KEY; GET lists the numbers already stored, so CI looks up a PR's runs only once); the site keeps one row per PR (ops_prs) and, after each
// write, ONE snapshot row (ops_snapshot) with the last 30 days per day and category plus the latest 20 PRs. The page reads that one row: no table scan per load (D1 free plan).
// Categories: src/ops-categories.js. No AI. Guard: test/ops-overview.test.js.
import {viewer} from './auth.js';
import {equal} from './guard.js';
import {esc, remember} from './stats.js';
import {CATEGORIES, CATEGORY_IDS} from './ops-categories.js';
import {filterLinks} from './admin.js';
import {BARS_CSS, barRows, legend} from './day-bars.js';
import {groupOf, sectionTiles, tilesHtml} from './section-overview.js';

const HOUR = 3600000, DAY = 24 * HOUR, KEEP_DAYS = 30, LATEST = 20;
const dayOf = date => date.toISOString().slice(0, 10);
// The page-wide range (?range=24h|7d|30d, default 7d): `n` buckets back from now, `unit` = the bucket (hour or day).
export const RANGES = {'24h': {name: 'Last 24 hours', n: 24, unit: 'hour'}, '7d': {name: 'Last 7 days', n: 7, unit: 'day'}, '30d': {name: 'Last 30 days', n: 30, unit: 'day'}};
export const rangeOf = value => (RANGES[value] ? value : '7d');
const hourOf = date => date.toISOString().slice(0, 13);

function authorized(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(env.SELFHEAL_PUBLISH_KEY && equal(given, env.SELFHEAL_PUBLISH_KEY));
}

// The snapshot from the stored rows: the last 30 days grouped by day and category (≤ ~1500 rows read, once per write, never per page load).
export async function buildSnapshot(db, now = new Date()) {
  const from = dayOf(new Date(now.getTime() - (KEEP_DAYS - 1) * DAY));
  const fromHour = hourOf(new Date(now.getTime() - 47 * HOUR));
  const [{results: daily = []}, {results: hourly = []}, {results: latest = []}] = await Promise.all([
    db.prepare('SELECT day, category, COUNT(*) AS prs, SUM(lines) AS lines, SUM(hours) AS hours, SUM(ci_min) AS ci FROM ops_prs WHERE day >= ? GROUP BY day, category').bind(from).all(),
    db.prepare('SELECT substr(merged_at, 1, 13) AS hour, category, COUNT(*) AS prs, SUM(lines) AS lines, SUM(hours) AS hours, SUM(ci_min) AS ci FROM ops_prs WHERE substr(merged_at, 1, 13) >= ? GROUP BY hour, category').bind(fromHour).all(),
    db.prepare('SELECT number, title, category, mixed, lines, hours, ci_min AS ci, merged_at AS mergedAt FROM ops_prs ORDER BY merged_at DESC LIMIT ?').bind(LATEST).all()]);
  return {schema: 2, at: now.toISOString(), daily: daily.map(row => ({...row})), hourly: hourly.map(row => ({...row})), latest: latest.map(row => ({...row}))};
}

const clean = pr => Number.isInteger(pr?.number) && pr.number > 0 && /^\d{4}-\d{2}-\d{2}T/.test(pr.mergedAt || '') && CATEGORY_IDS.includes(pr.category);
// PUT /ops/data {rules, prs: [row]}: each PR once per rules version (src/ops-categories.js RULES_VERSION: a rule change re-reads the stored PRs, a repeat at the same version is ignored); then the snapshot is rebuilt.
// GET /ops/data?v=N: the numbers stored for the last 35 days at rules version N or newer (CI reads only the rest).
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  const json = body => new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json'}});
  if (request.method === 'GET') {
    const version = Number(new URL(request.url).searchParams.get('v')) || 0;
    const {results = []} = await env.STATS.prepare('SELECT number FROM ops_prs WHERE day >= ? AND rules >= ?').bind(dayOf(new Date(now.getTime() - 35 * DAY)), version).all();
    return json({have: results.map(row => row.number)});
  }
  const text = await request.text();
  if (text.length > 400000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(text); } catch { return new Response('Not JSON', {status: 400}); }
  if (!Array.isArray(data?.prs) || data.prs.length > 500) return new Response('Unexpected shape', {status: 400});
  const rows = data.prs.filter(clean);
  const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const rules = Math.max(1, Number(data.rules) || 1);
  const write = env.STATS.prepare(`INSERT INTO ops_prs (number, day, merged_at, category, mixed, lines, hours, ci_min, title, rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(number) DO UPDATE SET category = excluded.category, mixed = excluded.mixed, lines = excluded.lines, hours = excluded.hours, ci_min = excluded.ci_min, rules = excluded.rules WHERE excluded.rules > ops_prs.rules`);
  if (rows.length) await env.STATS.batch(rows.map(pr => write.bind(pr.number, pr.mergedAt.slice(0, 10), pr.mergedAt, pr.category, pr.mixed ? 1 : 0, num(pr.lines), num(pr.hours), num(pr.ciMinutes), String(pr.title || '').slice(0, 120), rules)));
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The buckets of a range, newest first: [{key, label, title}]. Days: every day; hours: the last 24 (UTC).
export function bucketsOf(range, now = new Date()) {
  const {n, unit} = RANGES[rangeOf(range)], step = unit === 'hour' ? HOUR : DAY;
  return Array.from({length: n}, (_, i) => {
    const date = new Date(now.getTime() - i * step), key = unit === 'hour' ? hourOf(date) : dayOf(date);
    const [, month, dd] = dayOf(date).split('-'), words = `${Number(dd)} ${MONTHS[Number(month) - 1]}`;
    return {key, label: unit === 'hour' ? `${words} ${key.slice(11)}:00` : words, title: unit === 'hour' ? `${words} ${key.slice(11)}:00 UTC` : dayOf(date)};
  });
}
const rowsOf = (snapshot, range) => (RANGES[rangeOf(range)].unit === 'hour' ? (snapshot?.hourly || []).map(row => ({...row, key: row.hour})) : (snapshot?.daily || []).map(row => ({...row, key: row.day})));

// Per category over the range: prs, lines, hours (summed), ci minutes.
export function windowOf(snapshot, range, now = new Date()) {
  const keys = new Set(bucketsOf(range, now).map(bucket => bucket.key));
  const out = Object.fromEntries(CATEGORY_IDS.map(id => [id, {prs: 0, lines: 0, hours: 0, ci: 0}]));
  for (const row of rowsOf(snapshot, range)) { const cell = keys.has(row.key) && out[row.category]; if (cell) { cell.prs += row.prs || 0; cell.lines += row.lines || 0; cell.hours += row.hours || 0; cell.ci += row.ci || 0; } }
  return out;
}
const totalOf = byCategory => Object.values(byCategory).reduce((sum, cell) => ({prs: sum.prs + cell.prs, lines: sum.lines + cell.lines, hours: sum.hours + cell.hours, ci: sum.ci + cell.ci}), {prs: 0, lines: 0, hours: 0, ci: 0});

function tiles(snapshot, range, now) {
  const w = windowOf(snapshot, range, now), total = totalOf(w), top = CATEGORIES.filter(category => w[category.id].prs).sort((a, b) => w[b.id].prs - w[a.id].prs)[0];
  return `<div class="tiles"><section class="card tile"><span class="muted">Form fixes</span><b>${pct(w.forms.prs, total.prs)}</b><span class="muted">${num(w.forms.prs)} of ${num(total.prs)} merged PRs changed how forms are filled</span></section>
<section class="card tile"><span class="muted">Merged PRs</span><b>${num(total.prs)}</b><span class="muted">${top ? `most: ${esc(top.label)} (${num(w[top.id].prs)})` : 'none in this range'}</span></section>
<section class="card tile"><span class="muted">Open→merge</span><b>${one(total.prs ? total.hours / total.prs : 0)} h</b><span class="muted">average over ${num(total.lines)} lines changed</span></section></div>`;
}

function table(snapshot, range, now) {
  const w = windowOf(snapshot, range, now), total = totalOf(w);
  const rows = CATEGORIES.filter(category => w[category.id].prs).sort((a, b) => w[b.id].prs - w[a.id].prs).map(category => {
    const cell = w[category.id];
    return `<tr><td>${swatch(category.id)}${esc(category.label)}<div class="muted small">${esc(category.hint)}</div></td><td class="num">${num(cell.prs)}</td><td class="num">${pct(cell.prs, total.prs)}</td><td class="num">${num(cell.lines)}</td>
<td class="num">${one(cell.prs ? cell.hours / cell.prs : 0)}</td><td class="num">${one(cell.ci)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No merged PRs in this period.</td></tr>';
  const foot = total.prs ? `<tr class="total"><td>All</td><td class="num">${num(total.prs)}</td><td class="num">100%</td><td class="num">${num(total.lines)}</td><td class="num">${one(total.hours / total.prs)}</td><td class="num">${one(total.ci)}</td></tr>` : '';
  return `<table><tr><th>Category</th><th class="num">PRs</th><th class="num">Share</th><th class="num">Lines changed</th><th class="num">Open→merge, avg h</th><th class="num">CI minutes</th></tr>${rows}${foot}</table>`;
}

// One horizontal stacked row per bucket (a day, or an hour for the 24-hour range), newest first; empty hours are left out (24 mostly empty rows read badly), empty days stay.
export function bars(snapshot, range = '7d', now = new Date()) {
  const rows = rowsOf(snapshot, range), unit = RANGES[rangeOf(range)].unit;
  const list = bucketsOf(range, now).map(bucket => ({...bucket, counts: Object.fromEntries(CATEGORY_IDS.map(id => [id, rows.find(row => row.key === bucket.key && row.category === id)?.prs || 0]))}))
    .filter(row => unit === 'day' || Object.values(row.counts).some(Boolean));
  if (!list.length) return '<p class="muted">No merged PRs in this range.</p>';
  const summary = (row, total) => { const top = CATEGORIES.reduce((best, category) => (row.counts[category.id] > (row.counts[best.id] || 0) ? category : best), CATEGORIES[0]);
    return total ? `${total} ${total === 1 ? 'PR' : 'PRs'} · top: ${top.label}` : 'none'; };
  return `${legend(CATEGORIES)}${barRows(CATEGORIES, list, summary)}`;
}

export function page(snapshot, {range = '7d', repo = 'GarryOne/job-pilotto', now = new Date(), lead = ''} = {}) {
  range = rangeOf(range);
  const filters = filterLinks(Object.entries(RANGES).map(([value, {name}]) => [value, name, `?range=${value}`]), range), name = RANGES[range].name;
  const body = !snapshot ? `<section class="card"><h2>No data yet</h2><p class="muted">The workflow <code>ops-overview.yml</code> publishes the merged PRs on every push to main and hourly; the first run fills this page.</p></section>`
    : `${filters}${tiles(snapshot, range, now)}
<section class="card"><h2>By category · ${esc(name)}</h2>${table(snapshot, range, now)}</section>
<section class="card nights${RANGES[range].unit === 'hour' ? ' hourly' : ''}"><h2>Merged PRs per ${RANGES[range].unit} · ${esc(name.toLowerCase())}</h2>${bars(snapshot, range, now)}</section>
<section class="card"><h2>Latest ${LATEST} merged PRs</h2><table><tr><th>PR</th><th>Category</th><th class="num">Lines</th><th class="num">Open→merge h</th></tr>${(snapshot.latest || []).map(pr =>
  `<tr><td><a href="https://github.com/${esc(repo)}/pull/${Number(pr.number)}">#${Number(pr.number)}</a> ${esc(pr.title)}</td><td class="nowrap">${swatch(pr.category)}${esc(label(pr.category))}</td><td class="num">${num(pr.lines)}</td><td class="num">${one(pr.hours)}</td></tr>`).join('')
  || '<tr><td colspan="4" class="muted">No merged PRs yet.</td></tr>'}</table></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Overview · Operations · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:30px;margin:4px 0}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}.small{font-size:12px;margin-left:18px}
.filters{margin:8px 0 16px}tr.total td{font-weight:700}h2{margin:0}.hourly .night{grid-template-columns:112px minmax(0,1fr) 240px}.hourly .night b{white-space:nowrap}@media (max-width:640px){.hourly .night{grid-template-columns:112px minmax(0,1fr)}}${BARS_CSS}</style></head><body><main>
<header><h1>⏱️ Overview</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · merged PRs, by what they change` : ''}</span></header>
${lead}${snapshot ? '<h2 style="margin:8px 0 12px">⏱️ Where our time goes</h2>' : ''}${body}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM ops_snapshot WHERE id = 1').first() : null; snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  const range = rangeOf(url.searchParams.get('range'));
  const lead = tilesHtml(await sectionTiles(env, groupOf('/admin/operations/overview')));
  return new Response(page(snapshot, {range, repo: env.GITHUB_REPO || undefined, lead}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
