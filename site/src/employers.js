// The central employer index: GET /api/index (public, cacheable) is what every app and Always-on run downloads;
// PUT /api/index (Bearer INDEX_PUBLISH_KEY) is the private central scout (repo GarryOne/job-pilotto-ops) publishing it.
// Product data only: feeds, quality, last verified. Nothing about any user. Stored as one KV value (binding WAITLIST).
const KEY = 'index:employers';
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'amazon', 'netflix'];
const MAX_BYTES = 1_000_000;
const MAX_FEEDS = 5000;

const text = (status, body, headers = {}) => new Response(body, {status, headers});

function equal(a, b) {  // constant-time-ish string compare
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : null;

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
    out.push({company: company.trim().slice(0, 120), ats, slug, tier: item.tier === 'Tier 1' ? 'Tier 1' : 'Standard',
      quality: number(item.quality, 100), jobs: number(item.jobs, 100000),
      checked: /^\d{4}-\d{2}-\d{2}$/.test(item.checked || '') ? item.checked : null});
  }
  return out;
}

async function etag(body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `"${[...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('')}"`;
}

async function download(request, env) {
  const stored = await env.WAITLIST.get(KEY);
  if (!stored) return text(404, JSON.stringify({ok: false, error: 'No index published yet'}), {'Content-Type': 'application/json'});
  const tag = await etag(stored);
  const headers = {'Content-Type': 'application/json', ETag: tag, 'Cache-Control': 'public, max-age=3600'};
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
