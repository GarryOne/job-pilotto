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
const SUMMARY_KEY = 'index:summary';   // the website's two counts, written at every publish (the old single-value copy stops once the list outgrows it)
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
export const KINDS = ['software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];
const countriesOf = list => (Array.isArray(list) ? [...new Set(list.filter(c => COUNTRIES.includes(c)))] : []);
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
      ...(countriesOf(item.countries).length ? {countries: countriesOf(item.countries)} : {}),   // where its jobs are (src/scout_index.py), fixed ids only
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
  const nofeed = JSON.parse((await env.WAITLIST?.get(NOFEED_KEY)) || '[]').filter(item => !/^e2e/.test(item?.key || ''));   // stored before the filter
  const boards = JSON.parse((await env.WAITLIST?.get(BOARDS_KEY)) || '[]');
  const sites = await agreedSites(env);
  const generated = (await env.WAITLIST?.get(GENERATED_KEY)) || rows.reduce((last, row) => (row.generated > last ? row.generated : last), '');   // the publish's own time: rows a publish left unchanged keep an older one
  return JSON.stringify({version: 2, generated, regions, feeds: rows.map(row => JSON.parse(row.body)), nofeed, boards, ...(sites.length ? {sites} : {})});
}

// Facts about sites that at least SITES_K installs shared in the last 90 days (src/pool.js sitefacts): a company's job page, a site only a
// browser reads, a dead page. Counted, never who: only facts several installs agree on go out (the learned layer's k >= 3 rule).
export const SITES_K = 3;
const fact = (row, relevant) => ({host: row.host, kind: row.kind, ...(row.url ? {url: row.url} : {}), ...(row.body ? {recipe: JSON.parse(row.body)} : {}),
  installs: row.installs, ...(relevant?.length ? {relevant} : {})});
export async function agreedSites(env, k = SITES_K) {
  if (!env.STATS) return [];
  try {
    const rows = (await env.STATS.prepare(`SELECT host, kind, url, body, COUNT(DISTINCT install) AS installs FROM sitefacts GROUP BY host, kind, url, body
      HAVING installs >= ? ORDER BY installs DESC LIMIT 3000`).bind(k).all()).results || [];
    const cells = rows.some(row => row.kind === 'board') ? await boardCells(env, k) : {};
    const facts = rows.map(row => fact(row, row.kind === 'board' ? cells[row.host] : null));
    if (env.POOL_LAYOUTS === 'off') return facts.filter(item => item.kind !== 'layout');   // the kill switch for shared layouts
    return facts;
  } catch { return []; }   // the table before its migration: nothing to serve yet
}

// What each job board gave the installs that read it, per role family × country (src/contribute.py site_facts 'yield', PR 6 of
// docs/superpowers/specs/2026-10-18-search-learns-sources.md): jobs in their places and fit 70+, summed. A cell goes out only when k installs
// share it (one install's numbers never do); an install's countries count only where the board serves. Installs rank the boards by it.
async function boardCells(env, k) {
  let rows;
  try {
    rows = (await env.STATS.prepare(`SELECT host, body, in_places, fit70, countries, families FROM sitefacts WHERE kind = 'board' AND in_places IS NOT NULL`).all()).results || [];
  } catch { return {}; }   // before migration 0094
  const cells = {}, list = text => String(text || '').split(',').filter(Boolean);
  for (const row of rows) {
    let serves;
    try { serves = JSON.parse(row.body || '{}').countries || []; } catch { serves = []; }
    for (const family of list(row.families)) {
      for (const country of list(row.countries).filter(c => serves.includes(c))) {
        const cell = ((cells[row.host] ||= {})[`${family}|${country}`] ||= {family, country, installs: 0, in_places: 0, fit70: 0});
        cell.installs += 1;
        cell.in_places += row.in_places || 0;
        cell.fit70 += row.fit70 || 0;
      }
    }
  }
  return Object.fromEntries(Object.entries(cells).map(([host, byCell]) => [host, Object.values(byCell).filter(cell => cell.installs >= k)
    .sort((a, b) => a.family.localeCompare(b.family) || a.country.localeCompare(b.country))]));
}

async function download(request, env, now = new Date()) {
  const regions = regionsOf(request);
  const stored = (regions && await slice(env, regions)) || await env.WAITLIST.get(KEY);
  if (!stored) return text(404, JSON.stringify({ok: false, error: 'No index published yet'}), {'Content-Type': 'application/json'});
  if (new URL(request.url).searchParams.get('summary') === '1') {
    const counts = (!regions && await env.WAITLIST.get(SUMMARY_KEY)) || JSON.stringify(summary(stored));
    return text(200, counts, {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'});
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
  await env.WAITLIST?.put(SUMMARY_KEY, JSON.stringify(summary(feeds)));
  // "No readable job site", checked here like everything published: a key, a name, a host, a date.
  // Test employers ("E2E Ghost", 7 Oct 2026) are never published, whatever reached the central scout.
  const nofeed = (Array.isArray(body.nofeed) ? body.nofeed : []).filter(item => item && /^[a-z0-9]{1,120}$/.test(item.key || '') && !/^e2e/.test(item.key) && /^\d{4}-\d{2}-\d{2}$/.test(item.last || ''))
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

// Is a feed worth rewriting? (14 Oct 2026: 11.7k feed writes a day, 23k rows, though most feeds only had a new "checked"/"ok" date or a drifting job count.)
// Rewritten when anything else changed, a date moved 7+ days past the stored one, a count crossed zero or moved more than 25%, or failing started or stopped.
const DATES_DAYS = 7, COUNT_SHARE = 0.25;
const stablePart = feed => JSON.stringify({...feed, checked: undefined, jobs: undefined, relevant: undefined,
  fresh: feed.fresh ? {failing: (feed.fresh.fails || 0) > 0, trend: feed.fresh.trend, new: feed.fresh.new} : undefined});
const daysApart = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 86400000 : a === b ? 0 : Infinity);
const countMoved = (a, b) => ((a || 0) === 0) !== ((b || 0) === 0) || Math.abs((b || 0) - (a || 0)) > COUNT_SHARE * Math.max(a || 0, b || 0);
export function worthWriting(stored, feed) {
  if (!stored) return true;
  if (stablePart(stored) !== stablePart(feed)) return true;
  if (daysApart(stored.checked, feed.checked) >= DATES_DAYS || daysApart(stored.fresh?.ok, feed.fresh?.ok) >= DATES_DAYS) return true;
  return countMoved(stored.jobs, feed.jobs) || countMoved(stored.relevant, feed.relevant) || countMoved(stored.fresh?.jobs, feed.fresh?.jobs);
}

// Make the D1 index this list, writing only what differs (11 Oct 2026: a full rewrite of ~4.3k feeds, three times a day, wrote 8.5k rows a time and spent a quarter of the free plan's daily
// writes): one read of the stored feeds, then an INSERT for a feed that is new or whose body changed, a DELETE for one no longer listed. A same-list publish writes nothing.
// In batches (D1 runs a batch as one transaction).
const parsed = text => { try { return JSON.parse(text); } catch { return null; } };
const regionsOf_ = feed => `,${feed.regions.join(',')}${feed.regions.length ? ',' : ''}`;
async function store(db, feeds, generated) {
  const old = new Map((((await db.prepare('SELECT ats, slug, regions, body FROM index_feeds').all()).results) || []).map(row => [`${row.ats}\n${row.slug}`, row]));
  const statements = [], keep = new Set();
  for (const feed of feeds) {
    const key = `${feed.ats}\n${feed.slug}`, body = JSON.stringify(feed), regions = regionsOf_(feed), was = old.get(key);
    keep.add(key);
    if (was && was.regions === regions && (was.body === body || !worthWriting(parsed(was.body), feed))) continue;
    // An upsert, not INSERT OR REPLACE: a replace is a delete plus an insert (2 rows written per feed, 14 Oct 2026).
    statements.push(db.prepare('INSERT INTO index_feeds (ats, slug, regions, body, generated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ats, slug) DO UPDATE SET regions = excluded.regions, body = excluded.body, generated = excluded.generated')
      .bind(feed.ats, feed.slug, regions, body, generated));
  }
  for (const [key, row] of old) if (!keep.has(key)) statements.push(db.prepare('DELETE FROM index_feeds WHERE ats = ? AND slug = ?').bind(row.ats, row.slug));
  if (!statements.length) return 0;
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return statements.length;
}

export function index(request, env) {
  if (request.method === 'GET' || request.method === 'HEAD') return download(request, env);
  if (request.method === 'PUT') return publish(request, env);
  return text(405, 'Use GET', {Allow: 'GET, HEAD, PUT'});
}
