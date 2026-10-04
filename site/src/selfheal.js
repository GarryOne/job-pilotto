// The owner's page /self-heal: what the self-healing loops (the Finder's AI screenshot review, the UI and Sentry fixers) spend on AI.
// Owner-only like /stats (STATS_KEY), never a static page: static assets are public. The figures are a snapshot read from the CI logs.
import {allowed, esc, remember} from './stats.js';
import {equal} from './guard.js';

// 2-3 Oct 2026, from GitHub Actions logs. Fixer: claude-code-action's own total_cost_usd. Finder: estimated (the review then dropped usage).
export const SNAPSHOT = {
  period: '2–3 Oct 2026',
  fixer: [
    {at: '3 Oct 17:35', issue: '#63 focus: “More actions” expand broken', turns: 20, usd: 0.253, result: 'PR #85, closed'},
    {at: '3 Oct 16:48', issue: '#66 strategy: no loading state on “Edit in Notion”', turns: 19, usd: 0.208, result: 'PR #79, merged'},
    {at: '3 Oct 10:31', issue: '#49 sidebar spill (second try)', turns: 19, usd: 0.232, result: 'no PR (run failed)'},
    {at: '2 Oct 23:31', issue: '#49 sidebar spill', turns: 14, usd: 0.172, result: 'PR #62, closed'},
    {at: '2 Oct 21:43', issue: '#50 activity: vague warning reason', turns: 22, usd: 0.252, result: 'PR #54, merged'},
    {at: '2 Oct 21:19', issue: '#38 activity: rate-limit detail', turns: 1, usd: 0, result: 'Claude errored at once'},
    {at: '2–3 Oct', issue: 'Sentry fixer, 3 runs: nothing qualified', turns: 0, usd: 0, result: 'Claude never ran'},
  ],
  finder: [
    {day: '2 Oct', reviews: 292, rejected: 58, low: 1.9, high: 5.8},
    {day: '3 Oct', reviews: 184, rejected: 0, low: 1.2, high: 3.7},
  ],
  findings: 220,
  drivers: [
    'Volume of screenshot reviews: 476, about one per screenshot in every e2e suite, four e2e runs a day.',
    'Thinking tokens: Sonnet 5.5 thinks by default, billed as output at $10 per million tokens, up to the 1,200-token cap. That is roughly half to two-thirds of a review.',
    'Until 3 Oct the prompt was resent uncached on every review. Since e92c3d0 it is cached, and an unchanged screenshot is not reviewed again.',
    'The Fixer is cheap per attempt ($0.17–0.25, 14–22 turns). Its cost is in the attempts that end in a closed PR: 2 of 4.',
  ],
  notCounted: [
    'The e2e fact judges (the quality and employers suites) and the app\'s own AI calls during e2e runs: test spend, not the Finder.',
    'PR #35 (2 Oct 13:29): no run left in the history.',
    'From e92c3d0 on, each review logs its exact cost in the e2e job summary and artifacts/ai-review-usage.json.',
  ],
};

const usd = n => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const range = (low, high) => `≈ $${low.toFixed(1)}–${high.toFixed(1)}`;

// ---------- live: the loop's numbers, published by CI (self-heal-stats.yml) ----------
const pct = value => (value === null || value === undefined ? '–' : `${value}%`);
const num = value => (value === null || value === undefined ? '–' : String(value));
export function liveSection(live, history = []) {
  if (!live) return `<section class="card"><h2>🩺 The loop, live</h2><p class="muted">No numbers published yet: they arrive every 3 hours from CI (self-heal-stats.yml).</p></section>`;
  const t = live.totals || {}, fixer = live.fixer || {}, cost = live.cost || {}, recall = live.recall;
  const tiles = [
    ['🐞 Real bugs caught', num(t.real), `${num(t.fixed)} fixed · ${num(t.queued)} queued for the fixer`],
    ['🎯 Precision', pct(t.precision), `${num(t.real)} real vs ${num(t.falsePositive)} false positives (judged issues)`],
    ['🧪 Recall', recall ? `${recall.caught}/${recall.planted}` : '–', recall ? (recall.missed.length ? `missed: ${recall.missed.join(', ')}` : 'every planted bug caught') : 'no interactions run yet'],
    ['🛠️ Fixer', `${num(fixer.landed ?? fixer.merged)} landed`, `${num(fixer.opened)} PRs · ${num(fixer.open)} open · verdicts ${num(live.verdicts?.real)} real / ${num(live.verdicts?.falsePositive)} false`],
    ['💸 AI cost', `$${(cost.usd || 0).toFixed(2)}`, cost.perRealBug ? `$${cost.perRealBug} per real bug · ${cost.runs} runs recorded` : `${num(cost.runs)} runs recorded`],
  ];
  const cols = ['filed', 'fixed', 'queued', 'falsePositive', 'duplicate', 'harness', 'unclear', 'open'];
  const heads = ['Filed', 'Real, fixed', 'Real, queued', 'False positives', 'Duplicates', 'Test / harness', 'Unclear', 'Open, unjudged'];
  const trend = history.slice().sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
  return `<section class="card"><h2>🩺 The loop, live</h2><small class="muted">Updated ${esc(String(live.at || '').slice(0, 16).replace('T', ' '))} UTC · every issue the loop filed, by what found it and how it ended</small></section>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${esc(value)}</b><small class="muted">${esc(note)}</small></div>`).join('')}</div>
<section class="card"><h2>🔎 By detector</h2><div class="wrap"><table><tr><th>Detector</th>${heads.map(head => `<th>${head}</th>`).join('')}</tr>
${(live.byDetector || []).map(row => `<tr><td>${esc(row.detector)}</td>${cols.map(col => `<td class="n">${num(row[col])}</td>`).join('')}</tr>`).join('')}
<tr class="total"><td>Total</td>${cols.map(col => `<td class="n">${num(t[col])}</td>`).join('')}</tr></table></div>
<small class="muted">Real = confirmed by the verdict pass or a person, or closed by a fix. Unclear = closed as "not seen twice" or with a note: neither proven real nor false.</small></section>
<div class="grid">
<section class="card"><h2>📈 Trend</h2><small class="muted">One snapshot per day</small><div class="wrap"><table><tr><th>Day</th><th>Filed</th><th>Real</th><th>False pos.</th><th>Precision</th><th>Recall</th><th>AI cost</th></tr>
${trend.map(row => `<tr><td>${esc(row.day)}</td><td class="n">${num(row.totals?.filed)}</td><td class="n">${num(row.totals?.real)}</td><td class="n">${num(row.totals?.falsePositive)}</td><td class="n">${pct(row.totals?.precision)}</td><td class="n">${row.recall ? `${row.recall.caught}/${row.recall.planted}` : '–'}</td><td class="n">$${(row.cost?.usd || 0).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">The first day: the trend grows from here.</td></tr>'}
</table></div></section>
<section class="card"><h2>📅 Issues filed per day</h2><div class="wrap"><table><tr><th>Day</th><th>Filed</th><th>Real</th><th>False positives</th></tr>
${(live.daily || []).slice(-14).reverse().map(row => `<tr><td>${esc(row.day)}</td><td class="n">${row.filed}</td><td class="n">${row.real}</td><td class="n">${row.falsePositive}</td></tr>`).join('')}
</table></div></section></div>
<section class="card"><h2>🐞 Real bugs it caught (latest)</h2><div class="wrap"><table><tr><th>#</th><th>Bug</th><th>Found by</th><th>Severity</th><th>Status</th></tr>
${(live.notable || []).map(bug => `<tr><td><a href="${esc(bug.url)}">#${bug.number}</a></td><td>${esc(bug.title)}</td><td class="muted">${esc(bug.detector)}</td><td>${esc(bug.severity)}</td><td>${bug.status === 'fixed' ? '✅ fixed' : '⏳ queued'}</td></tr>`).join('')}
</table></div></section>`;
}

// PUT /self-heal/data (Bearer SELFHEAL_PUBLISH_KEY): CI publishes the loop's numbers; one row per day, the latest wins. Checked: the key, the size, the shape.
export async function ingest(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.SELFHEAL_PUBLISH_KEY && equal(given, env.SELFHEAL_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 300000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  if (data?.schema !== 1 || typeof data.at !== 'string' || !data.totals || !Array.isArray(data.byDetector)) return new Response('Unexpected shape', {status: 400});
  const day = data.at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response('Bad date', {status: 400});
  await env.STATS.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, body = excluded.body').bind(day, data.at, body).run();
  return new Response(JSON.stringify({ok: true, day}), {headers: {'Content-Type': 'application/json'}});
}

async function snapshots(env) {
  try {
    const {results = []} = await env.STATS.prepare('SELECT day, body FROM selfheal_snapshots ORDER BY day DESC LIMIT 30').all();
    return results.map(row => { try { return {day: row.day, ...JSON.parse(row.body)}; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function page(data = SNAPSHOT, live = null, history = []) {
  const fixerUsd = data.fixer.reduce((sum, row) => sum + row.usd, 0);
  const prs = data.fixer.filter(row => /^PR #/.test(row.result)), merged = prs.filter(row => /merged/.test(row.result));
  const reviews = data.finder.reduce((sum, row) => sum + row.reviews, 0), rejected = data.finder.reduce((sum, row) => sum + row.rejected, 0);
  const low = data.finder.reduce((sum, row) => sum + row.low, 0), high = data.finder.reduce((sum, row) => sum + row.high, 0);
  const tiles = [
    ['💸 Total AI spend', range(fixerUsd + low, fixerUsd + high), data.period],
    ['🛠️ Fixer', usd(fixerUsd), 'measured'],
    ['🔎 Finder', range(low, high), `estimated · ${reviews} reviews`],
    ['✅ Merged fixes', `${merged.length} of ${prs.length}`, merged.length ? `${usd(fixerUsd / merged.length)} per merged fix` : 'none yet'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Job Pilotto self-healing spend</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px}
.tile{margin-bottom:0}.tile b{display:block;font-size:30px;margin:4px 0 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}
td{padding:6px 4px;border-top:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tr.total td{font-weight:700}
ul{margin:8px 0 0;padding-left:18px}li{margin-top:6px}
</style></head><body><main>
<header><h1>✈ Job Pilotto · self-healing loop</h1><span class="muted">${esc(data.period)} · <a href="/stats">Website stats →</a> · <a href="/telemetry">App reports →</a> · <a href="/intel">Intelligence →</a></span></header>
${liveSection(live, history)}
<section class="card"><h2>💸 Snapshot: self-healing AI spend, ${esc(data.period)}</h2><small class="muted">Measured by hand from the CI logs, before each run recorded its own cost</small></section>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${esc(value)}</b><small class="muted">${esc(note)}</small></div>`).join('')}</div>
<section class="card"><h2>🧭 What drives the cost</h2><ul>${data.drivers.map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>
<section class="card"><h2>🛠️ Fixer runs</h2><small class="muted">claude-code-action's own cost, Sonnet 5.5</small><div class="wrap"><table>
<tr><th>Run (UTC)</th><th>Issue</th><th>Turns</th><th>Cost</th><th>Result</th></tr>
${data.fixer.map(row => `<tr><td>${esc(row.at)}</td><td>${esc(row.issue)}</td><td class="n">${row.turns}</td><td class="n">${usd(row.usd)}</td><td class="muted">${esc(row.result)}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td></td><td class="n">${data.fixer.reduce((sum, row) => sum + row.turns, 0)}</td><td class="n">${usd(fixerUsd)}</td><td>${prs.length} PRs, ${merged.length} merged</td></tr>
</table></div></section>
<div class="grid">
<section class="card"><h2>🔎 Finder reviews</h2><small class="muted">AI screenshot review, estimated</small><div class="wrap"><table>
<tr><th>Day</th><th>Reviews</th><th>Rejected (400)</th><th>Est. cost</th></tr>
${data.finder.map(row => `<tr><td>${esc(row.day)}</td><td class="n">${row.reviews}</td><td class="n">${row.rejected}</td><td class="n">${range(row.low, row.high)}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td class="n">${reviews}</td><td class="n">${rejected}</td><td class="n">${range(low, high)}</td></tr>
</table></div><small class="muted">${data.findings} findings. Per review ≈ 2.6–3.8k input tokens ($0.005–0.008) + 150–1,200 output ($0.0015–0.012); rejected calls counted as free.</small></section>
<section class="card"><h2>🙈 Not counted</h2><ul>${data.notCounted.map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>
</div></main></body></html>`;
}

// GET /self-heal (?key=<STATS_KEY> once; the cookie after that)
export async function view(request, env) {
  if (!allowed(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env);
  const history = env.STATS ? await snapshots(env) : [];
  return new Response(page(SNAPSHOT, history[0] || null, history), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
