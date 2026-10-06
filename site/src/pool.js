// "Help the pool grow" (opt-in, docs/superpowers/specs/2026-09-30-pool-contributions.md): POST /api/contribute takes the
// employer career pages an app uses, tagged with coarse fixed-list roles and regions; GET /api/contributions (Bearer
// INDEX_PUBLISH_KEY, the central scout only) gives the aggregate. Nothing here can identify a person: the install id is
// hashed, and a feed's tags are only ever published from many installs (the scout's threshold).
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join', 'workday', 'umantis', 'successfactors', 'careers', 'amazon', 'netflix', 'jobsch'];
export const ROLES = ['software', 'sre_devops', 'data', 'security', 'mobile', 'qa', 'management', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];   // src/contribute.py: IT families, then src/role_kinds.py's other trades
export const REGIONS = ['europe', 'north_america', 'latin_america', 'asia_pacific', 'middle_east_africa', 'remote'];
const MAX_FEEDS = 2000, MAX_NOFEED = 300, MAX_BOARDS = 30, KEEP_DAYS = 90, PER_MINUTE = 30;   // installs share each find as it is made (owner, 6 Oct 2026): many small shares; every feed a check read (7 Oct 2026)
// The fixed board ids src/contribute.py BOARDS sends: nothing else is stored.
const BOARDS = ['jobsch', 'arbeitnow', 'himalayas', 'jobicy', 'adzuna', 'jooble', 'google_jobs', 'alerts_linkedin', 'alerts_jobsch', 'alerts_jobup', 'alerts_indeed', 'alerts_glassdoor'];
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
  if ((Number(request.headers.get('Content-Length')) || 0) > 600_000) return Response.json({ok: false, error: 'too large'}, {status: 413});
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
  // "No readable job site" (v2): a company name and its website host, both checked; the same key as the scout's (src/scout.py key_for).
  const nofeed = [], keys = new Set();
  for (const item of (Array.isArray(body.nofeed) ? body.nofeed : []).slice(0, MAX_NOFEED)) {
    const company = typeof item?.company === 'string' ? item.company.trim().slice(0, 120) : '';
    const key = company.toLowerCase().replace(/\b(ag|sa|gmbh|ltd|inc|llc|plc)\b/g, '').replace(/[^a-z0-9]/g, '');
    if (!key || keys.has(key)) continue;
    keys.add(key);
    nofeed.push({key, company, host: typeof item.host === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item.host) ? item.host.slice(0, 100) : null});
  }
  const boards = [], named = new Set();
  for (const item of (Array.isArray(body.boards) ? body.boards : []).slice(0, MAX_BOARDS)) {
    if (!BOARDS.includes(item?.board) || named.has(item.board)) continue;
    named.add(item.board);
    boards.push({board: item.board, jobs: count(item.jobs), hits: count(item.hits), failed: item.failed ? 1 : 0});
  }
  if (!feeds.length && !nofeed.length && !boards.length) return Response.json({ok: false, error: 'no valid feeds'}, {status: 400});
  const install = await hashed(env, body.install);
  const kv = env.WAITLIST, limit = `pool:${install}`;
  const minute = `${limit}:${Math.floor(now.getTime() / 60000)}`;
  const used = kv ? Number(await kv.get(minute)) || 0 : 0;
  if (used >= PER_MINUTE) return Response.json({ok: false, error: `at most ${PER_MINUTE} contributions a minute`}, {status: 429});
  if (kv) await kv.put(minute, String(used + 1), {expirationTtl: 120});
  const today = day(now);
  // matched / own: a one-item share made the same day (matched false) must not undo what that day's jobs check saw.
  const statements = feeds.map(feed => env.STATS.prepare(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, how, jobs, hits, site, failed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install, ats, slug) DO UPDATE SET company = excluded.company,
      matched = CASE WHEN day = excluded.day THEN MAX(matched, excluded.matched) ELSE excluded.matched END,
      own = CASE WHEN day = excluded.day THEN MAX(own, excluded.own) ELSE excluded.own END, day = excluded.day,
      roles = excluded.roles, regions = excluded.regions, how = COALESCE(how, excluded.how), jobs = COALESCE(excluded.jobs, jobs),
      hits = COALESCE(excluded.hits, hits), site = COALESCE(excluded.site, site), failed = excluded.failed`)
    .bind(install, today, feed.ats, feed.slug, feed.company, feed.matched, feed.own, roles.join(','), regions.join(','), feed.how, feed.jobs, feed.hits,
      feed.site, feed.failed));
  for (const item of nofeed) {
    statements.push(env.STATS.prepare('INSERT INTO nofeed (install, day, key, company, host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(install, key) DO UPDATE SET day = excluded.day, host = COALESCE(excluded.host, host)')
      .bind(install, today, item.key, item.company, item.host));
  }
  for (const item of boards) {
    statements.push(env.STATS.prepare(`INSERT INTO board_reads (install, day, board, roles, regions, jobs, hits, failed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install, board) DO UPDATE SET day = excluded.day, roles = excluded.roles, regions = excluded.regions, jobs = excluded.jobs,
      hits = excluded.hits, failed = excluded.failed`).bind(install, today, item.board, roles.join(','), regions.join(','), item.jobs, item.hits, item.failed));
  }
  // D1 runs a batch as one call: 2,000 feeds stay one request's worth of queries.
  for (let i = 0; i < statements.length; i += 500) {
    const chunk = statements.slice(i, i + 500);
    if (env.STATS.batch) await env.STATS.batch(chunk); else for (const statement of chunk) await statement.run();
  }
  return Response.json({ok: true, feeds: feeds.length, nofeed: nofeed.length, boards: boards.length});
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
      how: {}, jobs: 0, hits: 0, failed_installs: 0, site: null, quiet_roles: {}, quiet_regions: {}};
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
    } else if (!row.failed && row.jobs > 0 && row.hits === 0) {   // read fine, jobs listed, none for this role here (7 Oct 2026)
      for (const role of row.roles.split(',').filter(Boolean)) feed.quiet_roles[role] = (feed.quiet_roles[role] || 0) + 1;
      for (const region of row.regions.split(',').filter(Boolean)) feed.quiet_regions[region] = (feed.quiet_regions[region] || 0) + 1;
    }
    feeds.set(key, feed);
  }
  const dead = (await env.STATS.prepare('SELECT key, company, host, COUNT(*) AS installs, MAX(day) AS last FROM nofeed GROUP BY key LIMIT 20000').all()).results || [];
  // Per board and role kind / region: installs that read it, installs it gave a match, jobs matched, failed reads.
  const boards = {};
  for (const row of (await env.STATS.prepare('SELECT board, roles, regions, jobs, hits, failed FROM board_reads LIMIT 50000').all()).results || []) {
    const board = boards[row.board] ||= {board: row.board, installs: 0, matched_installs: 0, hits: 0, failed_installs: 0, roles: {}, regions: {}};
    board.installs++;
    board.failed_installs += row.failed;
    board.hits += row.hits || 0;
    if (row.hits > 0) board.matched_installs++;
    for (const [tags, into] of [[row.roles, board.roles], [row.regions, board.regions]]) {
      for (const tag of tags.split(',').filter(Boolean)) {
        const line = into[tag] ||= {installs: 0, matched: 0};
        line.installs++;
        if (row.hits > 0) line.matched++;
      }
    }
  }
  return Response.json({ok: true, feeds: [...feeds.values()], nofeed: dead, boards: Object.values(boards)}, {headers: {'Cache-Control': 'no-store'}});
}

// Daily: rows older than KEEP_DAYS are dropped.
export async function purge(env, now = new Date()) {
  if (!env.STATS) return;
  const oldest = day(new Date(now.getTime() - KEEP_DAYS * 86400000));
  await env.STATS.prepare('DELETE FROM contributions WHERE day < ?').bind(oldest).run();
  await env.STATS.prepare('DELETE FROM nofeed WHERE day < ?').bind(oldest).run();
  await env.STATS.prepare('DELETE FROM board_reads WHERE day < ?').bind(oldest).run();
}
