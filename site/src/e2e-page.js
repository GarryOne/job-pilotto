// /admin/operations/e2e: where our e2e fixing time goes (owner, 18 Oct 2026; replaces the dropped /admin/e2e runs page). Draws the ONE snapshot row src/e2e-intel.js keeps: finished release/beta runs, which suites
// went red, and why (facts, src/e2e-causes.js). No AI, no table scan. Guard: test/e2e-page.test.js.
import {viewer} from './auth.js';
import {esc, remember} from './stats.js';
import {CAUSES, CAUSE_IDS} from './e2e-causes.js';
import {filterLinks} from './admin.js';
import {BARS_CSS, barRows, legend} from './day-bars.js';

const DAY = 86400000;
export const RANGES = {'7d': {name: 'Last 7 days', days: 7}, '30d': {name: 'Last 30 days', days: 30}};
export const rangeOf = value => (RANGES[value] ? value : '7d');
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const hours = minutes => `${((Number(minutes) || 0) / 60).toLocaleString('en-US', {maximumFractionDigits: 1})} h`;
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const swatch = id => `<span class="sw" style="background:${CAUSES.find(cause => cause.id === id)?.color || '#8d949c'}"></span>`;
const label = id => CAUSES.find(cause => cause.id === id)?.label || id;

// The rows of the range: days from `now` back, as the YYYY-MM-DD keys they are stored under.
export function windowOf(snapshot, range, now = new Date()) {
  const keys = new Set(Array.from({length: RANGES[rangeOf(range)].days}, (_, i) => new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)));
  const days = (snapshot?.days || []).filter(row => keys.has(row.day)), fails = (snapshot?.fails || []).filter(row => keys.has(row.day));
  const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const reds = sum(fails, 'n'), byCause = Object.fromEntries(CAUSE_IDS.map(id => [id, sum(fails.filter(row => row.cause === id), 'n')]));
  return {keys: [...keys], days, fails, runs: sum(days, 'runs'), redRuns: sum(days, 'reds'), greenRuns: sum(days, 'greens'), redMin: sum(days, 'redMin'), reds, byCause, failMin: sum(fails, 'min')};
}

function tiles(w) {
  const top = CAUSES.filter(cause => w.byCause[cause.id]).sort((a, b) => w.byCause[b.id] - w.byCause[a.id])[0];
  return `<div class="tiles"><section class="card tile"><span class="muted">Red runs</span><b>${pct(w.redRuns, w.runs)}</b><span class="muted">${num(w.redRuns)} of ${num(w.runs)} finished runs ended red</span></section>
<section class="card tile"><span class="muted">Time in red runs</span><b>${hours(w.redMin)}</b><span class="muted">wall time of the runs that ended red</span></section>
<section class="card tile"><span class="muted">Flakes</span><b>${pct(w.byCause.flake, w.reds)}</b><span class="muted">${num(w.byCause.flake)} of ${num(w.reds)} red suites passed on the second try</span></section>
<section class="card tile"><span class="muted">Top cause</span><b>${top ? esc(top.label) : '–'}</b><span class="muted">${top ? `${num(w.byCause[top.id])} red suites` : 'no red suites in this range'}</span></section></div>`;
}

// Per suite and platform: red count, minutes, and the causes as chips, the most expensive first.
export function suiteRows(w) {
  const rows = new Map();
  for (const fail of w.fails) {
    const key = `${fail.suite}|${fail.platform}`, row = rows.get(key) || {suite: fail.suite, platform: fail.platform, n: 0, min: 0, causes: {}};
    row.n += fail.n; row.min += fail.min || 0; row.causes[fail.cause] = (row.causes[fail.cause] || 0) + fail.n; rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.min - a.min || b.n - a.n || a.suite.localeCompare(b.suite));
}
function suiteTable(w) {
  const rows = suiteRows(w).map(row => `<tr><td><code>${esc(row.suite)}</code></td><td>${row.platform === 'windows' ? 'Windows' : 'Mac + Linux'}</td><td class="num">${num(row.n)}</td><td class="num">${hours(row.min)}</td>
<td>${CAUSES.filter(cause => row.causes[cause.id]).map(cause => `<span class="chip">${swatch(cause.id)}${esc(cause.label)} ${row.causes[cause.id]}</span>`).join(' ')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No red suites in this period.</td></tr>';
  return `<div class="scroll"><table><tr><th>Suite</th><th>Platform</th><th class="num">Red</th><th class="num">Job time</th><th>Why</th></tr>${rows}</table></div>`;
}

// One stacked row per day, newest first: the red suites by cause. Days with no red suite say so.
export function bars(w) {
  const list = w.keys.slice().sort().reverse().filter(day => w.days.some(row => row.day === day)).map(day => ({label: dayWords(day), title: day, counts: Object.fromEntries(CAUSE_IDS.map(id => [id, w.fails.filter(row => row.day === day && row.cause === id).reduce((total, row) => total + row.n, 0)]))}));
  const summary = (row, total) => { const run = w.days.find(item => item.day === row.title); return total ? `${total} red ${total === 1 ? 'suite' : 'suites'}` : (run?.runs ? `${run.runs} ${run.runs === 1 ? 'run' : 'runs'}, all green` : 'no run'); };
  return `${legend(CAUSES)}${barRows(CAUSES, list, summary)}`;
}

export function page(snapshot, {range = '7d', repo = 'GarryOne/job-pilotto', now = new Date()} = {}) {
  range = rangeOf(range);
  const filters = filterLinks(Object.entries(RANGES).map(([value, {name}]) => [value, name, `?range=${value}`]), range), w = windowOf(snapshot, range, now), name = RANGES[range].name;
  const body = !snapshot ? `<section class="card"><h2>No data yet</h2><p class="muted">The workflow <code>e2e-intel.yml</code> publishes every finished release run when it ends and hourly; the first run fills this page.</p></section>`
    : `${filters}${tiles(w)}
<section class="card"><h2>Red suites per day, by cause · ${esc(name)}</h2>${w.reds ? bars(w) : '<p class="muted">No red suites in this range.</p>'}</section>
<section class="card"><h2>Which suites cost the most · ${esc(name)}</h2>${suiteTable(w)}</section>
<section class="card"><h2>What each cause means</h2><table>${CAUSES.map(cause => `<tr><td class="nowrap">${swatch(cause.id)}${esc(cause.label)}</td><td class="muted">${esc(cause.hint)}</td></tr>`).join('')}</table></section>
<section class="card"><h2>Latest ${(snapshot.latest || []).length} runs</h2><div class="scroll"><table><tr><th>Run</th><th>Day</th><th>Kind</th><th>Result</th><th class="num">Minutes</th></tr>${(snapshot.latest || []).map(run =>
  `<tr><td><a href="https://github.com/${esc(repo)}/actions/runs/${Number(run.runId)}">#${Number(run.runId)}</a></td><td>${esc(run.day)}</td><td>${esc(run.kind)}</td><td>${run.conclusion === 'failure' ? '🔴 red' : '🟢 green'}</td><td class="num">${num(run.minutes)}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">No runs yet.</td></tr>'}</table></div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>E2E · Operations · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:28px;margin:4px 0}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}.chip{display:inline-block;border:1px solid #2a2f37;border-radius:999px;padding:1px 9px;font-size:12px;white-space:nowrap}
.filters{margin:8px 0 16px}h2{margin:0 0 8px}.scroll{overflow-x:auto}.nights .night span.muted{white-space:nowrap}${BARS_CSS}</style></head><body><main>
<header><h1>🧪 Where e2e time goes</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · finished release and beta runs` : ''}</span></header>
${body}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').first() : null; snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  return new Response(page(snapshot, {range: rangeOf(url.searchParams.get('range')), repo: env.GITHUB_REPO || undefined}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
