// "Help the pool grow" (opt-out, on by default, docs/superpowers/specs/2026-09-30-pool-contributions.md): POST /api/contribute takes the
// employer career pages an app uses, tagged with coarse fixed-list roles and regions; GET /api/contributions (Bearer
// INDEX_PUBLISH_KEY, the central scout only) gives the aggregate. Nothing here can identify a person: the install id is
// hashed, and a feed's tags are only ever published from many installs (the scout's threshold).
import {COUNTRIES, METROS, FAMILIES} from './pool-tags.js';

const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join', 'workday', 'umantis', 'successfactors', 'careers', 'amazon', 'netflix', 'jobsch'];
export const ROLES = ['software', 'sre_devops', 'data', 'security', 'mobile', 'qa', 'management', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];   // src/contribute.py: IT families, then src/role_kinds.py's other trades
export const REGIONS = ['europe', 'north_america', 'latin_america', 'asia_pacific', 'middle_east_africa', 'remote'];
const MAX_FEEDS = 2000, MAX_NOFEED = 300, MAX_BOARDS = 30, KEEP_DAYS = 90, PER_MINUTE = 30;   // installs share each find as it is made (owner, 6 Oct 2026): many small shares; every feed a check read (7 Oct 2026)
// Outcome counts (src/contribute.py outcomes): only these names, only whole numbers; anything else is dropped.
const STEPS = ['strong', 'saved', 'applied', 'interview', 'offer', 'remote'];
const LANGS = ['English', 'German', 'French', 'Italian', 'Spanish', 'Portuguese', 'Dutch', 'Other'];
const SENIORITY = ['junior', 'mid', 'senior', 'staff_principal', 'lead_manager'];
function outOf(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const step of STEPS) if (count(value[step])) out[step] = count(value[step]);
  for (const [field, names] of [['langs', LANGS], ['senior', SENIORITY]]) {
    const kept = Object.fromEntries(names.filter(name => count(value[field]?.[name])).map(name => [name, count(value[field][name])]));
    if (Object.keys(kept).length) out[field] = kept;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
// How many outcome names or values in `out` are not kept (unknown names, not whole numbers).
function outDrops(value) {
  if (!value || typeof value !== 'object') return 1;
  const kept = JSON.parse(outOf(value) || '{}');
  let n = 0;
  for (const [key, inner] of Object.entries(value)) {
    if (['langs', 'senior'].includes(key) && inner && typeof inner === 'object') n += Object.keys(inner).filter(tag => !(kept[key] || {})[tag]).length;
    else if (!(key in kept) && inner) n++;
  }
  return n;
}
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
  // What this endpoint drops is counted and said in the reply, so a naming drift between engine and site shows as a warning in the app's log
  // instead of looking like "no data yet" (7 Oct 2026). Counts only.
  const dropped = {};
  const drop = (what, n = 1) => { if (n > 0) dropped[what] = (dropped[what] || 0) + n; };
  const labels = (list, allowed, what) => { const kept = pick(list, allowed); drop(what, new Set(Array.isArray(list) ? list : []).size - kept.length); return kept; };
  const roles = labels(body.roles, ROLES, 'roles'), regions = labels(body.regions, REGIONS, 'regions');
  const fine = [labels(body.countries, COUNTRIES, 'countries'), labels(body.metros, METROS, 'metros'), labels(body.families, FAMILIES, 'families')].map(list => list.join(','));   // finer labels (7 Oct 2026)
  const seen = new Set(), feeds = [];
  for (const item of (Array.isArray(body.feeds) ? body.feeds : []).slice(0, MAX_FEEDS)) {
    if (!item || !SYSTEMS.includes(item.ats) || typeof item.slug !== 'string' || !/^[\w.-]{1,120}$/.test(item.slug)) { drop('feeds'); continue; }
    if (typeof item.company !== 'string' || !item.company.trim() || seen.has(`${item.ats}:${item.slug}`)) { drop('feeds'); continue; }
    if (item.how && !HOW.includes(item.how)) drop('how');
    if (item.out) drop('out', outDrops(item.out));
    seen.add(`${item.ats}:${item.slug}`);
    feeds.push({ats: item.ats, slug: item.slug, company: item.company.trim().slice(0, 120), matched: item.matched ? 1 : 0, own: item.own ? 1 : 0,
      how: HOW.includes(item.how) ? item.how : null, jobs: count(item.jobs), hits: count(item.hits), site: siteOf(item.site), failed: item.failed ? 1 : 0, out: outOf(item.out)});
  }
  // "No readable job site" (v2): a company name and its website host, both checked; the same key as the scout's (src/scout.py key_for).
  const nofeed = [], keys = new Set();
  for (const item of (Array.isArray(body.nofeed) ? body.nofeed : []).slice(0, MAX_NOFEED)) {
    const company = typeof item?.company === 'string' ? item.company.trim().slice(0, 120) : '';
    const key = company.toLowerCase().replace(/\b(ag|sa|gmbh|ltd|inc|llc|plc)\b/g, '').replace(/[^a-z0-9]/g, '');
    if (!key || keys.has(key)) { if (!key) drop('nofeed'); continue; }
    keys.add(key);
    nofeed.push({key, company, host: typeof item.host === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item.host) ? item.host.slice(0, 100) : null});
  }
  const boards = [], named = new Set();
  for (const item of (Array.isArray(body.boards) ? body.boards : []).slice(0, MAX_BOARDS)) {
    if (!BOARDS.includes(item?.board) || named.has(item.board)) { drop('boards'); continue; }
    if (item.out) drop('out', outDrops(item.out));
    named.add(item.board);
    boards.push({board: item.board, jobs: count(item.jobs), hits: count(item.hits), dup: count(item.dup), failed: item.failed ? 1 : 0, out: outOf(item.out)});
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
  const statements = feeds.map(feed => env.STATS.prepare(`INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, how, jobs, hits, site, failed, out_json, countries, metros, families)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install, ats, slug) DO UPDATE SET company = excluded.company,
      matched = CASE WHEN day = excluded.day THEN MAX(matched, excluded.matched) ELSE excluded.matched END,
      own = CASE WHEN day = excluded.day THEN MAX(own, excluded.own) ELSE excluded.own END, day = excluded.day,
      roles = excluded.roles, regions = excluded.regions, countries = excluded.countries, metros = excluded.metros, families = excluded.families, how = COALESCE(how, excluded.how), jobs = COALESCE(excluded.jobs, jobs),
      hits = COALESCE(excluded.hits, hits), site = COALESCE(excluded.site, site), failed = excluded.failed, out_json = COALESCE(excluded.out_json, out_json)`)
    .bind(install, today, feed.ats, feed.slug, feed.company, feed.matched, feed.own, roles.join(','), regions.join(','), feed.how, feed.jobs, feed.hits,
      feed.site, feed.failed, feed.out, ...fine));
  for (const item of nofeed) {
    statements.push(env.STATS.prepare('INSERT INTO nofeed (install, day, key, company, host) VALUES (?, ?, ?, ?, ?) ON CONFLICT(install, key) DO UPDATE SET day = excluded.day, host = COALESCE(excluded.host, host)')
      .bind(install, today, item.key, item.company, item.host));
  }
  for (const item of boards) {
    statements.push(env.STATS.prepare(`INSERT INTO board_reads (install, day, board, roles, regions, jobs, hits, failed, dup, out_json, countries, metros, families) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(install, board) DO UPDATE SET day = excluded.day, roles = excluded.roles, regions = excluded.regions, countries = excluded.countries,
      metros = excluded.metros, families = excluded.families, jobs = excluded.jobs,
      hits = excluded.hits, failed = excluded.failed, dup = excluded.dup, out_json = COALESCE(excluded.out_json, out_json)`)
      .bind(install, today, item.board, roles.join(','), regions.join(','), item.jobs, item.hits, item.failed, item.dup, item.out, ...fine));
  }
  // D1 runs a batch as one call: 2,000 feeds stay one request's worth of queries.
  for (let i = 0; i < statements.length; i += 500) {
    const chunk = statements.slice(i, i + 500);
    if (env.STATS.batch) await env.STATS.batch(chunk); else for (const statement of chunk) await statement.run();
  }
  return Response.json({ok: true, feeds: feeds.length, nofeed: nofeed.length, boards: boards.length, ...(Object.keys(dropped).length ? {dropped} : {})});
}

// Per feed: how many different installs sent it, how many found jobs there, and among those the roles / regions. Added up in SQL and paged
// (`?part=feeds|nofeed|boards&after=<cursor>`, `next` until null), so the answer never truncates as installs grow (7 Oct 2026; it read 50,000 rows).
const PAGE = 2000;
const TAGS = ['roles', 'regions', 'countries', 'metros', 'families'];   // the label kinds every share carries
export async function aggregate(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!env.INDEX_PUBLISH_KEY || given.length !== env.INDEX_PUBLISH_KEY.length || given !== env.INDEX_PUBLISH_KEY || !env.STATS) {
    return new Response('Not found', {status: 404});
  }
  const url = new URL(request.url), part = url.searchParams.get('part') || 'feeds', after = url.searchParams.get('after') || '';
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get('limit')) || PAGE));
  const db = env.STATS, rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  const headers = {'Cache-Control': 'no-store'};
  if (part === 'nofeed') {
    const dead = await rows('SELECT key, MAX(company) AS company, MAX(host) AS host, COUNT(*) AS installs, MAX(day) AS last FROM nofeed WHERE key > ? GROUP BY key ORDER BY key LIMIT ?', after, limit);
    return Response.json({ok: true, nofeed: dead, next: dead.length === limit ? dead.at(-1).key : null}, {headers});
  }
  if (part === 'boards') return Response.json({ok: true, boards: await boardTotals(rows), next: null}, {headers});
  const [afterAts = '', afterSlug = ''] = after ? [after.slice(0, after.indexOf(':')), after.slice(after.indexOf(':') + 1)] : [];
  const page = await rows(`SELECT ats, slug, MAX(company) AS company, COUNT(*) AS installs, SUM(matched) AS matched_installs, SUM(own) AS own_installs,
      MAX(COALESCE(jobs, 0)) AS jobs, SUM(COALESCE(hits, 0)) AS hits, SUM(failed) AS failed_installs, MAX(site) AS site
    FROM contributions WHERE (ats, slug) > (?, ?) GROUP BY ats, slug ORDER BY ats, slug LIMIT ?`, afterAts, afterSlug, limit);
  if (!page.length) return Response.json({ok: true, feeds: [], next: null, ...(after ? {} : {boards: await boardTotals(rows)})}, {headers});
  const first = page[0], last = page.at(-1), range = [first.ats, first.slug, last.ats, last.slug];
  const feeds = new Map(page.map(row => [`${row.ats}:${row.slug}`, {...row, site: row.site || null, how: {},
    ...Object.fromEntries(TAGS.flatMap(tag => [[tag, {}], [`quiet_${tag}`, {}]]))}]));
  const inRange = 'WHERE (ats, slug) >= (?, ?) AND (ats, slug) <= (?, ?)';
  for (const row of await rows(`SELECT ats, slug, how, COUNT(*) AS n FROM contributions ${inRange} AND how IS NOT NULL GROUP BY ats, slug, how`, ...range)) {
    const feed = feeds.get(`${row.ats}:${row.slug}`);
    if (feed) feed.how[row.how] = row.n;   // which discovery routes find employers, across installs
  }
  // Roles / regions among installs that found jobs there; "quiet": read fine, jobs listed, none for this role here.
  for (const row of await rows(`SELECT ats, slug, ${TAGS.join(', ')}, SUM(matched) AS matched,
      SUM(CASE WHEN matched = 0 AND failed = 0 AND jobs > 0 AND hits = 0 THEN 1 ELSE 0 END) AS quiet
    FROM contributions ${inRange} GROUP BY ats, slug, ${TAGS.join(', ')}`, ...range)) {
    const feed = feeds.get(`${row.ats}:${row.slug}`);
    if (!feed) continue;
    for (const field of TAGS) {
      for (const [into, n] of [[feed[field], row.matched], [feed[`quiet_${field}`], row.quiet]]) {
        if (n) for (const tag of String(row[field] || '').split(',').filter(Boolean)) into[tag] = (into[tag] || 0) + n;
      }
    }
  }
  await addOutcomes(rows, 'contributions', `${inRange}`, range, row => feeds.get(`${row.ats}:${row.slug}`), 'ats, slug');
  return Response.json({ok: true, feeds: [...feeds.values()], next: page.length === limit ? `${last.ats}:${last.slug}` : null,
    ...(after ? {} : {boards: await boardTotals(rows)})}, {headers});
}

// Outcome totals into each item's `out` ({strong, saved, applied, interview, offer, remote, langs, senior}), summed across installs in SQL.
async function addOutcomes(rows, table, where, args, itemOf, keys) {
  const sums = STEPS.map(step => `SUM(COALESCE(json_extract(out_json, '$.${step}'), 0)) AS ${step}`).join(', ');
  for (const row of await rows(`SELECT ${keys}, ${sums} FROM ${table} ${where} GROUP BY ${keys}`, ...args)) {
    const item = itemOf(row);
    if (item) item.out = Object.fromEntries(STEPS.map(step => [step, row[step] || 0]));
  }
  for (const field of ['langs', 'senior']) {
    for (const row of await rows(`SELECT ${keys}, t.key AS tag, SUM(t.value) AS n FROM ${table}, json_each(${table}.out_json, '$.${field}') AS t ${where} GROUP BY ${keys}, t.key`, ...args)) {
      const item = itemOf(row);
      if (item) (item.out[field] ||= {})[row.tag] = row.n;
    }
  }
}

// Per board and role kind / region: installs that read it, installs it gave a match, jobs matched, failed reads (few rows: a dozen boards).
async function boardTotals(rows) {
  const boards = {};
  for (const row of await rows(`SELECT board, ${TAGS.join(', ')}, COUNT(*) AS installs, SUM(CASE WHEN hits > 0 THEN 1 ELSE 0 END) AS matched,
      SUM(COALESCE(hits, 0)) AS hits, SUM(COALESCE(dup, 0)) AS dup, SUM(failed) AS failed FROM board_reads GROUP BY board, ${TAGS.join(', ')}`)) {
    const board = boards[row.board] ||= {board: row.board, installs: 0, matched_installs: 0, hits: 0, dup: 0, failed_installs: 0, ...Object.fromEntries(TAGS.map(tag => [tag, {}]))};
    board.dup += row.dup;   // matches from employers whose own feed was read too: hits - dup is what the board alone brought
    board.installs += row.installs;
    board.matched_installs += row.matched;
    board.hits += row.hits;
    board.failed_installs += row.failed;
    for (const field of TAGS) {
      const into = board[field];
      for (const tag of String(row[field] || '').split(',').filter(Boolean)) {
        const line = into[tag] ||= {installs: 0, matched: 0};
        line.installs += row.installs;
        line.matched += row.matched;
      }
    }
  }
  await addOutcomes(rows, 'board_reads', '', [], row => boards[row.board], 'board');
  return Object.values(boards);
}

// Daily, before the purge: the day's totals per source (all employer feeds, or each board) and segment (role kind × country), kept for good.
// Rows are refreshed at least daily by every sharing install (src/contribute.py REFRESH), so "touched in the last day" is who was active.
export async function rollup(env, now = new Date()) {
  if (!env.STATS) return 0;
  const since = day(new Date(now.getTime() - 86400000)), today = day(now);
  const rows = async sql => (await env.STATS.prepare(sql).bind(since).all()).results || [];
  const outcome = step => `SUM(COALESCE(json_extract(out_json, '$.${step}'), 0)) AS ${step}`;
  const groups = [
    ...(await rows(`SELECT 'feeds' AS source, roles, countries, COUNT(DISTINCT install) AS installs, COUNT(DISTINCT CASE WHEN matched = 1 THEN install END) AS matched,
        SUM(COALESCE(hits, 0)) AS hits, 0 AS dup, ${['strong', 'applied', 'interview', 'offer'].map(outcome).join(', ')}
      FROM contributions WHERE day >= ? GROUP BY roles, countries`)),
    ...(await rows(`SELECT board AS source, roles, countries, COUNT(*) AS installs, SUM(CASE WHEN hits > 0 THEN 1 ELSE 0 END) AS matched,
        SUM(COALESCE(hits, 0)) AS hits, SUM(COALESCE(dup, 0)) AS dup, ${['strong', 'applied', 'interview', 'offer'].map(outcome).join(', ')}
      FROM board_reads WHERE day >= ? GROUP BY board, roles, countries`)),
  ];
  const totals = new Map();
  for (const group of groups) {
    for (const role of String(group.roles || 'other').split(',').filter(Boolean)) {
      for (const country of String(group.countries || '').split(',')) {   // '' = no country named: still counted
        const key = `${group.source}|${role}|${country}`;
        const line = totals.get(key) || {source: group.source, role, country, installs: 0, matched: 0, hits: 0, dup: 0, strong: 0, applied: 0, interview: 0, offer: 0};
        for (const field of ['installs', 'matched', 'hits', 'dup', 'strong', 'applied', 'interview', 'offer']) line[field] += group[field] || 0;
        totals.set(key, line);
      }
    }
  }
  const statements = [...totals.values()].map(line => env.STATS.prepare(`INSERT OR REPLACE INTO pool_daily (day, source, role, country, installs, matched, hits, dup, strong, applied, interview, offer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(today, line.source, line.role, line.country, line.installs, line.matched, line.hits, line.dup, line.strong, line.applied, line.interview, line.offer));
  for (let i = 0; i < statements.length; i += 500) {
    const chunk = statements.slice(i, i + 500);
    if (env.STATS.batch) await env.STATS.batch(chunk); else for (const statement of chunk) await statement.run();
  }
  return statements.length;
}

// Daily: rows older than KEEP_DAYS are dropped.
export async function purge(env, now = new Date()) {
  if (!env.STATS) return;
  const oldest = day(new Date(now.getTime() - KEEP_DAYS * 86400000));
  await env.STATS.prepare('DELETE FROM contributions WHERE day < ?').bind(oldest).run();
  await env.STATS.prepare('DELETE FROM nofeed WHERE day < ?').bind(oldest).run();
  await env.STATS.prepare('DELETE FROM board_reads WHERE day < ?').bind(oldest).run();
}
