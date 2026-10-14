// /admin/form-filling: is the form filling getting better, and is its learning loop working? (Notion: "The self-learning loop".) The page, its digest download and its route; the numbers: src/formlearning.js, the sections: src/form-sections.js.
import {answersSection} from './answer-metrics.js';
import {FAMILIES, familyLinks, familyParam} from './engines.js';
import {viewer} from './auth.js';   // admins (invited) read this page too
import {digest, markdown} from './digest.js';
import {proposalCard} from './proposal-digest.js';
import {isOwner, esc, remember} from './stats.js';
import {isThin, thinWords} from './thin-data.js';
import {report} from './formlearning.js';
import {familySection, learningSections, marksSection, num, resultsSection, trend} from './form-sections.js';

export function page(data, url = new URL('https://www.jobpilotto.top/admin/form-filling')) {
  const w = data.learning?.thisWeek, l = data.learning?.lastWeek;   // real fills (fill_cards, the digest)
  // Compared with last week; while last week has no forms, the last 3 days against the days before (the digest's recent vs earlier window).
  const early = !l?.forms && data.learning?.recent, rc = data.learning?.recent, er = data.learning?.earlier;
  const f = early ? (rc?.filledShare == null ? null : {now: rc.filledShare, before: er?.filledShare ?? null, words: 'last 3 days vs the days before'})
    : w?.filledShare == null ? null : {now: w.filledShare, before: l?.filledShare ?? null, words: 'this week vs last'};
  const blind = data.use.reasons.filter(x => x.group === 'blind spot');
  const blindNow = blind.reduce((s, x) => s + (x.rateNow || 0), 0), blindBefore = blind.reduce((s, x) => s + (x.rateBefore || 0), 0);
  const sample = data.learning?.sample, thin = isThin(sample);
  const haveUse = (data.use.now.fills || data.use.before.fills) && !thin;
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
<header><h1>📝 Form filling</h1><span class="muted">${esc(data.from)} → ${esc(data.to)} · this week vs last${data.family ? ` · ${esc(FAMILIES[data.family])} installs only` : ''}</span></header>
${familyLinks(url, data.family || '')}
${familySection(data.families, data.learning?.sample)}
${answersSection(data.answers, trend)}
<div class="tiles">
${thin ? tile('✅ Filled (real use)', 'Too few', '', esc(thinWords(sample))) : tile('✅ Filled (real use)', f ? `${Math.round(f.now * 100)}%` : '–', f ? trend(f.now, f.before) : '', `required questions the fill answered · ${f?.words || 'this week vs last'}: ${f?.before == null ? '–' : `${Math.round(f.before * 100)}%`} before · ${data.learning?.thisWeek?.forms || 0} forms this week`)}
${tile('🕳️ Blind spots (real use)', thin ? 'Too few' : haveUse ? num(blindNow) : '–', haveUse ? trend(blindNow, blindBefore, false) : '', thin ? `${esc(thinWords(sample))} · ${data.use.now.fills} forms reported` : `per 100 ${esc(data.use.unitNow)}: questions the fill never read · ${data.use.now.fills} forms this week`)}
${tile('🧩 Recipes', String(data.recipes.verified.n), `<span class="muted">+${data.recipes.canary.n} canary</span>`, `verified · ${data.recipes.candidate.n} candidates (${data.recipes.candidate.fresh} new this week) · ${data.recipes.disabled.n} retired`)}
</div>
${resultsSection(data.results)}
${proposalCard(data.learning?.proposals, esc)}
${learningSections(data.learning)}
${marksSection(data.marks)}
<section class="card"><h2>🧭 Real use: what the fill missed</h2><small class="muted">From the apps that send technical reports, per 100 ${esc(data.use.unitNow)}. Blind spots are what the learning loop must catch; widgets get recipes; data is the profile's. ${thin ? `<b>${esc(thinWords(sample))}:</b> counts only, no rate. ` : ''}Per platform, against the pool's tests: <a href="/admin/applying">Applying tests → platform scorecard</a>.</small>
<div class="wrap"><table><tr><th>Why</th><th>Kind</th><th class="n">This week</th><th class="n">Per 100</th><th></th><th class="n">Last week</th></tr>
${data.use.reasons.filter(x => x.now || x.before).map(x => `<tr><td>${esc(x.text)}</td><td class="muted">${esc(x.group)}</td><td class="n">${x.now}</td><td class="n">${thin ? '–' : num(x.rateNow)}</td><td>${thin ? '' : trend(x.rateNow, x.rateBefore, false)}</td><td class="n muted">${thin ? '–' : num(x.rateBefore)}</td></tr>`).join('')
  || '<tr><td colspan="6" class="muted">Nothing reported yet.</td></tr>'}</table></div></section>
<section class="card"><h2>🧩 Recipe funnel</h2><small class="muted">Learned fixes for widgets, as data: proposed by a small model, rolled out by canary.</small>
<table><tr><th class="n">Candidate</th><th class="n">Canary</th><th class="n">Verified</th><th class="n">Retired</th></tr><tr>${['candidate', 'canary', 'verified', 'disabled'].map(s => `<td class="n">${data.recipes[s].n}${data.recipes[s].fresh ? ` <span class="muted">(+${data.recipes[s].fresh})</span>` : ''}</td>`).join('')}</tr></table></section>
</main></body></html>`;
}

// GET /admin/form-filling/digest.json | .md: the learning digest (any admin, or the scripts' key for the weekly AI pass).
export async function digestView(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const d = await digest(env.STATS, now);
  if (new URL(request.url).pathname.endsWith('.md')) return new Response(markdown(d), {headers: {'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
  return Response.json(d, {headers: {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.STATS) return new Response('No database', {status: 503});
  const family = familyParam(url);   // ?family=claude|openai: every count of the page for that AI family (src/engines.js)
  return new Response(page(await report(env.STATS, now, family), url), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}

