// "Help the pool grow" (opt-in, docs/superpowers/specs/2026-09-30-pool-contributions.md): POST /api/contribute takes the
// employer career pages an app uses, tagged with coarse fixed-list roles and regions; GET /api/contributions (Bearer
// INDEX_PUBLISH_KEY, the central scout only) gives the aggregate. Nothing here can identify a person: the install id is
// hashed, and a feed's tags are only ever published from many installs (the scout's threshold).
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join', 'workday', 'careers', 'amazon', 'netflix'];
export const ROLES = ['software', 'sre_devops', 'data', 'security', 'mobile', 'qa', 'management', 'other'];
export const REGIONS = ['europe', 'north_america', 'latin_america', 'asia_pacific', 'middle_east_africa', 'remote'];
const MAX_FEEDS = 500, KEEP_DAYS = 90, EVERY_HOURS = 12;
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
  if (!body || body.v !== 1 || !/^[\w-]{8,64}$/.test(String(body.install || ''))) return Response.json({ok: false, error: 'invalid'}, {status: 400});
  const roles = pick(body.roles, ROLES), regions = pick(body.regions, REGIONS);
  const seen = new Set(), feeds = [];
  for (const item of (Array.isArray(body.feeds) ? body.feeds : []).slice(0, MAX_FEEDS)) {
    if (!item || !SYSTEMS.includes(item.ats) || typeof item.slug !== 'string' || !/^[\w.-]{1,120}$/.test(item.slug)) continue;
    if (typeof item.company !== 'string' || !item.company.trim() || seen.has(`${item.ats}:${item.slug}`)) continue;
    seen.add(`${item.ats}:${item.slug}`);
    feeds.push({ats: item.ats, slug: item.slug, company: item.company.trim().slice(0, 120), matched: item.matched ? 1 : 0, own: item.own ? 1 : 0});
  }
  if (!feeds.length) return Response.json({ok: false, error: 'no valid feeds'}, {status: 400});
  const install = await hashed(env, body.install);
  const kv = env.WAITLIST, limit = `pool:${install}`;
  if (kv && await kv.get(limit)) return Response.json({ok: false, error: `one contribution per ${EVERY_HOURS} hours`}, {status: 429});
  if (kv) await kv.put(limit, '1', {expirationTtl: EVERY_HOURS * 3600});
  const today = day(now);
  for (const feed of feeds) {
    await env.STATS.prepare(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install, ats, slug) DO UPDATE SET day = excluded.day, company = excluded.company, matched = excluded.matched,
      own = excluded.own, roles = excluded.roles, regions = excluded.regions`)
      .bind(install, today, feed.ats, feed.slug, feed.company, feed.matched, feed.own, roles.join(','), regions.join(',')).run();
  }
  return Response.json({ok: true, feeds: feeds.length});
}

// Per feed: how many different installs sent it, how many found jobs there, and among those the roles / regions.
export async function aggregate(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!env.INDEX_PUBLISH_KEY || given.length !== env.INDEX_PUBLISH_KEY.length || given !== env.INDEX_PUBLISH_KEY || !env.STATS) {
    return new Response('Not found', {status: 404});
  }
  const rows = (await env.STATS.prepare('SELECT ats, slug, company, matched, own, roles, regions FROM contributions LIMIT 50000').all()).results || [];
  const feeds = new Map();
  for (const row of rows) {
    const key = `${row.ats}:${row.slug}`;
    const feed = feeds.get(key) || {ats: row.ats, slug: row.slug, company: row.company, installs: 0, matched_installs: 0, own_installs: 0, roles: {}, regions: {}};
    feed.installs++;
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
