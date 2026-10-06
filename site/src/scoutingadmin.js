// /admin/scouting: is the central employer list, the product's own asset, growing, and where is it weak? (owner, 6 Oct 2026; spec
// docs/superpowers/specs/2026-10-06-central-employer-learning.md). Read straight from the site's database: the published index (index_feeds,
// with each feed's role mix and freshness), the daily snapshots (index_daily), what installs share (contributions, nofeed) and the central
// scout's own nightly numbers (scout_stats). Counts, company names and job-site addresses only: nothing about any user.
import {viewer} from './auth.js';
import {load as loadScouting, section as nightly} from './scouting.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
const n = value => Number(value || 0).toLocaleString('en-US');
const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '—');
const day = (date, back = 0) => new Date(date.getTime() - back * 86400000).toISOString().slice(0, 10);
const rows = (list, cells, empty) => list.length ? list.map(item => `<tr>${cells(item).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
  : `<tr><td colspan="9" class="muted">${esc(empty)}</td></tr>`;
const all = async (db, sql, ...args) => ((await db.prepare(sql).bind(...args).all().catch(() => ({results: []}))).results) || [];

// The kind a feed mostly hires for (its role mix), 'unknown' before the central scout has counted it.
export const topKind = feed => Object.entries(feed?.kinds || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

// The day's snapshot, from the list just published (employers.js publish): counts only.
export function snapshot(feeds, fromPool = 0, deadEnds = 0) {
  return {feeds: feeds.length, non_it: feeds.filter(feed => !['software', 'unknown'].includes(topKind(feed))).length,
    failing: feeds.filter(feed => (feed.fresh?.fails || 0) >= 3).length, from_pool: fromPool, dead_ends: deadEnds};
}
export async function storeSnapshot(db, date, snap) {
  await db.prepare(`INSERT INTO index_daily (day, feeds, non_it, failing, from_pool, dead_ends) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET feeds = excluded.feeds, non_it = excluded.non_it, failing = excluded.failing, from_pool = excluded.from_pool,
    dead_ends = excluded.dead_ends`).bind(date, snap.feeds, snap.non_it, snap.failing, snap.from_pool, snap.dead_ends).run();
}

export async function gather(db, now = new Date()) {
  const feeds = (await all(db, 'SELECT body FROM index_feeds')).map(row => { try { return JSON.parse(row.body); } catch { return null; } }).filter(Boolean);
  const daily = await all(db, 'SELECT * FROM index_daily ORDER BY day DESC LIMIT 30');
  const sharing = async back => (await all(db, 'SELECT COUNT(DISTINCT install) AS n FROM contributions WHERE day >= ?', day(now, back)))[0]?.n || 0;
  const shared = (await all(db, "SELECT COUNT(DISTINCT ats || ':' || slug) AS n FROM contributions"))[0]?.n || 0;
  const routes = await all(db, "SELECT how, COUNT(DISTINCT ats || ':' || slug) AS feeds, SUM(COALESCE(hits, 0)) AS hits FROM contributions WHERE how IS NOT NULL GROUP BY how ORDER BY feeds DESC");
  const useful = await all(db, `SELECT company, ats, slug, SUM(COALESCE(hits, 0)) AS hits, COUNT(*) AS installs, MAX(jobs) AS jobs, MAX(site) AS site, SUM(COALESCE(json_extract(out_json, '$.applied'), 0)) AS applied, SUM(COALESCE(json_extract(out_json, '$.interview'), 0)) AS interviews FROM contributions GROUP BY ats, slug ORDER BY interviews DESC, hits DESC, installs DESC LIMIT 15`);
  const dead = await all(db, 'SELECT company, host, COUNT(*) AS installs, MAX(day) AS last FROM nofeed GROUP BY key ORDER BY installs DESC, last DESC LIMIT 15');
  const deadTotal = (await all(db, 'SELECT COUNT(DISTINCT key) AS n FROM nofeed'))[0]?.n || 0;
  // Which job boards give matches for which kind of role (src/contribute.py boards, 7 Oct 2026); a missing table (before 0031) reads as none.
  const boards = await all(db, `SELECT board, roles, COUNT(*) AS installs, SUM(CASE WHEN hits > 0 THEN 1 ELSE 0 END) AS matched, SUM(COALESCE(hits, 0)) AS hits,
    SUM(COALESCE(dup, 0)) AS dup, SUM(COALESCE(json_extract(out_json, '$.interview'), 0)) AS interviews, SUM(failed) AS failed FROM board_reads GROUP BY board, roles ORDER BY hits DESC LIMIT 30`).catch(() => []);
  return {feeds, daily, boards, sharing7: await sharing(7), sharing30: await sharing(30), shared, routes, useful, dead, deadTotal, central: await loadScouting(db)};
}

export function page(data) {
  const {feeds} = data;
  const nonIt = feeds.filter(feed => !['software', 'unknown'].includes(topKind(feed))).length;
  const week = data.daily.find(row => row.day <= day(new Date(), 7));
  const growth = week ? feeds.length - week.feeds : null;
  const failing = feeds.filter(feed => (feed.fresh?.fails || 0) >= 3);
  const up = feeds.filter(feed => feed.fresh?.trend === 'up').length, down = feeds.filter(feed => feed.fresh?.trend === 'down').length;
  const emptyNow = feeds.filter(feed => feed.fresh && !feed.fresh.jobs).length;
  // Coverage: feeds by the kind they mostly hire for, and by region.
  const kinds = {}, grid = {};
  for (const feed of feeds) {
    const kind = topKind(feed);
    kinds[kind] = (kinds[kind] || 0) + 1;
    for (const region of feed.regions?.length ? feed.regions : ['unknown']) grid[`${kind}|${region}`] = (grid[`${kind}|${region}`] || 0) + 1;
  }
  const regions = [...new Set(Object.keys(grid).map(key => key.split('|')[1]))].sort();
  const verdict = !feeds.length ? 'No employer list published yet: the central scout publishes nightly (04:20 UTC).'
    : `${n(feeds.length)} employers in the central list${growth == null ? '' : `, ${growth >= 0 ? '+' : ''}${n(growth)} this week`}; `
      + `${n(data.sharing7)} install${data.sharing7 === 1 ? '' : 's'} sharing this week; ${pct(nonIt, feeds.length)} hire mostly outside IT.`;
  const kpi = (label, value, note = '') => `<div class="kpi"><b>${value}</b><span>${esc(label)}</span>${note ? `<small class="muted">${esc(note)}</small>` : ''}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Scouting · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
.card{padding:16px;margin-bottom:12px;min-width:0}td{padding:7px 4px;vertical-align:top;overflow-wrap:anywhere}th{padding:6px 4px}
.verdict{background:#1d1a12;border:1px solid #5a4620;border-radius:14px;padding:14px 16px;margin-bottom:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px}
.kpi{background:#14181d;border:1px solid #262c33;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}.kpi b{font-size:22px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
</style></head><body><main>
<header><div><h1>🛰️ Scouting</h1><small class="muted">The central employer list: counts, company names and job-site addresses only. <a href="/admin/insights">Insights →</a></small></div></header>
<div class="verdict">${esc(verdict)}</div>
<div class="kpis">${kpi('employers in the list', n(feeds.length))}${kpi('this week', growth == null ? '—' : `${growth >= 0 ? '+' : ''}${n(growth)}`, 'from the daily snapshots')}
${kpi('installs sharing', `${n(data.sharing7)} / ${n(data.sharing30)}`, '7 / 30 days')}${kpi('outside IT', pct(nonIt, feeds.length), `${n(nonIt)} employers`)}
${kpi('failing reads', n(failing.length), '3+ failed in a row')}${kpi('dead ends', n(data.deadTotal), 'no readable job site, skipped 30 days')}</div>
<section class="card"><h2>📈 Growth</h2><small class="muted">One snapshot a day, when the central scout publishes. Starts on the day this page shipped.</small>
<table><tr><th>Day</th><th>Employers</th><th>Outside IT</th><th>Failing</th><th>From installs</th><th>Dead ends</th></tr>
${rows(data.daily, row => [esc(row.day), n(row.feeds), n(row.non_it), n(row.failing), n(row.from_pool), n(row.dead_ends)], 'No snapshot yet: the first comes with the next publish.')}</table></section>
<div class="grid2">
<section class="card"><h2>🤝 The pool</h2><small class="muted">What installs share (on unless switched off): every employer their scout verified and every feed and board their jobs check read, as it happens.</small>
<table><tr><td>Installs sharing, last 7 days</td><td>${n(data.sharing7)}</td></tr><tr><td>Installs sharing, last 30 days</td><td>${n(data.sharing30)}</td></tr>
<tr><td>Different employers shared (90 days)</td><td>${n(data.shared)}</td></tr></table></section>
<section class="card"><h2>🧭 Discovery routes that work</h2><small class="muted">How installs found the employers they share, and the jobs those matched for someone.</small>
<table><tr><th>Route</th><th>Employers</th><th>Jobs matched</th></tr>${rows(data.routes, row => [esc(row.how), n(row.feeds), n(row.hits)], 'Nothing shared with a route yet (share v2).')}</table></section>
</div>
<section class="card"><h2>🗺️ Coverage by kind of role and region</h2><small class="muted">Employers by the kind they mostly hire for (their role mix) and region: the gaps are where to scout next.</small>
<table><tr><th>Kind</th><th>All</th>${regions.map(region => `<th>${esc(region)}</th>`).join('')}</tr>
${rows(Object.entries(kinds).sort((a, b) => b[1] - a[1]), ([kind, count]) => [esc(kind), n(count), ...regions.map(region => n(grid[`${kind}|${region}`]))], 'No employers yet.')}</table></section>
<div class="grid2">
<section class="card"><h2>🩺 Freshness</h2><small class="muted">From each employer's last reads (the central scout, nightly).</small>
<table><tr><td>Growing (more jobs than last read)</td><td>${n(up)}</td></tr><tr><td>Shrinking</td><td>${n(down)}</td></tr>
<tr><td>No open job right now</td><td>${n(emptyNow)}</td></tr><tr><td>Failing (3+ reads in a row)</td><td>${n(failing.length)}</td></tr></table>
<table><tr><th>Failing</th><th>Reads failed</th><th>Last OK</th></tr>${rows(failing.slice(0, 10), feed => [esc(feed.company), n(feed.fresh.fails), esc(feed.fresh.ok)], 'None failing.')}</table></section>
<section class="card"><h2>⭐ Most useful employers</h2><small class="muted">Most interviews, then jobs matched, across installs (last 90 days).</small>
<table><tr><th>Employer</th><th>Interviews</th><th>Applied</th><th>Matched</th><th>Installs</th><th>Jobs</th></tr>${rows(data.useful, row => [esc(row.company), n(row.interviews), n(row.applied), n(row.hits), n(row.installs), n(row.jobs)], 'Nothing shared yet.')}</table></section>
</div>
<section class="card"><h2>📋 Job boards by kind of role</h2><small class="muted">Each board installs' jobs checks read, by their kind of role: how many got a match there.</small>
<table><tr><th>Board</th><th>Kind of role</th><th>Installs</th><th>Got a match</th><th>Jobs matched</th><th>Only on this board</th><th>Interviews</th><th>Failed</th></tr>${rows(data.boards || [], row => [esc(row.board), esc(row.roles || '—'), n(row.installs), n(row.matched), n(row.hits), n(Math.max(0, (row.hits || 0) - (row.dup || 0))), n(row.interviews), n(row.failed)], 'No board reads shared yet.')}</table></section>
<section class="card"><h2>🕳️ Dead ends</h2><small class="muted">Employers installs found with no readable job site: skipped for 30 days by everyone.</small>
<table><tr><th>Employer</th><th>Website</th><th>Installs</th><th>Last</th></tr>${rows(data.dead, row => [esc(row.company), esc(row.host || ''), n(row.installs), esc(row.last)], 'None reported yet.')}</table></section>
${nightly(data.central)}
</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  return new Response(page(await gather(env.STATS)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
