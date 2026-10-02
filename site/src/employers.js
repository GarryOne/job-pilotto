// The central employer index: GET /api/index is what every app and Always-on run downloads, with an install token (POST /api/install-token
// {install, purpose: 'index'}) and at most INDEX_PER_INSTALL_PER_DAY times a day; GET /api/index?summary=1 is public and holds only the counts;
// PUT /api/index (Bearer INDEX_PUBLISH_KEY) is the private central scout (repo GarryOne/job-pilotto-internal) publishing it.
// Product data only: feeds, quality, last verified. Nothing about any user. Stored as one KV value (binding WAITLIST).
import {REGIONS, ROLES} from './pool.js';
import {authorize, digestOf, equal, flag} from './guard.js';
const KEY = 'index:employers';
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'amazon', 'netflix'];
const MAX_BYTES = 1_000_000;
const MAX_FEEDS = 5000;
const MAX_PLACES = 40;   // where a feed has roles: clients skip feeds with none in their own places

const text = (status, body, headers = {}) => new Response(body, {status, headers});

const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : null;

// kind: an employer's own career page, or a job portal (counted apart on the website).
// Who a feed fits (fixed lists only): the scout publishes a tag only when many installs agree.
const fitsOf = fits => ({roles: (fits?.roles || []).filter(r => ROLES.includes(r)), regions: (fits?.regions || []).filter(r => REGIONS.includes(r))});

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
      places: Array.isArray(item.places) ? item.places.filter(p => typeof p === 'string').map(p => p.slice(0, 60)).slice(0, MAX_PLACES) : []});
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
  const feeds = JSON.parse(stored).feeds || [];
  const employers = feeds.filter(feed => feed.kind !== 'board');
  return {employers: employers.length, jobs: employers.reduce((sum, feed) => sum + (feed.jobs || 0), 0)};
}

async function download(request, env, now = new Date()) {
  const stored = await env.WAITLIST.get(KEY);
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
  if (raw.length > MAX_BYTES) return text(413, 'Too large');
  let body;
  try { body = JSON.parse(raw); } catch { return text(400, 'Send JSON'); }
  const feeds = clean(body.feeds).slice(0, MAX_FEEDS);
  if (!feeds.length) return text(400, 'No valid feeds');
  // A broken scout run must not wipe the list everyone downloads: a sudden loss of more than half is refused.
  const previous = JSON.parse((await env.WAITLIST.get(KEY)) || '{"feeds":[]}').feeds.length;
  if (previous >= 10 && feeds.length < previous / 2) return text(409, `Refused: ${feeds.length} feeds would replace ${previous}`);
  await env.WAITLIST.put(KEY, JSON.stringify({version: 1, generated: new Date().toISOString(), feeds}));
  return Response.json({ok: true, feeds: feeds.length});
}

export function index(request, env) {
  if (request.method === 'GET' || request.method === 'HEAD') return download(request, env);
  if (request.method === 'PUT') return publish(request, env);
  return text(405, 'Use GET', {Allow: 'GET, HEAD, PUT'});
}
