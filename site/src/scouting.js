// The central scout's own numbers (src/scout.py central_stats), sent with the index it publishes (PUT /api/index, owner's key) and shown on /intel.
// No user data: feeds, queue, yield per kind of source, Common Crawl, recipes, AI reads, market coverage against jobs.ch. Checked to a fixed shape.
const int = (value, max = 10_000_000) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.round(Number(value)))) : 0);
const word = (value, max = 60) => String(value ?? '').replace(/[^\p{L}\p{N} ._:/()+-]/gu, '').slice(0, max);
const counts = (object, keys = 40) => Object.fromEntries(Object.entries(object && typeof object === 'object' ? object : {}).slice(0, keys).map(([k, v]) => [word(k, 40), int(v)]));

export function cleanStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  return {
    feeds: int(stats.feeds), jobs: int(stats.jobs), relevant: int(stats.relevant), by_ats: counts(stats.by_ats), by_region: counts(stats.by_region),
    queue: counts(stats.queue, 12), recipes: int(stats.recipes), page_reads: int(stats.page_reads), link_choices: int(stats.link_choices),
    commoncrawl: word(stats.commoncrawl, 30), ideas_at: word(stats.ideas_at, 30), ideas_note: word(stats.ideas_note, 300),
    sources: (Array.isArray(stats.sources) ? stats.sources : []).slice(0, 25).map(s => ({origin: word(s?.origin), probed: int(s?.probed), found: int(s?.found)})),
    market: (Array.isArray(stats.market) ? stats.market : []).slice(0, 20).map(m => ({term: word(m?.term, 40), ours: int(m?.ours), jobsch: m?.jobsch == null ? null : int(m.jobsch)})),
  };
}

export async function store(db, stats, day) {
  const clean = cleanStats(stats);
  if (!db || !clean) return false;
  await db.prepare('INSERT INTO scout_stats (day, body) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET body = excluded.body').bind(day, JSON.stringify(clean)).run();
  return true;
}

// The latest day and a short history of the totals, for the page.
export async function load(db, days = 30) {
  if (!db) return null;
  const rows = ((await db.prepare('SELECT day, body FROM scout_stats ORDER BY day DESC LIMIT ?').bind(days).all().catch(() => ({results: []}))).results) || [];
  if (!rows.length) return null;
  const latest = JSON.parse(rows[0].body);
  return {day: rows[0].day, ...latest, history: rows.map(row => { const b = JSON.parse(row.body); return {day: row.day, feeds: b.feeds, jobs: b.jobs, relevant: b.relevant}; }).reverse()};
}

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
const pct = value => (value == null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`);
const rowsOf = (object, empty) => Object.entries(object || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.toLocaleString('en-US')}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">${empty}</td></tr>`;

export function section(s) {
  if (!s) return `<section class="card"><h2>🧭 Scouting</h2><small class="muted">The central scout has not reported yet: it sends its numbers with the next index it publishes (daily, 04:20 UTC).</small></section>`;
  const trend = s.history.map(h => `${esc(h.day.slice(5))}: ${h.feeds}`).join(' · ');
  return `<section class="card"><h2>🧭 Scouting</h2><small class="muted">The central scout's own numbers, ${esc(s.day)}. No user data. Trend of feeds in the index: ${trend}</small>
<table><tr><th>Feeds in the index</th><th>Open jobs in them</th><th>Engineering roles</th><th>Recipes learned</th><th>AI page reads (cached)</th><th>AI link picks</th><th>Common Crawl</th></tr>
<tr><td><b>${s.feeds.toLocaleString('en-US')}</b></td><td>${s.jobs.toLocaleString('en-US')}</td><td>${s.relevant.toLocaleString('en-US')}</td><td>${s.recipes}</td><td>${s.page_reads}</td><td>${s.link_choices}</td><td>${esc(s.commoncrawl || '—')}</td></tr></table>
<h2 style="margin-top:14px">📈 Market coverage (Switzerland)</h2><small class="muted">Open jobs with this word in the title in Swiss places: in our index (employer feeds) vs jobs.ch's own total for the word. Indicative: jobs.ch also lists agencies and repeats.</small>
<table><tr><th>Word</th><th>Our index</th><th>jobs.ch</th><th>Coverage</th></tr>
${s.market.map(m => `<tr><td>${esc(m.term)}</td><td>${m.ours}</td><td>${m.jobsch ?? '—'}</td><td><b>${pct(m.jobsch ? m.ours / m.jobsch : null)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Not measured yet.</td></tr>'}</table>
<h2 style="margin-top:14px">🔭 Yield per kind of source</h2><small class="muted">Candidates probed and the share that gave a useful feed: the learned priorities rank the queue by this.</small>
<table><tr><th>Source</th><th>Probed</th><th>Useful feeds</th><th>Yield</th></tr>
${s.sources.map(r => `<tr><td>${esc(r.origin)}</td><td>${r.probed}</td><td>${r.found}</td><td>${pct(r.probed ? r.found / r.probed : null)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing probed yet.</td></tr>'}</table>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:14px">
<div><h2>Feeds per job system</h2><table>${rowsOf(s.by_ats, 'none')}</table></div>
<div><h2>Feeds per region</h2><table>${rowsOf(s.by_region, 'none')}</table></div>
<div><h2>Queue</h2><table>${rowsOf(s.queue, 'empty')}</table></div></div>
${s.ideas_note ? `<p class="muted" style="margin-top:10px">🧠 Last AI ideas (${esc(s.ideas_at.slice(0, 10))}): ${esc(s.ideas_note)}</p>` : ''}</section>`;
}
