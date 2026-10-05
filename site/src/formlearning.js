// The owner's /smart-form-filling page: is the form filling getting better, and is its learning loop working? (Notion: "The
// self-learning loop".) Everything here is already counted for other pages; this one puts it on one timeline, this week vs last:
//   1 the form lab (private repo lab/form-lab.mjs) on public forms: reading (required questions the reader read, kind "question")
//     and operating (widgets the operators set), per board
//   2 real use: why fields stayed empty and what people answered themselves, per 100 required questions (form_exposure.required;
//     per 100 forms for apps older than 0.8.96, which send no count)
//   3 the recipe funnel (candidate -> canary -> verified, disabled), and the questions the lab could not read, to fix next.
// Counts and the forms' own public wording only. Owner-only, like /self-heal.
import {viewer} from './auth.js';   // admins (invited) read this page too
import {isOwner, esc, remember} from './stats.js';

export const WEEK = 7;
export const READING_KIND = 'question';
// Real-use reasons (desktop/lib/question-labels.js LEFT_REASONS) in the order the page shows them, with what each means.
export const REASONS = [
  ['unread', 'Required question on the page, not read', 'blind spot'],
  ['by_you_unread', 'You answered a question the fill never read', 'blind spot'],
  ['by_you', 'You answered a question the fill left', 'gap'],
  ['page_error', 'The page flagged a question after Submit', 'gap'],
  ['no_answer', 'No answer in the profile or kit', 'data'],
  ['not_taken', 'Answer given, the field did not take it', 'widget'],
  ['real_click', 'Dropdown needs a real click', 'widget'],
  ['no_option', 'Dropdown opened, no option matched', 'widget'],
  ['other', 'Other', 'other'],
];
const day = date => date.toISOString().slice(0, 10);
const back = (now, days) => day(new Date(now.getTime() - days * 86400000));

// {lab: [{board, reading: {now, before}, operating: {now, before}}], use: {fills, required, reasons: [...]}, recipes, unread, totals}
// Each rate is {ok, n, rate}; "now" is the last 7 days, "before" the 7 days before.
export async function report(db, now = new Date()) {
  const thisWeek = back(now, WEEK - 1), lastWeek = back(now, 2 * WEEK - 1);
  const period = d => (d >= thisWeek ? 'now' : d >= lastWeek ? 'before' : null);
  const rate = () => ({ok: 0, n: 0, rate: null});
  const add = (cell, ok, n) => { cell.ok += ok; cell.n += n; cell.rate = cell.n ? cell.ok / cell.n : null; };

  const labRows = (await db.prepare(`SELECT day, site, kind, SUM(ok) AS ok, COUNT(*) AS n FROM lab_runs WHERE day >= ? GROUP BY day, site, kind`)
    .bind(lastWeek).all()).results || [];
  const boards = new Map(), totals = {reading: {now: rate(), before: rate()}, operating: {now: rate(), before: rate()}};
  for (const row of labRows) {
    const when = period(row.day);
    if (!when) continue;
    const entry = boards.get(row.site) || {board: row.site, reading: {now: rate(), before: rate()}, operating: {now: rate(), before: rate()}};
    const what = row.kind === READING_KIND ? 'reading' : 'operating';
    add(entry[what][when], row.ok, row.n);
    add(totals[what][when], row.ok, row.n);
    boards.set(row.site, entry);
  }

  const exposure = (await db.prepare('SELECT day, SUM(n) AS fills, SUM(required) AS required FROM form_exposure WHERE day >= ? GROUP BY day').bind(lastWeek).all()).results || [];
  const use = {now: {fills: 0, required: 0}, before: {fills: 0, required: 0}};
  for (const row of exposure) { const when = period(row.day); if (when) { use[when].fills += row.fills || 0; use[when].required += row.required || 0; } }
  const reasonRows = (await db.prepare('SELECT day, reason, SUM(n) AS n FROM fill_reasons WHERE day >= ? GROUP BY day, reason').bind(lastWeek).all()).results || [];
  const counts = {now: {}, before: {}};
  for (const row of reasonRows) { const when = period(row.day); if (when) counts[when][row.reason] = (counts[when][row.reason] || 0) + row.n; }
  // Per 100 required questions when the apps sent the count, else per 100 forms.
  const per = when => (use[when].required ? {base: use[when].required, unit: 'required questions'} : {base: use[when].fills, unit: 'forms'});
  const per100 = (when, reason) => (per(when).base ? (100 * (counts[when][reason] || 0)) / per(when).base : null);
  const reasons = REASONS.map(([reason, text, group]) => ({reason, text, group, now: counts.now[reason] || 0, before: counts.before[reason] || 0,
    rateNow: per100('now', reason), rateBefore: per100('before', reason)}));

  const recipeRows = (await db.prepare('SELECT status, COUNT(*) AS n, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS fresh FROM recipes GROUP BY status')
    .bind(thisWeek).all()).results || [];
  const recipes = Object.fromEntries(['candidate', 'canary', 'verified', 'disabled'].map(status => {
    const row = recipeRows.find(r => r.status === status);
    return [status, {n: row?.n || 0, fresh: row?.fresh || 0}];
  }));

  // The questions the lab could not read this week, most seen first, with the form's own wording and a page to open: what to fix next.
  const unread = ((await db.prepare(`SELECT r.fingerprint, r.site, COUNT(*) AS n, MAX(r.day) AS last, MAX(r.url) AS url,
      (SELECT question FROM control_samples s WHERE s.fingerprint = r.fingerprint LIMIT 1) AS question
    FROM lab_runs r WHERE r.kind = ? AND r.ok = 0 AND r.day >= ? GROUP BY r.fingerprint, r.site ORDER BY n DESC, last DESC LIMIT 15`)
    .bind(READING_KIND, thisWeek).all()).results || []).map(row => ({...row}));

  return {lab: [...boards.values()].sort((a, b) => (b.reading.now.n + b.operating.now.n) - (a.reading.now.n + a.operating.now.n)),
    totals, use: {...use, unitNow: per('now').unit, reasons}, recipes, unread, from: lastWeek, to: day(now)};
}

const pct = cell => (cell?.rate == null ? '–' : `${Math.round(cell.rate * 100)}%`);
const num = value => (value == null ? '–' : value < 10 ? value.toFixed(1) : String(Math.round(value)));
// The change, as an arrow that says better or worse (higher is better for rates, lower for misses).
function trend(now, before, higherIsBetter = true) {
  if (now == null || before == null) return '<span class="muted">new</span>';
  const delta = now - before;
  if (Math.abs(delta) < 1e-9) return '<span class="muted">=</span>';
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return `<span class="${good ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}</span>`;
}

export function page(data) {
  const r = data.totals.reading, o = data.totals.operating;
  const blind = data.use.reasons.filter(x => x.group === 'blind spot');
  const blindNow = blind.reduce((s, x) => s + (x.rateNow || 0), 0), blindBefore = blind.reduce((s, x) => s + (x.rateBefore || 0), 0);
  const haveUse = data.use.now.fills || data.use.before.fills;
  const tile = (title, value, change, note) => `<section class="card tile"><small class="muted">${title}</small><b>${value} ${change}</b><small class="muted">${note}</small></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Form filling · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--good:#3fb68b;--bad:#e5484d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px}.tile{margin-bottom:0}
.tile b{display:block;font-size:30px;margin:4px 0 2px}.up{color:var(--good)}.down{color:var(--bad)}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}
td{padding:6px 4px;border-top:1px solid var(--line)}th.n{text-align:right}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
</style></head><body><main>
<header><h1>📝 Form filling</h1><span class="muted">${esc(data.from)} → ${esc(data.to)} · this week vs last</span></header>
<div class="tiles">
${tile('📖 Reading (lab)', pct(r.now), trend(r.now.rate, r.before.rate), `required questions read on public forms · ${r.now.n} this week, ${pct(r.before)} last`)}
${tile('🖱️ Operating (lab)', pct(o.now), trend(o.now.rate, o.before.rate), `widgets set by the operators · ${o.now.n} this week, ${pct(o.before)} last`)}
${tile('🕳️ Blind spots (real use)', haveUse ? num(blindNow) : '–', haveUse ? trend(blindNow, blindBefore, false) : '', `per 100 ${esc(data.use.unitNow)}: questions the fill never read · ${data.use.now.fills} forms this week`)}
${tile('🧩 Recipes', String(data.recipes.verified.n), `<span class="muted">+${data.recipes.canary.n} canary</span>`, `verified · ${data.recipes.candidate.n} candidates (${data.recipes.candidate.fresh} new this week) · ${data.recipes.disabled.n} retired`)}
</div>
<section class="card"><h2>📖 The lab, per board</h2><small class="muted">The extension's own code on public application forms, daily, never submitted. Reading = required questions it read (what it would ask Claude); operating = widgets its operators set.</small>
<div class="wrap"><table><tr><th>Board</th><th class="n">Reading</th><th></th><th class="n">Last week</th><th class="n">Operating</th><th></th><th class="n">Last week</th><th class="n">Runs</th></tr>
${data.lab.map(b => `<tr><td>${esc(b.board)}</td><td class="n">${pct(b.reading.now)}</td><td>${trend(b.reading.now.rate, b.reading.before.rate)}</td><td class="n muted">${pct(b.reading.before)}</td>
<td class="n">${pct(b.operating.now)}</td><td>${trend(b.operating.now.rate, b.operating.before.rate)}</td><td class="n muted">${pct(b.operating.before)}</td><td class="n">${b.reading.now.n + b.operating.now.n}</td></tr>`).join('')
  || '<tr><td colspan="8" class="muted">No lab runs yet.</td></tr>'}</table></div></section>
<section class="card"><h2>🧭 Real use: what the fill missed</h2><small class="muted">From the apps that send technical reports, per 100 ${esc(data.use.unitNow)}. Blind spots are what the learning loop must catch; widgets get recipes; data is the profile's.</small>
<div class="wrap"><table><tr><th>Why</th><th>Kind</th><th class="n">This week</th><th class="n">Per 100</th><th></th><th class="n">Last week</th></tr>
${data.use.reasons.filter(x => x.now || x.before).map(x => `<tr><td>${esc(x.text)}</td><td class="muted">${esc(x.group)}</td><td class="n">${x.now}</td><td class="n">${num(x.rateNow)}</td><td>${trend(x.rateNow, x.rateBefore, false)}</td><td class="n muted">${num(x.rateBefore)}</td></tr>`).join('')
  || '<tr><td colspan="6" class="muted">Nothing reported yet.</td></tr>'}</table></div></section>
<section class="card"><h2>🔧 What to fix next: questions the lab could not read</h2><small class="muted">This week, most seen first. Each is a reading failure: a report, then a replay test (tools/fill-fixture.mjs), then a fix.</small>
<div class="wrap"><table><tr><th>Question</th><th>Board</th><th class="n">Seen</th><th class="n">Last</th><th>Page</th></tr>
${data.unread.map(u => `<tr><td>${esc(u.question || u.fingerprint)}</td><td>${esc(u.site)}</td><td class="n">${u.n}</td><td class="n">${esc(u.last)}</td><td>${u.url ? `<a href="${esc(u.url)}" rel="noreferrer">open</a>` : ''}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">Every required question the lab met this week was read.</td></tr>'}</table></div></section>
<section class="card"><h2>🧩 Recipe funnel</h2><small class="muted">Learned fixes for widgets, as data: proposed by a small model, tested in the lab, rolled out by canary.</small>
<table><tr><th class="n">Candidate</th><th class="n">Canary</th><th class="n">Verified</th><th class="n">Retired</th></tr><tr>${['candidate', 'canary', 'verified', 'disabled'].map(s => `<td class="n">${data.recipes[s].n}${data.recipes[s].fresh ? ` <span class="muted">(+${data.recipes[s].fresh})</span>` : ''}</td>`).join('')}</tr></table></section>
</main></body></html>`;
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.STATS) return new Response('No database', {status: 503});
  return new Response(page(await report(env.STATS, now)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
