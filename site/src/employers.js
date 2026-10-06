// The central employer index: GET /api/index is what every app and Always-on run downloads, with an install token (POST /api/install-token
// {install, purpose: 'index'}) and at most INDEX_PER_INSTALL_PER_DAY times a day; GET /api/index?summary=1 is public and holds only the counts;
// PUT /api/index (Bearer INDEX_PUBLISH_KEY) is the private central scout (repo GarryOne/job-pilotto-internal) publishing it.
// Product data only: feeds, quality, last verified. Nothing about any user. Stored as one KV value (binding WAITLIST).
import {REGIONS, ROLES} from './pool.js';
import {COUNTRIES, FAMILIES, METROS} from './pool-tags.js';
import {authorize, digestOf, equal, flag} from './guard.js';
import {store as storeScouting} from './scouting.js';
import {snapshot, storeSnapshot} from './scoutingadmin.js';
const KEY = 'index:employers';
const NOFEED_KEY = 'index:nofeed';
const GENERATED_KEY = 'index:generated';   // when the central scout last published: installs ask "still this one?" hourly, answered from KV alone
const BOARDS_KEY = 'index:boards';   // per job board, what it gives people by role, family and place (src/scout.py board_stats): installs order the boards they suggest   // employers with no readable job site, published by the central scout: installs skip them 30 days
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join', 'workday', 'umantis', 'successfactors', 'careers', 'amazon', 'netflix', 'jobsch'];
const MAX_BYTES = 1_000_000;          // the KV copy older app versions download (one KV value)
const MAX_PUBLISH_BYTES = 20_000_000; // what the central scout may send: D1 holds far more feeds than one KV value
const MAX_FEEDS = 60000;
const MAX_PLACES = 40;   // where a feed has roles: clients skip feeds with none in their own places

const text = (status, body, headers = {}) => new Response(body, {status, headers});

const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : null;

// kind: an employer's own career page, or a job portal (counted apart on the website).
// Who a feed fits (fixed lists only): the scout publishes a tag only when many installs agree.
// How to read a careers page without AI (src/sources/page_recipes.py), checked to the same fixed shape: never a pattern, only a path or a tag and class.
const TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'a', 'strong', 'b', 'span', 'div', 'p', 'td', 'dt'];
export function recipeOf(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  const keys = Object.keys(recipe).sort().join(',');
  if (recipe.kind === 'links' && keys === 'kind,prefix' && typeof recipe.prefix === 'string' && /^(\/[\w.%~-]+){0,6}$/.test(recipe.prefix)) return {kind: 'links', prefix: recipe.prefix};
  if (recipe.kind === 'tag' && keys === 'class,kind,tag' && TAGS.includes(recipe.tag) && typeof recipe.class === 'string' && /^[\w -]{1,60}$/.test(recipe.class)) return {kind: 'tag', tag: recipe.tag, class: recipe.class};
  return null;
}
// What a feed hires for: {kind: share}, fixed kinds only (src/role_kinds.py KINDS, checked equal by tests/test_role_kinds.py), shares 0–1.
export const KINDS = ['software', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];
export const kindsOf = kinds => {
  if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) return null;
  const out = Object.fromEntries(Object.entries(kinds).filter(([kind, share]) => KINDS.includes(kind) && typeof share === 'number' && share >= 0 && share <= 1)
    .map(([kind, share]) => [kind, Math.round(share * 100) / 100]));
  return Object.keys(out).length ? out : null;
};
// How fresh a feed is (src/scout.py health): fixed fields only, dates and small numbers.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const freshOf = fresh => {
  if (!fresh || typeof fresh !== 'object') return null;
  const out = {ok: DAY.test(fresh.ok || '') ? fresh.ok : null, fails: number(fresh.fails, 1000) ?? 0, jobs: number(fresh.jobs, 100000) ?? 0,
    trend: ['up', 'flat', 'down'].includes(fresh.trend) ? fresh.trend : 'flat', new: DAY.test(fresh.new || '') ? fresh.new : null};
  return out.ok ? out : null;
};
const LISTS = {roles: ROLES, regions: REGIONS, countries: COUNTRIES, metros: METROS, families: FAMILIES};
const tagsOf = (value, names) => Object.fromEntries(names.map(name => [name, (Array.isArray(value?.[name]) ? value[name] : []).filter(tag => LISTS[name].includes(tag))])
  .filter(([name, tags]) => tags.length || ['roles', 'regions'].includes(name)));
// Who a feed fits, and `quiet`: role kinds / families whose installs read it fine and never found a job there (src/scout.py fits).
const fitsOf = fits => {
  const quiet = tagsOf(fits?.quiet, ['roles', 'families']);
  return {...tagsOf(fits, Object.keys(LISTS)), ...(Object.values(quiet).some(tags => tags.length) ? {quiet} : {})};
};
// What a feed led to across installs (published past 3 installs): small whole numbers only.
const poolOf = pool => (pool && typeof pool === 'object' && number(pool.installs, 1e6) >= 3
  ? {installs: number(pool.installs, 1e6), matched: number(pool.matched, 1e6) ?? 0, applied: number(pool.applied, 1e6) ?? 0, interview: number(pool.interview, 1e6) ?? 0} : null);
const BOARD_IDS = ['jobsch', 'arbeitnow', 'himalayas', 'jobicy', 'adzuna', 'jooble', 'google_jobs', 'alerts_linkedin', 'alerts_jobsch', 'alerts_jobup', 'alerts_indeed', 'alerts_glassdoor'];
export function boardsOf(boards) {
  return (Array.isArray(boards) ? boards : []).filter(item => item && BOARD_IDS.includes(item.board)).slice(0, 30).map(item => ({
    board: item.board, installs: number(item.installs, 1e6) ?? 0, matched: number(item.matched, 1e6) ?? 0,
    by: Object.fromEntries(Object.keys(LISTS).map(name => [name, Object.fromEntries(Object.entries(item.by?.[name] || {})
      .filter(([tag, pair]) => LISTS[name].includes(tag) && Array.isArray(pair) && number(pair[0], 1e6) >= 3).map(([tag, pair]) => [tag, [number(pair[0], 1e6), number(pair[1], 1e6) ?? 0]]))]))}));
}

// Only the fields clients read, and only feeds an app knows how to crawl.
export function clean(feeds) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(feeds) ? feeds : []) {
    if (!item || typeof item !== 'object') continue;
    const {company, ats, slug} = item;
    if (!SYSTEMS.includes(ats) || typeof slug !== 'string' || !/^[\w.-]{1,120}$/.test(slug)) continue;
    if (typeof company !== 'string' || !company.trim() || seen.has(`${ats}:${slug}`)) continue;
    seen.add(`${ats}:${slug}`);
    out.push({company: company.trim().slice(0, 120), ats, slug, kind: item.kind === 'board' ? 'board' : 'employer', tier: item.tier === 'Tier 1' ? 'Tier 1' : 'Standard',
      quality: number(item.quality, 100), jobs: number(item.jobs, 100000), relevant: number(item.relevant, 100000),
      checked: /^\d{4}-\d{2}-\d{2}$/.test(item.checked || '') ? item.checked : null,
      fits: fitsOf(item.fits),
      ...(kindsOf(item.kinds) ? {kinds: kindsOf(item.kinds)} : {}),
      ...(freshOf(item.fresh) ? {fresh: freshOf(item.fresh)} : {}),
      ...(poolOf(item.pool) ? {pool: poolOf(item.pool)} : {}),
      regions: Array.isArray(item.regions) ? [...new Set(item.regions.filter(r => REGIONS.includes(r)))] : [],
      places: Array.isArray(item.places) ? item.places.filter(p => typeof p === 'string').map(p => p.slice(0, 60)).slice(0, MAX_PLACES) : [],
      ...(ats === 'careers' && recipeOf(item.recipe) ? {recipe: recipeOf(item.recipe)} : {})});
  }
  return out;
}

async function etag(body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `"${[...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('')}"`;
}

const INDEX_PER_INSTALL_PER_DAY = 24;
const day = date => date.toISOString().slice(0, 10);

// The website's counters: only how many employers and open jobs, never the feeds.
function summary(stored) {
  const feeds = (Array.isArray(stored) ? stored : JSON.parse(stored).feeds) || [];
  const employers = feeds.filter(feed => feed.kind !== 'board');
  return {employers: employers.length, jobs: employers.reduce((sum, feed) => sum + (feed.jobs || 0), 0)};
}

// The regions an install asks for (fixed words, nothing else about it), or null for an older app that asks for the whole list.
function regionsOf(request) {
  const asked = new URL(request.url).searchParams.get('regions');
  if (asked === null) return null;
  return [...new Set(asked.split(',').map(r => r.trim()).filter(r => REGIONS.includes(r)))];
}

// The slice of the D1 index for these regions, plus feeds whose places are unknown; null when D1 holds no index yet.
async function slice(env, regions) {
  if (!env.STATS) return null;
  const where = regions.length ? regions.map(() => 'regions LIKE ?').join(' OR ') + " OR regions = ','" : "regions = ','";
  const rows = (await env.STATS.prepare(`SELECT body, generated FROM index_feeds WHERE ${where} ORDER BY ats, slug`)
    .bind(...regions.map(r => `%,${r},%`)).all()).results || [];
  if (!rows.length) return null;
  const nofeed = JSON.parse((await env.WAITLIST?.get(NOFEED_KEY)) || '[]');
  const boards = JSON.parse((await env.WAITLIST?.get(BOARDS_KEY)) || '[]');
  return JSON.stringify({version: 2, generated: rows[0].generated, regions, feeds: rows.map(row => JSON.parse(row.body)), nofeed, boards});
}

async function download(request, env, now = new Date()) {
  const regions = regionsOf(request);
  const stored = (regions && await slice(env, regions)) || await env.WAITLIST.get(KEY);
  if (!stored) return text(404, JSON.stringify({ok: false, error: 'No index published yet'}), {'Content-Type': 'application/json'});
  if (new URL(request.url).searchParams.get('summary') === '1') {
    return text(200, JSON.stringify(summary(stored)), {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'});
  }
  // The full list is for the owner's scout and for installs that hold a token, a few downloads a day each.
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.INDEX_PUBLISH_KEY && equal(given, env.INDEX_PUBLISH_KEY))) {
    const install = request.headers.get('X-Install-Id') || '';
    const access = await authorize(env, install, given, 'index');
    // INDEX_GATE = "soft" while older app versions (no token yet) update: they still get the list, and are counted. Anything else enforces.
    if (!access.ok && env.INDEX_GATE === 'soft') {
      await flag(env, 'index-open', await digestOf(request.headers.get('CF-Connecting-IP') || 'unknown'), 'no token', now);
      const open = await etag(stored);
      return text(200, request.method === 'HEAD' ? null : stored, {'Content-Type': 'application/json', ETag: open, 'Cache-Control': 'private, max-age=3600'});
    }
    if (!access.ok) return text(401, JSON.stringify({ok: false, error: 'token needed', hint: "POST /api/install-token {install, purpose: 'index'}"}), {'Content-Type': 'application/json'});
    // Still the same publish? One KV read, no database, not counted against the day's downloads (7 Oct 2026: installs check hourly).
    const have = request.headers.get('X-Index-Generated') || '';
    if (have && have === (await env.WAITLIST.get(GENERATED_KEY))) return text(304, null, {'Cache-Control': 'private, max-age=3600'});
    const key = `index-get:${install}:${day(now)}`;
    const used = Number(await env.WAITLIST.get(key)) || 0;
    if (used >= INDEX_PER_INSTALL_PER_DAY) { await flag(env, 'index-quota', access.who, 'index downloads', now); return text(429, JSON.stringify({ok: false, error: 'limit reached for today'}), {'Content-Type': 'application/json'}); }
    await env.WAITLIST.put(key, String(used + 1), {expirationTtl: 2 * 86400});
  }
  const tag = await etag(stored);
  const headers = {'Content-Type': 'application/json', ETag: tag, 'Cache-Control': 'private, max-age=3600'};
  if (request.headers.get('If-None-Match') === tag) return text(304, null, headers);
  return text(200, request.method === 'HEAD' ? null : stored, headers);
}

async function publish(request, env) {
  const key = env.INDEX_PUBLISH_KEY;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!key || !equal(given, key)) return text(404, 'Not found');
  const raw = await request.text();
  if (raw.length > MAX_PUBLISH_BYTES) return text(413, 'Too large');
  let body;
  try { body = JSON.parse(raw); } catch { return text(400, 'Send JSON'); }
  const feeds = clean(body.feeds).slice(0, MAX_FEEDS);
  if (!feeds.length) return text(400, 'No valid feeds');
  // A broken scout run must not wipe the list everyone downloads: a sudden loss of more than half is refused.
  const inD1 = env.STATS ? ((await env.STATS.prepare('SELECT COUNT(*) AS n FROM index_feeds').first())?.n || 0) : 0;
  const previous = Math.max(inD1, JSON.parse((await env.WAITLIST.get(KEY)) || '{"feeds":[]}').feeds.length);
  if (previous >= 10 && feeds.length < previous / 2) return text(409, `Refused: ${feeds.length} feeds would replace ${previous}`);
  const generated = new Date().toISOString();
  if (env.STATS) await store(env.STATS, feeds, generated);
  await env.WAITLIST?.put(GENERATED_KEY, generated);
  // "No readable job site", checked here like everything published: a key, a name, a host, a date.
  const nofeed = (Array.isArray(body.nofeed) ? body.nofeed : []).filter(item => item && /^[a-z0-9]{1,120}$/.test(item.key || '') && /^\d{4}-\d{2}-\d{2}$/.test(item.last || ''))
    .slice(0, 5000).map(item => ({key: item.key, company: String(item.company || '').slice(0, 120), host: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item.host || '') ? item.host : null, last: item.last}));
  if (env.WAITLIST) await env.WAITLIST.put(NOFEED_KEY, JSON.stringify(nofeed));
  if (env.WAITLIST && Array.isArray(body.boards)) await env.WAITLIST.put(BOARDS_KEY, JSON.stringify(boardsOf(body.boards)));
  // The day's snapshot for /admin/scouting's growth: counts only; never a reason to refuse the index.
  if (env.STATS) {
    const pooled = new Set(((await env.STATS.prepare("SELECT DISTINCT ats || ':' || slug AS k FROM contributions WHERE how IS NOT NULL AND how NOT IN ('index', 'own')").all().catch(() => ({results: []}))).results || []).map(row => row.k));
    await storeSnapshot(env.STATS, generated.slice(0, 10), snapshot(feeds, feeds.filter(feed => pooled.has(`${feed.ats}:${feed.slug}`)).length, nofeed.length)).catch(() => false);
  }
  // The central scout's own numbers for /intel (src/scouting.js): never a reason to refuse the index.
  if (env.STATS && body.stats) await storeScouting(env.STATS, body.stats, generated.slice(0, 10)).catch(() => false);
  // Older app versions download the whole list from KV: kept while it fits in one value, else left as it was (they update soon).
  const legacy = JSON.stringify({version: 1, generated, feeds});
  const kept = legacy.length <= MAX_BYTES;
  if (kept) await env.WAITLIST.put(KEY, legacy);
  return Response.json({ok: true, feeds: feeds.length, d1: !!env.STATS, legacy: kept ? 'updated' : 'too large, unchanged'});
}

// Replace the D1 index with this list, in batches (D1 runs a batch as one transaction).
async function store(db, feeds, generated) {
  const statements = [db.prepare('DELETE FROM index_feeds')];
  for (const feed of feeds) {
    statements.push(db.prepare('INSERT OR REPLACE INTO index_feeds (ats, slug, regions, body, generated) VALUES (?, ?, ?, ?, ?)')
      .bind(feed.ats, feed.slug, `,${feed.regions.join(',')}${feed.regions.length ? ',' : ''}`, JSON.stringify(feed), generated));
  }
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
}

export function index(request, env) {
  if (request.method === 'GET' || request.method === 'HEAD') return download(request, env);
  if (request.method === 'PUT') return publish(request, env);
  return text(405, 'Use GET', {Allow: 'GET, HEAD, PUT'});
}
