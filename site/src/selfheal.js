// The owner's page /self-heal: what the self-healing loops (the Finder's AI screenshot review, the UI and Sentry fixers) spend on AI.
// Owner-only like /stats (STATS_KEY), never a static page: static assets are public. The figures are a snapshot read from the CI logs.
import {allowed, esc, remember} from './stats.js';

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

export function page(data = SNAPSHOT) {
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
<header><h1>✈ Job Pilotto · self-healing AI spend</h1><span class="muted">${esc(data.period)} · <a href="/stats">Website stats →</a> · <a href="/telemetry">App reports →</a> · <a href="/intel">Intelligence →</a></span></header>
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
export function view(request, env) {
  if (!allowed(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env);
  return new Response(page(), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
