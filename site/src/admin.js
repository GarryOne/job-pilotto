// The owner's admin area: every private page under /admin, one menu on all of them, and the old addresses redirected (for the
// owner only: anyone else still gets a 404, so the redirect tells nobody a page is there). Same key as before: ?key= once, then
// the cookie (stats.js allowed). The pages keep their own code; this file adds the menu and the small trend charts they share.
import {allowed, esc} from './stats.js';

export const PAGES = [
  {path: '/admin', name: 'Overview', icon: '🧭'},
  {path: '/admin/website', old: '/stats', name: 'Website', icon: '🌐'},
  {path: '/admin/app', old: '/telemetry', name: 'App', icon: '🖥️'},
  {path: '/admin/insights', old: '/intel', name: 'Insights', icon: '🧠'},
  {path: '/admin/self-healing', old: '/self-heal', name: 'Self-healing', icon: '🔁'},
  {path: '/admin/ai-cost', old: '/ai-cost', name: 'AI cost', icon: '💸'},
  {path: '/admin/form-filling', old: '/smart-form-filling', name: 'Form filling', icon: '📝'},
  {path: '/admin/feedback', old: '/feedback', name: 'Feedback', icon: '💬'},
];
const OLD = Object.fromEntries(PAGES.filter(page => page.old).map(page => [page.old, page.path]));

// An old address: the owner is sent to the new one (query kept, so ?key= and ?days= still work); anyone else gets the 404 they got.
export function redirectOld(request, env) {
  const url = new URL(request.url), target = OLD[url.pathname];
  if (!target || request.method !== 'GET') return null;
  if (!allowed(request, env)) return new Response('Not found', {status: 404});
  return new Response(null, {status: 301, headers: {Location: `${target}${url.search}`, 'Cache-Control': 'no-store'}});
}

export const NAV_STYLE = `.admin-nav{position:sticky;top:0;z-index:5;background:#0b0d10ee;backdrop-filter:blur(6px);border-bottom:1px solid #262c33;margin:0 0 18px}
.admin-nav div{max-width:1040px;margin:0 auto;padding:10px 16px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;font:14px/1.3 system-ui,-apple-system,sans-serif}
.admin-nav b{color:#f4efe3;margin-right:10px;white-space:nowrap}.admin-nav a{color:#8d949c;text-decoration:none;padding:5px 9px;border-radius:999px;white-space:nowrap}
.admin-nav a:hover{color:#f4efe3;background:#1b2027}.admin-nav a[aria-current]{color:#0b0d10;background:#f5b54a;font-weight:600}
.trend{float:right;display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#8d949c;margin-left:12px}.trend svg{display:block}
.trend .up{color:#3fb68b}.trend .down{color:#e5484d}`;

export function nav(active) {
  return `<nav class="admin-nav" aria-label="Admin pages"><div><b>✈ Job Pilotto admin</b>${PAGES.map(page =>
    `<a href="${page.path}"${page.path === active ? ' aria-current="page"' : ''}>${page.icon} ${esc(page.name)}</a>`).join('')}</div></nav>`;
}
// The menu and the shared styles, added to a page's HTML (its own design stays): after <body>, and before </head>.
export function withNav(html, active) {
  return String(html).replace('</head>', `<style>${NAV_STYLE}</style></head>`).replace(/<body([^>]*)>/, `<body$1>${nav(active)}`);
}
// A page response with the menu added; anything that is not an HTML page (a 404, a redirect, JSON) passes untouched.
export async function adminPage(response, active) {
  if (!response.ok || !/text\/html/.test(response.headers.get('Content-Type') || '')) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(withNav(await response.text(), active), {status: response.status, headers});
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
