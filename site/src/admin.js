// The owner's admin area: every private page under /admin, one menu on all of them, and the old addresses redirected (for the
// owner only: anyone else still gets a 404, so the redirect tells nobody a page is there). Same key as before: ?key= once, then
// a session cookie (src/auth.js isOwner). The pages keep their own code; this file adds the menu and the small trend charts they share.
import {esc} from './stats.js';
import {viewer} from './auth.js';

export const PAGES = [
  {path: '/admin', group: 'Overview', question: 'Is Job Pilotto healthy today, at a glance?', name: 'Overview', icon: '🧭'},
  {path: '/admin/website', group: 'Growth', question: 'Who visits the website, and do they sign up and download?', old: '/stats', name: 'Website', icon: '🌐'},
  {path: '/admin/app', group: 'Growth', question: 'Do the installed apps run well, and where do they fail?', old: '/telemetry', name: 'App', icon: '🖥️'},
  {path: '/admin/insights', group: 'Intelligence', question: 'Does the app make good decisions for users?', old: '/intel', name: 'Insights', icon: '🧠'},
  {path: '/admin/self-healing', group: 'Operations', question: 'Do the automatic loops find and fix problems on their own?', old: '/self-heal', name: 'Self-healing', icon: '🔁'},
  {path: '/admin/ai-cost', group: 'Operations', question: 'What does the AI cost us, and for which jobs?', old: '/ai-cost', name: 'AI cost', icon: '💸'},
  {path: '/admin/scouting', group: 'Intelligence', question: 'Is our central employer list growing, and where is it weak?', name: 'Scouting', icon: '🛰️'},
  {path: '/admin/form-filling', group: 'Intelligence', question: 'How well are application forms filled, and what still trips the filler?', old: '/smart-form-filling', name: 'Form filling', icon: '📝'},
  {path: '/admin/feedback', group: 'Growth', question: 'What are users telling us?', old: '/feedback', name: 'Feedback', icon: '💬'},
  {path: '/admin/brain', group: 'Intelligence', question: 'What did the product brain recommend, and what did we decide?', name: 'Product Brain', icon: '🧠'},
  {path: '/admin/sentry', group: 'Operations', question: 'What errors do the apps report to Sentry, and did the fixer handle them?', name: 'Sentry', icon: '🐞'},
  {path: '/admin/applying', group: 'Operations', question: 'Is applying reliable: do the sites we fixed stay fixed, and did a real site change?', name: 'Applying tests', icon: '🛡️'},
  {path: '/admin/e2e', group: 'Operations', question: 'Do the end-to-end tests pass, and what broke?', name: 'E2E runs', icon: '🧪'},
  {path: '/admin/access', group: 'Operations', question: 'Who can open these admin pages?', name: 'Access', icon: '🔐', superadmin: true},
];
const OLD = Object.fromEntries(PAGES.filter(page => page.old).map(page => [page.old, page.path]));

// An old address: the owner is sent to the new one (query kept, so ?key= and ?days= still work); anyone else gets the 404 they got.
export async function redirectOld(request, env) {
  const url = new URL(request.url), target = OLD[url.pathname];
  if (!target || request.method !== 'GET') return null;
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  return new Response(null, {status: 301, headers: {Location: `${target}${url.search}`, 'Cache-Control': 'no-store'}});
}

// One look on every admin page: the shared base comes after each page's own styles, so the width, type, colours, cards and
// tables are the same everywhere; a page keeps only what is its own (its charts, badges, grids).
export const BASE_STYLE = `body{margin:0;background:#0b0d10;color:#f4efe3;font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:0 16px 48px}h1{margin:0;font-size:24px;line-height:1.2}h2{font-size:15px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 18px}
a{color:#f5b54a}.muted{color:#8d949c}.card{background:#14181d;border:1px solid #262c33;border-radius:14px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:500;color:#8d949c;font-size:12px}td{border-top:1px solid #262c33}
.card{padding:16px}h2{font-size:15px}main>.card,main>section.card{margin-bottom:16px}
th,td{padding:10px 8px;vertical-align:top}td.num,td.n,th.num,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.nowrap,.pill,.badge{white-space:nowrap}
.filters{display:flex;gap:6px;flex-wrap:wrap}.filter{color:#8d949c;text-decoration:none;padding:5px 10px;border:1px solid #262c33;border-radius:999px;font-size:13px;background:transparent;font-weight:400}
.filter:hover{color:#f4efe3}.filter.on{background:#f5b54a;color:#0b0d10;border-color:#f5b54a;font-weight:600}
.seg button{border-radius:999px;border-color:#262c33;color:#8d949c}.seg button[aria-pressed=true]{background:#f5b54a;border-color:#f5b54a;color:#0b0d10;font-weight:600}
@media (max-width:700px){main .card{overflow-x:auto}main table.wide{min-width:600px}.card{padding:14px}}`;

// What CSS alone can't do, on every admin page: a number column's header aligned like its numbers, dates on one line, a table
// with only its "nothing yet" row shown without its header, and wide tables (4+ columns) scrolling inside their card on a phone.
export const TABLE_SCRIPT = `document.querySelectorAll('main table').forEach(t=>{const rows=[...t.rows],head=rows.find(r=>r.querySelector('th'));
if(head&&head.cells.length>=4)t.classList.add('wide');const body=rows.filter(r=>r!==head&&r.querySelector('td'));
if(head&&body.length===1&&body[0].cells.length===1&&body[0].cells[0].colSpan>1)head.hidden=true;
if(head)[...head.cells].forEach((th,i)=>{const cells=body.map(r=>r.cells[i]).filter(Boolean);if(cells.length&&cells.every(c=>c.classList.contains('num')||c.classList.contains('n')||!c.textContent.trim()))th.classList.add('num')});
body.forEach(r=>[...r.cells].forEach(c=>{if(/^\\d{4}-\\d\\d-\\d\\d( \\d\\d:\\d\\d)?( UTC)?$/.test(c.textContent.trim()))c.classList.add('nowrap')}))});`;
// A row of filter links (a period, a status): the current one amber, as on every admin page.
export const filterLinks = (options, current) => `<nav class="filters" aria-label="Filter">${options.map(([value, label, href]) =>
  `<a class="filter${value === current ? ' on' : ''}" href="${esc(href)}"${value === current ? ' aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
export const NAV_STYLE = `.admin-nav{position:sticky;top:0;z-index:5;background:#0b0d10ee;backdrop-filter:blur(6px);border-bottom:1px solid #262c33;margin:0 0 18px}
.admin-nav div{max-width:1040px;margin:0 auto;padding:10px 16px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;font:14px/1.3 system-ui,-apple-system,sans-serif}
.admin-nav b{color:#f4efe3;margin-right:10px;white-space:nowrap}.admin-nav a{color:#8d949c;text-decoration:none;padding:5px 9px;border-radius:999px;white-space:nowrap}
.admin-nav .me{margin-left:auto;color:#8d949c;font-size:12px}.admin-nav a:hover{color:#f4efe3;background:#1b2027}.admin-nav a[aria-current]{color:#0b0d10;background:#f5b54a;font-weight:600}
.trend{float:right;display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#8d949c;margin-left:12px}.trend svg{display:block}
.trend .up{color:#3fb68b}.trend .down{color:#e5484d}
.admin-nav .admin-sub{padding-top:0;font-size:13px}.admin-nav .admin-sub a[aria-current]{background:#1b2027;color:#f5b54a}
.admin-question{margin:-10px 0 16px;color:#8d949c;font:14px/1.4 system-ui,-apple-system,sans-serif}`;

// The menu for this viewer, in four groups (owner, 6 Oct 2026: one row of eleven pages had grown too long): the groups on the first row,
// the pages of the open group on a second; the Access page only for the super admin; who is signed in, on the right.
export const GROUPS = [['Overview', '🧭'], ['Growth', '📈'], ['Intelligence', '🧠'], ['Operations', '🛠️']];
export function nav(active, who = {role: 'superadmin'}) {
  const shown = PAGES.filter(page => !page.superadmin || who.role === 'superadmin');
  const me = who.role === 'superadmin' ? 'super admin' : `${who.name} · admin`;
  const open = shown.find(page => page.path === active)?.group;
  const groups = GROUPS.map(([name, icon]) => {
    const first = shown.find(page => page.group === name);
    return first ? `<a href="${first.path}"${name === open ? ' aria-current="page"' : ''}>${icon} ${esc(name)}</a>` : '';
  }).join('');
  const pages = shown.filter(page => page.group === open);
  const second = pages.length > 1 ? `<div class="admin-sub">${pages.map(page =>
    `<a href="${page.path}"${page.path === active ? ' aria-current="page"' : ''}>${page.icon} ${esc(page.name)}</a>`).join('')}</div>` : '';
  return `<nav class="admin-nav" aria-label="Admin pages"><div><b>✈ Admin</b>${groups}<span class="me">${esc(me)}</span></div>${second}</nav>`;
}
// The question a page answers, under the menu on every page (owner, 6 Oct 2026): what to read it for, in one line.
export function question(active) {
  const page = PAGES.find(item => item.path === active);
  return page?.question ? `<p class="admin-question">${esc(page.question)}</p>` : '';
}
// The menu and the shared styles, added to a page's HTML (its own design stays): after <body>, and before </head>.
export function withNav(html, active, who) {
  // The question goes under the page's own title (owner, 7 Oct 2026: a muted line, no yellow label); a page without a header gets it under the menu.
  let out = String(html).replace('</head>', `<style>${BASE_STYLE}\n${NAV_STYLE}</style></head>`).replace(/<body([^>]*)>/, `<body$1>${nav(active, who)}`);
  out = out.includes('</header>') ? out.replace('</header>', `</header>${question(active)}`) : out.replace('</nav>', `</nav>${question(active)}`);
  return out.replace('</body>', `<script>${TABLE_SCRIPT}</script></body>`);
}
// A page response with the menu added; anything that is not an HTML page (a 404, a redirect, JSON) passes untouched.
export async function adminPage(response, active, who) {
  if (!response.ok || !/text\/html/.test(response.headers.get('Content-Type') || '')) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(withNav(await response.text(), active, who), {status: response.status, headers});
}

// ---- trends: one number per week, oldest first ----
export const WEEKS = 8;
const DAY = 86400000;
export const dayOf = date => date.toISOString().slice(0, 10);
// The first day of the window, and the week (0 = the last 7 days, 1 = the 7 before ...) a day falls in.
export const since = (now, weeks = WEEKS) => dayOf(new Date(now.getTime() - (weeks * 7 - 1) * DAY));
export function weekOf(day, now) {
  const age = Math.floor((Date.parse(`${dayOf(now)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY);
  return age < 0 ? 0 : Math.floor(age / 7);
}
// rows [{day, ...}] -> per week: reduce(rowsOfThatWeek) -> number or null, oldest week first.
export function byWeek(rows, now, reduce, weeks = WEEKS) {
  const buckets = Array.from({length: weeks}, () => []);
  for (const row of rows || []) { const w = weekOf(row.day, now); if (w < weeks) buckets[w].push(row); }
  return buckets.map(reduce).reverse();
}
export const sum = key => rows => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
export const ratio = (top, bottom) => rows => { const b = sum(bottom)(rows); return b ? sum(top)(rows) / b : null; };

// A small bar chart of the weeks, the last bar marked, and this week's value with an arrow against the week before.
export function spark(values, {format = value => String(Math.round(value)), higherIsBetter = true, width = 96, height = 22} = {}) {
  const list = (values || []).map(v => (v == null || Number.isNaN(v) ? null : Number(v)));
  const max = Math.max(...list.filter(v => v != null), 0) || 1, gap = 2, bar = (width - gap * (list.length - 1)) / Math.max(list.length, 1);
  const bars = list.map((v, i) => {
    const h = v == null ? 1 : Math.max(1, Math.round((v / max) * (height - 2)));
    return `<rect x="${(i * (bar + gap)).toFixed(1)}" y="${height - h}" width="${bar.toFixed(1)}" height="${h}" rx="1" fill="${i === list.length - 1 ? '#f5b54a' : v == null ? '#262c33' : '#5b6470'}"/>`;
  }).join('');
  const now = list.at(-1), before = list.at(-2);
  let arrow = '';
  if (now != null && before != null && now !== before) arrow = `<span class="${(now > before) === higherIsBetter ? 'up' : 'down'}">${now > before ? '▲' : '▼'}</span>`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="last ${list.length} weeks">${bars}</svg><span>${now == null ? '–' : esc(format(now))} ${arrow}</span>`;
}
// The chip a section header carries: what is counted, and its weeks.
export const trendChip = (label, values, options) => `<span class="trend" title="${esc(label)}, per week, last ${(values || []).length} weeks">${esc(label)} ${spark(values, options)}</span>`;
