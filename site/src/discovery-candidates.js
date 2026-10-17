// The daily discovery batch's input (owner, 17 Oct 2026; spec: the recordings strategy page). Installs share up to 40 public posting addresses each ("Help the pool grow",
// src/contribute_candidates.py): only the address, its host and where it came from ('matches' | 'applying'). GET /applying/discovery-input (Bearer REPLAYS_PUBLISH_KEY, a
// wrong or missing one is a 404) hands the CI picker (desktop/e2e/lib/discovery-pick.mjs) those addresses with the two things the site alone knows: the platforms real matches
// are on (share, installs) and the weaknesses real fills show per named platform. No install, no title, no company ever. Guard: test/discovery-candidates.test.js.
import {digest} from './digest.js';
import {equal} from './guard.js';
import {PLATFORMS, platformDemand} from './nextsites.js';

export const SOURCES = ['matches', 'applying'];
export const MAX_CANDIDATES = 40, KEEP_DAYS = 14;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

// -> [{url, host, source}]: a plain https address (no user, port, query or fragment) on a real host, at most 40, each once. Anything else is dropped.
export function cleanCandidates(list) {
  const out = [], seen = new Set();
  for (const item of (Array.isArray(list) ? list : []).slice(0, MAX_CANDIDATES)) {
    let url = null;
    try { url = typeof item?.url === 'string' && item.url.length <= 200 ? new URL(item.url) : null; } catch { url = null; }
    const host = url?.hostname || '';
    if (!url || url.protocol !== 'https:' || url.search || url.hash || url.username || url.password || url.port || url.pathname.length < 2 || !HOST.test(host) || /^e2e/.test(host)) continue;
    if (item.url !== url.href || item.host !== host || !SOURCES.includes(item.source) || seen.has(item.url)) continue;   // the address as sent is the address kept; the host is its own
    seen.add(item.url);
    out.push({url: item.url, host, source: item.source});
  }
  return out;
}

export const candidateStatements = (db, install, today, list) => list.map(item =>
  db.prepare('INSERT INTO discovery_candidates (install, day, url, host, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT(install, url) DO UPDATE SET day = excluded.day, source = excluded.source')
    .bind(install, today, item.url, item.host, item.source));

export const pruneCandidates = (db, now = new Date()) => db.prepare('DELETE FROM discovery_candidates WHERE day < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10)).run();

export async function discoveryInput(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const since = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const rows = (await env.STATS.prepare('SELECT url, host, source, COUNT(*) AS installs FROM discovery_candidates WHERE day >= ? GROUP BY url ORDER BY MAX(day) DESC, installs DESC LIMIT 400').bind(since).all()).results || [];
  const demand = await platformDemand(env.STATS, now).catch(() => ({rows: [], total: 0}));
  const named = Object.fromEntries(PLATFORMS.map(item => [item.ats, item.platform]));
  const weaknesses = (await digest(env.STATS, now).catch(() => ({weaknesses: []}))).weaknesses || [];
  return Response.json({
    day: now.toISOString().slice(0, 10),
    candidates: rows.map(row => ({url: row.url, host: row.host, source: row.source, installs: row.installs})),
    demand: demand.rows.map(row => ({platform: row.platform, share: demand.total ? Math.round((100 * row.hits) / demand.total) : 0, installs: row.installs})),
    misses: weaknesses.filter(item => item.kind === 'cause' && named[item.board]).slice(0, 10).map(item => ({platform: named[item.board], cause: item.cause, lost: item.now?.lost || 0, forms: item.now?.forms || 0})),
  }, {headers: {'Cache-Control': 'no-store'}});
}
