// "Help the pool grow" (opt-in, docs/superpowers/specs/2026-09-30-pool-contributions.md): POST /api/contribute takes the
// employer career pages an app uses, tagged with coarse fixed-list roles and regions; GET /api/contributions (Bearer
// INDEX_PUBLISH_KEY, the central scout only) gives the aggregate. Nothing here can identify a person: the install id is
// hashed, and a feed's tags are only ever published from many installs (the scout's threshold).
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join', 'workday', 'umantis', 'successfactors', 'careers', 'amazon', 'netflix', 'jobsch'];
export const ROLES = ['software', 'sre_devops', 'data', 'security', 'mobile', 'qa', 'management', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];   // src/contribute.py: IT families, then src/role_kinds.py's other trades
export const REGIONS = ['europe', 'north_america', 'latin_america', 'asia_pacific', 'middle_east_africa', 'remote'];
const MAX_FEEDS = 500, KEEP_DAYS = 90, EVERY_MINUTES = 10;   // shared after every run (was once in 12 hours: owner, 6 Oct 2026)
// How an install found a feed (src/contribute.py HOW): fixed words only.
export const HOW = ['ai_idea', 'ai_list', 'jobs_ch', 'wikidata', 'seed', 'hn', 'whiteboards', 'swissdevjobs', 'index', 'own', 'other'];
const siteOf = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname) ? url.href.slice(0, 200) : null; } catch { return null; } };
const count = value => (Number.isFinite(value) ? Math.max(0, Math.min(100000, Math.round(value))) : null);
const day = date => date.toISOString().slice(0, 10);

async function hashed(env, install) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.STATS_SALT || ''}|pool|${install}`));
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter(item => allowed.includes(item)))].sort();

export async function contribute(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response('Use POST', {status: 405, headers: {Allow: 'POST'}});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  if ((Number(request.headers.get('Content-Length')) || 0) > 200_000) return Response.json({ok: false, error: 'too large'}, {status: 413});
  const body = await request.json().catch(() => null);
  if (!body || ![1, 2].includes(body.v) || !/^[\w-]{8,64}$/.test(String(body.install || ''))) return Response.json({ok: false, error: 'invalid'}, {status: 400});
  const roles = pick(body.roles, ROLES), regions = pick(body.regions, REGIONS);
  const seen = new Set(), feeds = [];
  for (const item of (Array.isArray(body.feeds) ? body.feeds : []).slice(0, MAX_FEEDS)) {
    if (!item || !SYSTEMS.includes(item.ats) || typeof item.slug !== 'string' || !/^[\w.-]{1,120}$/.test(item.slug)) continue;
    if (typeof item.company !== 'string' || !item.company.trim() || seen.has(`${item.ats}:${item.slug}`)) continue;
    seen.add(`${item.ats}:${item.slug}`);
    feeds.push({ats: item.ats, slug: item.slug, company: item.company.trim().slice(0, 120), matched: item.matched ? 1 : 0, own: item.own ? 1 : 0,
      how: HOW.includes(item.how) ? item.how : null, jobs: count(item.jobs), hits: count(item.hits), site: siteOf(item.site), failed: item.failed ? 1 : 0});
  }
  if (!feeds.length) return Response.json({ok: false, error: 'no valid feeds'}, {status: 400});
  const install = await hashed(env, body.install);
  const kv = env.WAITLIST, limit = `pool:${install}`;
  if (kv && await kv.get(limit)) return Response.json({ok: false, error: `one contribution per ${EVERY_MINUTES} minutes`}, {status: 429});
  if (kv) await kv.put(limit, '1', {expirationTtl: EVERY_MINUTES * 60});
  const today = day(now);
  for (const feed of feeds) {
    await env.STATS.prepare(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, how, jobs, hits, site, failed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install, ats, slug) DO UPDATE SET day = excluded.day, company = excluded.company, matched = excluded.matched,
      own = excluded.own, roles = excluded.roles, regions = excluded.regions, how = COALESCE(excluded.how, how), jobs = COALESCE(excluded.jobs, jobs),
      hits = COALESCE(excluded.hits, hits), site = COALESCE(excluded.site, site), failed = excluded.failed`)
      .bind(install, today, feed.ats, feed.slug, feed.company, feed.matched, feed.own, roles.join(','), regions.join(','), feed.how, feed.jobs, feed.hits,
        feed.site, feed.failed).run();
  }
  return Response.json({ok: true, feeds: feeds.length});
}

// Per feed: how many different installs sent it, how many found jobs there, and among those the roles / regions.
export async function aggregate(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!env.INDEX_PUBLISH_KEY || given.length !== env.INDEX_PUBLISH_KEY.length || given !== env.INDEX_PUBLISH_KEY || !env.STATS) {
    return new Response('Not found', {status: 404});
  }
  const rows = (await env.STATS.prepare('SELECT ats, slug, company, matched, own, roles, regions, how, jobs, hits, site, failed FROM contributions LIMIT 50000').all()).results || [];
  const feeds = new Map();
  for (const row of rows) {
    const key = `${row.ats}:${row.slug}`;
    const feed = feeds.get(key) || {ats: row.ats, slug: row.slug, company: row.company, installs: 0, matched_installs: 0, own_installs: 0, roles: {}, regions: {},
      how: {}, jobs: 0, hits: 0, failed_installs: 0, site: null};
    feed.installs++;
    if (row.how) feed.how[row.how] = (feed.how[row.how] || 0) + 1;   // which discovery routes find employers, across installs
    feed.jobs = Math.max(feed.jobs, row.jobs || 0);
    feed.hits += row.hits || 0;   // jobs that matched someone's search in their places: how useful this employer is
    feed.failed_installs += row.failed || 0;
    feed.site ||= row.site || null;
    feed.own_installs += row.own;
    if (row.matched) {
      feed.matched_installs++;
      for (const role of row.roles.split(',').filter(Boolean)) feed.roles[role] = (feed.roles[role] || 0) + 1;
      for (const region of row.regions.split(',').filter(Boolean)) feed.regions[region] = (feed.regions[region] || 0) + 1;
    }
    feeds.set(key, feed);
  }
  return Response.json({ok: true, feeds: [...feeds.values()]}, {headers: {'Cache-Control': 'no-store'}});
}

// Daily: rows older than KEEP_DAYS are dropped.
export async function purge(env, now = new Date()) {
  if (!env.STATS) return;
  await env.STATS.prepare('DELETE FROM contributions WHERE day < ?').bind(day(new Date(now.getTime() - KEEP_DAYS * 86400000))).run();
}
