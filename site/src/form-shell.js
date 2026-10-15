// The frame the form-filling pages share (Real Form Filling, Form Learning): head, styles, header with the period and the AI-family filter, and the owner-only view that reads the numbers once (src/formlearning.js). Guard: site/test/form-pages.test.js.
import {FAMILIES, familyLinks, familyParam} from './engines.js';
import {viewer} from './auth.js';   // admins (invited) read these pages too
import {esc, remember} from './stats.js';
import {report} from './formlearning.js';
import {LEFT_EMPTY_CSS} from './left-empty-view.js';

const STYLE = `:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--good:#3fb68b;--bad:#e5484d;--green:#5ec47a;--red:#e5484d;--violet:#b48cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px}.tile{margin-bottom:0}
.tile b{display:block;font-size:30px;margin:4px 0 2px}.up{color:var(--good)}.down{color:var(--bad)}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}
td{padding:6px 4px;border-top:1px solid var(--line)}th.n{text-align:right}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}${LEFT_EMPTY_CSS}`;

// title/icon: the page's name; inner(data, url): its sections after the AI-family links.
export function shell({title, icon, data, url, inner}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
${STYLE}
</style></head><body><main>
<header><h1>${icon} ${esc(title)}</h1><span class="muted">${esc(data.from)} → ${esc(data.to)} · this week vs last${data.family ? ` · ${esc(FAMILIES[data.family])} installs only` : ''}</span></header>
${familyLinks(url, data.family || '')}
${inner(data, url)}
</main></body></html>`;
}

// GET one of the pages: owner or admin only, ?key= once, ?family= for one AI family.
// extra(db): more numbers for this page only, added to the data (the "Report this form" counts on Real Form Filling).
export const pageView = (render, extra = null) => async (request, env, now = new Date()) => {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.STATS) return new Response('No database', {status: 503});
  const family = familyParam(url);   // ?family=claude|openai: every count of the page for that AI family (src/engines.js)
  return new Response(render({...(await report(env.STATS, now, family)), ...(extra ? await extra(env.STATS) : {})}, url), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
};
