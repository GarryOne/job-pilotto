// Website stats without cookies: page views (POST /api/hit from public/track.js), Download clicks (GET /download/mac|windows,
// which records the click and redirects to the GitHub release file), and a private /stats page for the owner.
// Stored in Cloudflare D1 (binding STATS, database "www-stats", tables in migrations/). A visitor is a hash of IP + browser
// + the day + the secret STATS_SALT: it counts unique people per day and can't be traced back to an address.
// /stats opens with ?key=<STATS_KEY> (Worker secret; Keychain job-pilotto.site.stats_key), then remembers it in a cookie.

const RELEASE = 'https://github.com/GarryOne/job-pilotto/releases/latest/download/';
export const FILES = {mac: 'Job-Pilotto-mac-arm64.dmg', windows: 'Job-Pilotto-windows-x64.exe'};
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|monitor/i;
const KEY_COOKIE = 'jp_stats';

const clip = (value, max = 80) => String(value || '').replace(/[^\w.\-/: ]/g, '').slice(0, max);
const today = (now = new Date()) => now.toISOString().slice(0, 10);

export function device(agent = '') {
  if (/iPhone|iPad/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return 'Android';
  if (/Mac OS X|Macintosh/.test(agent)) return 'Mac';
  if (/Windows/.test(agent)) return 'Windows';
  if (/Linux/.test(agent)) return 'Linux';
  return 'other';
}

// "linkedin.com" from a referrer URL; our own pages and empty referrers count as direct.
export function sourceOf(referrer, self) {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host && host !== self.replace(/^www\./, '') ? clip(host, 60) : 'direct';
  } catch { return 'direct'; }
}

export async function visitor(request, env, day) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const data = new TextEncoder().encode(`${env.STATS_SALT || ''}|${day}|${ip}|${request.headers.get('User-Agent') || ''}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const isBot = request => BOT.test(request.headers.get('User-Agent') || '');

async function base(request, env, now) {
  const day = today(now);
  return {day, at: now.toISOString(), visitor: await visitor(request, env, day), country: clip(request.cf?.country || '', 4),
    device: device(request.headers.get('User-Agent') || '')};
}

// POST /api/hit {page, source}: one page view.
export async function hit(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  if (!env.STATS || isBot(request)) return new Response(null, {status: 204});
  let body = {};
  try { body = JSON.parse(await request.text()); } catch { /* an empty beacon still counts */ }
  const row = await base(request, env, now);
  await env.STATS.prepare('INSERT INTO visits (day, at, visitor, page, source, country, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.day, row.at, row.visitor, clip(body.page) || '/', clip(body.source, 60) || 'direct', row.country, row.device).run();
  return new Response(null, {status: 204});
}

// GET /download/mac?from=hero&page=/&src=linkedin.com: count it (in the background), then send the visitor to the file.
// The latest stable release's own file (Job-Pilotto-0.5.3-arm64.dmg), so each download is named after its
// version instead of Chrome's "Job-Pilotto-mac-arm64 (6).dmg". Asked from GitHub at most every 10 minutes (Cloudflare
// cache); if GitHub doesn't answer, the fixed name above still works.
const VERSIONED = {mac: /^Job-Pilotto-\d[\w.-]*-arm64\.dmg$/, windows: /^Job-Pilotto-\d[\w.-]*-x64\.exe$/};
export async function versioned(platform, env, fetcher = globalThis.fetch, cache = globalThis.caches?.default) {
  const api = `https://api.github.com/repos/${env.GITHUB_REPO || 'GarryOne/job-pilotto'}/releases/latest`;
  try {
    let response = cache && await cache.match(api);
    if (!response) {
      // Signed in with the site's GitHub token when it has one: 5,000 lookups an hour, not 60 per (shared) address.
      response = await fetcher(api, {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-site',
        ...(env.GITHUB_TOKEN ? {Authorization: `Bearer ${env.GITHUB_TOKEN}`} : {})}});
      if (!response.ok) return null;
      response = new Response(response.body, response);
      response.headers.set('Cache-Control', 'max-age=600');
      if (cache) await cache.put(api, response.clone());
    }
    const release = await response.json();
    return (release.assets || []).find(asset => VERSIONED[platform].test(asset.name))?.browser_download_url || null;
  } catch { return null; }
}

// One download row; also used by /install (src/install.js), whose client (curl) isn't a bot there.
export async function record(request, env, {platform, button, page = 'unknown', source}, now = new Date()) {
  if (!env.STATS) return;
  const row = await base(request, env, now);
  await env.STATS.prepare(
    'INSERT INTO downloads (day, at, visitor, platform, button, page, source, country, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.day, row.at, row.visitor, platform, button, page, source || 'direct', row.country, row.device).run();
}

export async function download(request, env, ctx, now = new Date()) {
  const url = new URL(request.url);
  const platform = url.pathname.split('/')[2];
  if (!FILES[platform]) return new Response('Not found', {status: 404});
  const target = await versioned(platform, env, env.fetcher || globalThis.fetch) || RELEASE + FILES[platform];  // env.fetcher: tests
  if (env.STATS && request.method === 'GET' && !isBot(request)) {
    const save = base(request, env, now).then(row => env.STATS.prepare(
      'INSERT INTO downloads (day, at, visitor, platform, button, page, source, country, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.day, row.at, row.visitor, platform, clip(url.searchParams.get('from'), 30) || 'unknown',
        clip(url.searchParams.get('page')) || 'unknown',
        clip(url.searchParams.get('src'), 60) || sourceOf(request.headers.get('Referer'), url.hostname),
        row.country, row.device).run()).catch(error => console.log('download stat failed', error.message));
    if (ctx?.waitUntil) ctx.waitUntil(save); else await save;
  }
  // Never kept by the browser: the next click asks again and gets the newest release.
  return new Response(null, {status: 302, headers: {Location: target, 'Cache-Control': 'no-store'}});
}

// ---- /stats ----

// The key: ?key= once (then the cookie), or `Authorization: Bearer <key>` for scripts (tools/canary_promote.py).
export function allowed(request, env) {
  if (!env.STATS_KEY) return false;
  if (request.headers.get('Authorization') === `Bearer ${env.STATS_KEY}`) return true;
  const url = new URL(request.url);
  const cookie = (request.headers.get('Cookie') || '').split(/;\s*/).find(part => part.startsWith(`${KEY_COOKIE}=`));
  return url.searchParams.get('key') === env.STATS_KEY || cookie?.slice(KEY_COOKIE.length + 1) === env.STATS_KEY;
}

export async function report(db, days, now = new Date()) {
  const from = today(new Date(now.getTime() - (days - 1) * 86400000));
  const all = async (sql) => (await db.prepare(sql).bind(from).all()).results || [];
  const one = async (sql) => (await all(sql))[0] || {};
  const top = (table, column, what = 'COUNT(*)') =>
    all(`SELECT ${column} AS name, ${what} AS n FROM ${table} WHERE day >= ? GROUP BY ${column} ORDER BY n DESC LIMIT 10`);
  const people = 'COUNT(DISTINCT day || visitor)';  // a visitor hash is only stable within one day
  const [visits, downloads, perDay, buttons, platforms, dlSources, sources, countries, pages, devices] = await Promise.all([
    one(`SELECT COUNT(*) AS views, ${people} AS visitors FROM visits WHERE day >= ?`),
    one(`SELECT COUNT(*) AS clicks, ${people} AS people FROM downloads WHERE day >= ?`),
    all(`SELECT day, SUM(v) AS visitors, SUM(d) AS downloads FROM (
           SELECT day, COUNT(DISTINCT visitor) AS v, 0 AS d FROM visits WHERE day >= ?1 GROUP BY day
           UNION ALL SELECT day, 0, COUNT(DISTINCT visitor) FROM downloads WHERE day >= ?1 GROUP BY day)
         GROUP BY day ORDER BY day`),
    top('downloads', 'button', people), top('downloads', 'platform', people), top('downloads', 'source', people),
    top('visits', 'source', people), top('visits', 'country', people), top('visits', 'page'), top('visits', 'device', people)]);
  return {days, from, visits, downloads, perDay, buttons, platforms, dlSources, sources, countries, pages, devices};
}

export async function signups(kv) {
  if (!kv) return [];
  const listed = await kv.list({prefix: 'signup:'});
  return listed.keys.map(key => ({email: key.name.slice(7), at: key.metadata?.at || '', role: key.metadata?.role || ''}))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pct = (part, whole) => whole ? `${Math.round(part / whole * 1000) / 10}%` : '–';

function bars(title, rows, unit) {
  const max = Math.max(1, ...rows.map(row => row.n));
  const body = rows.length ? rows.map(row => `<div class="bar"><span>${esc(row.name)}</span>
    <i style="--w:${Math.round(row.n / max * 100)}%"></i><b>${row.n}</b></div>`).join('') : '<p class="muted">Nothing yet</p>';
  return `<section class="card"><h2>${title}</h2><small class="muted">${unit}</small>${body}</section>`;
}

export function page(data, list) {
  const {visits, downloads} = data;
  const max = Math.max(1, ...data.perDay.map(day => day.visitors));
  const chart = data.perDay.map(day => `<div class="col" title="${day.day}: ${day.visitors} visitors, ${day.downloads} downloads">
    <i style="--h:${Math.round(day.visitors / max * 100)}%"></i><em style="--h:${Math.round(day.downloads / max * 100)}%"></em>
    <small>${day.day.slice(8)}</small></div>`).join('');
  const range = [7, 30, 90].map(n => n === data.days ? `<b>${n} days</b>` : `<a href="?days=${n}">${n} days</a>`).join(' · ');
  const tiles = [
    ['👀 Visitors', visits.visitors || 0, `${visits.views || 0} page views`],
    ['⬇️ Downloaders', downloads.people || 0, `${downloads.clicks || 0} clicks`],
    ['🎯 Conversion', pct(downloads.people || 0, visits.visitors || 0), 'visitors who download'],
    ['✉️ Pro waitlist', list.length, 'sign-ups, all time']];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Job Pilotto stats</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--teal:#5ec4b6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}
.tile b{display:block;font-size:32px;margin:4px 0 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.chart{display:flex;align-items:flex-end;gap:3px;height:160px;margin-top:12px}.col{flex:1;height:100%;position:relative;display:flex;align-items:flex-end;gap:1px}
.col i,.col em{flex:1;height:var(--h);min-height:1px;background:var(--amber);border-radius:3px 3px 0 0}.col em{background:var(--teal)}
.col small{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font-size:10px;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;background:var(--amber)}.legend i.t{background:var(--teal)}
.bar{display:grid;grid-template-columns:minmax(0,9em) 1fr 3em;gap:8px;align-items:center;margin-top:8px}
.bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar i{height:10px;width:var(--w);background:var(--amber);border-radius:5px}.bar b{text-align:right}
table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:6px 4px;border-top:1px solid var(--line);overflow-wrap:anywhere}
</style></head><body><main>
<header><h1>✈ Job Pilotto · website stats</h1><span class="muted">${range} · <a href="/telemetry">App reports →</a> · <a href="/intel">Intelligence →</a> · <a href="/self-heal">Self-heal →</a></span></header>
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${esc(value)}</b><small class="muted">${esc(note)}</small></div>`).join('')}</div>
<section class="card" style="margin-bottom:12px"><h2>Per day</h2><small class="legend muted"><i></i>visitors<i class="t"></i>downloaders</small>
<div class="chart">${chart || '<p class="muted">Nothing yet</p>'}</div><div style="height:18px"></div></section>
<div class="grid">
${bars('🔘 Download button', data.buttons, 'people who clicked it')}
${bars('💻 Platform', data.platforms, 'downloaders')}
${bars('🧭 Downloaders came from', data.dlSources, 'people')}
${bars('🔗 Visitors came from', data.sources, 'people')}
${bars('🌍 Country', data.countries, 'visitors')}
${bars('📄 Pages', data.pages, 'page views')}
${bars('🖥️ Device', data.devices, 'visitors')}
<section class="card"><h2>✉️ Pro waitlist</h2><small class="muted">newest first</small><table>
${list.map(row => `<tr><td>${esc(row.email)}</td><td class="muted">${esc(row.role)}</td><td class="muted">${esc(row.at.slice(0, 10))}</td></tr>`).join('') || '<tr><td class="muted">No sign-ups yet</td></tr>'}
</table></section></div>
<p class="muted">Since ${esc(data.from)} (UTC). People = unique per day, no cookies. More (referrers, speed): Cloudflare → Web Analytics.</p>
</main></body></html>`;
}

// ?key=… once: saved in a cookie for every private page (/stats and /telemetry: Path=/), then taken out of the
// address bar and history.
export function remember(url, env) {
  url.searchParams.delete('key');
  return new Response(null, {status: 302, headers: {Location: url.pathname + url.search,
    'Set-Cookie': `${KEY_COOKIE}=${env.STATS_KEY}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`}});
}

// GET /stats?days=30
export async function stats(request, env, now = new Date()) {
  if (!allowed(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env);
  const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const [data, list] = await Promise.all([report(env.STATS, days, now), signups(env.WAITLIST)]);
  return new Response(page(data, list), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex'}});
}
