// Where the What's new page gets its versions (owner, 18 Oct 2026: it publishes itself for every beta and stable). CI (changelog-publish.yml → tools/changelog-publish.mjs) drafts each new version with the AI and sends it
// (PUT /changelog/data, Bearer SELFHEAL_PUBLISH_KEY); the site checks it AGAIN with the same rules (src/changelog.js) and keeps one row per version (changelog_entries). GET /changelog/data (same key) says what is stored,
// so CI drafts a version once. GET /changelog.json (public, cached 5 minutes) is what the page reads; with no row yet it falls back to public/changelog-seed.json. No commit, no PR. Guard: test/changelog-store.test.js.
import {equal} from './guard.js';
import {CHANNELS, newestFirst, problems} from './changelog.js';

const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});

// PUT {entries: [{version, date, channel, groups}], hidden: [{version, date, channel}], channels: {version: channel}}
//   entries: a drafted version (checked, stored once: a stored body is never replaced); hidden: a version with nothing to say; channels: a stored version became stable (beta -> stable only).
// GET: {have: {version: channel}} for every stored version, hidden ones too.
export async function ingest(request, env) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  if (request.method === 'GET') {
    const {results = []} = await env.STATS.prepare('SELECT version, channel FROM changelog_entries').all();
    return json({have: Object.fromEntries(results.map(row => [row.version, row.channel]))});
  }
  if (request.method !== 'PUT') return new Response('Not found', {status: 404});
  const text = await request.text();
  if (text.length > 200000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(text); } catch { return new Response('Not JSON', {status: 400}); }
  const entries = Array.isArray(data?.entries) ? data.entries : [], hidden = Array.isArray(data?.hidden) ? data.hidden : [];
  if (entries.length > 50 || hidden.length > 50) return new Response('Unexpected shape', {status: 400});
  const bad = entries.map(entry => ({version: entry?.version, problems: problems(entry)})).filter(item => item.problems.length);
  if (bad.length) return json({ok: false, rejected: bad}, 422);
  const at = new Date().toISOString();
  const write = env.STATS.prepare('INSERT INTO changelog_entries (version, date, channel, hidden, body, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(version) DO NOTHING');
  const promote = env.STATS.prepare(`UPDATE changelog_entries SET channel = 'stable' WHERE version = ? AND channel = 'beta'`);
  const note = item => /^\d+\.\d+\.\d+$/.test(item?.version || '') && /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') && CHANNELS.includes(item?.channel);
  await env.STATS.batch([...entries.map(entry => write.bind(entry.version, entry.date, entry.channel, 0, JSON.stringify(entry.groups), at)),
    ...hidden.filter(note).map(item => write.bind(item.version, item.date, item.channel, 1, '[]', at)),
    ...Object.entries(data?.channels || {}).filter(([version, channel]) => /^\d+\.\d+\.\d+$/.test(version) && channel === 'stable').map(([version]) => promote.bind(version))]);
  return json({ok: true, stored: entries.length, hidden: hidden.length});
}

// GET /changelog.json: the shown versions, newest first (the page's one read).
export async function list(request, env) {
  let rows = [];
  try { ({results: rows = []} = await env.STATS.prepare('SELECT version, date, channel, body FROM changelog_entries WHERE hidden = 0').all()); } catch { rows = []; }
  if (!rows.length) return env.ASSETS.fetch(new Request(new URL('/changelog-seed.json', request.url), request));   // not public/changelog.json: a static file with the route's name would be served before this code runs
  const entries = rows.map(row => ({version: row.version, date: row.date, channel: row.channel, groups: JSON.parse(row.body)}));
  return json(newestFirst(entries), 200, {'Cache-Control': 'public, max-age=300'});
}
