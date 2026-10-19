// /api/report-form: an encrypted "Report this form" recording from an install (docs/superpowers/specs/2026-10-15-report-this-form.md §4, §6). The Worker cannot read it: the app encrypts the
// bundle with the owner's public key before it leaves the Mac, and this file only stores two opaque objects in the private R2 bucket (binding REPORTS, a 30-day lifecycle rule on the bucket) and a
// counts-only row in D1 (migrations/0071_form_reports.sql). No host, page or value is ever seen here.
//   POST   /api/report-form          an install, Bearer = its token for purpose 'report' (/api/install-token); X-Install, X-Report-Key (the wrapped AES key, base64), X-Report-Meta {requests, cause}; body = the encrypted bundle
//   DELETE /api/report-form/<id>     the install that sent it (same token) deletes it
//   GET    /api/report-form          the owner (Bearer = the scripts' key): the reports waiting, newest first
//   GET    /api/report-form/<id>     the owner: the encrypted bundle, its wrapped key in X-Report-Key
//   POST   /api/report-form/<id>?status=fetched   the owner marks it fetched
// Limits: 8 MB per report, 3 per install per day, and 50 reports / 200 MB per UTC day across ALL installs (a minted install id gets a fresh per-install quota, so only the total holds; one D1 row a day). Without the bucket or the database: 503 "not configured" (nothing breaks). Guard: test/report-form.test.js.
import {authorize, flag} from './guard.js';
import {isOwner} from './auth.js';
import {tellOwner} from './report-notify.js';

export const MAX_BYTES = 8 * 1024 * 1024, PER_INSTALL_PER_DAY = 3, KEEP_DAYS = 30, ALL_REPORTS_PER_DAY = 50, ALL_BYTES_PER_DAY = 200 * 1024 * 1024;
const bad = (status, error) => Response.json({ok: false, error}, {status});
const bearerOf = request => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
const dayOf = date => date.toISOString().slice(0, 10);
const objects = (day, id) => [`${day}/${id}.bin`, `${day}/${id}.k`];

export async function reportForm(request, env, pathname, now = new Date(), fetcher = fetch) {
  if (!env.REPORTS || !env.STATS) return bad(503, 'not configured');
  const id = pathname.split('/')[3] || '';
  if (request.method === 'POST' && !id) return upload(request, env, now, fetcher);
  if (request.method === 'DELETE' && id) return remove(request, env, id);
  if (!(await isOwner(request, env))) return bad(401, 'unauthorized');
  if (request.method === 'GET' && !id) {
    const {results} = await env.STATS.prepare("SELECT id, day, bytes, requests, cause, status FROM form_reports WHERE status = 'new' ORDER BY day DESC, id LIMIT 100").all();
    return Response.json({ok: true, reports: results || []});
  }
  const row = id ? await env.STATS.prepare('SELECT id, day FROM form_reports WHERE id = ?').bind(id).first() : null;
  if (!row) return bad(404, 'no such report');
  if (request.method === 'GET') {
    const [bin, key] = objects(row.day, row.id), blob = await env.REPORTS.get(bin), wrapped = await env.REPORTS.get(key);
    if (!blob || !wrapped) return bad(404, 'gone');
    return new Response(blob.body, {headers: {'Content-Type': 'application/octet-stream', 'X-Report-Key': await wrapped.text()}});
  }
  if (request.method === 'POST' && new URL(request.url).searchParams.get('status') === 'fetched') {
    await env.STATS.prepare("UPDATE form_reports SET status = 'fetched' WHERE id = ?").bind(id).run();
    return Response.json({ok: true});
  }
  return new Response('Method not allowed', {status: 405});
}

async function upload(request, env, now, fetcher) {
  const install = String(request.headers.get('X-Install') || '');
  const access = await authorize(env, install, bearerOf(request), 'report');
  if (!access.ok) return bad(401, 'unauthorized');
  const wrapped = String(request.headers.get('X-Report-Key') || '');
  if (!/^[A-Za-z0-9+/=]{100,1000}$/.test(wrapped)) return bad(400, 'no key');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return bad(413, 'too large');
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return bad(body.byteLength ? 413 : 400, body.byteLength ? 'too large' : 'empty');
  const meta = (() => { try { return JSON.parse(request.headers.get('X-Report-Meta') || '{}'); } catch { return {}; } })();
  const requests = Math.max(0, Math.min(100000, Number(meta.requests) || 0)), cause = /^[a-z0-9_-]{1,40}$/.test(String(meta.cause || '')) ? String(meta.cause) : '';
  const day = dayOf(now);
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM form_reports WHERE day = ? AND who = ?').bind(day, access.who).first() || {n: 0};
  if (n >= PER_INSTALL_PER_DAY) { await flag(env, 'report-limit', access.who, '', now); return bad(429, 'limit reached for today'); }
  // The day's total: one row, bumped only while both caps hold (the WHERE makes the bump and the check one step). 429 with the same words as the per-install limit.
  const bumped = await env.STATS.prepare('INSERT INTO form_report_days (day, reports, bytes) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET reports = reports + 1, bytes = bytes + excluded.bytes WHERE reports < ? AND bytes + excluded.bytes <= ?')
    .bind(day, body.byteLength, ALL_REPORTS_PER_DAY, ALL_BYTES_PER_DAY).run();
  if (((bumped.meta ?? bumped).changes ?? 0) < 1) { await flag(env, 'report-limit', 'all', 'day', now); return bad(429, 'limit reached for today'); }
  await env.STATS.prepare('DELETE FROM form_reports WHERE day < ?').bind(dayOf(new Date(now.getTime() - KEEP_DAYS * 86400e3))).run();
  await env.STATS.prepare('DELETE FROM form_report_days WHERE day < ?').bind(dayOf(new Date(now.getTime() - KEEP_DAYS * 86400e3))).run();   // the rows follow the bucket's 30-day rule
  const id = crypto.randomUUID(), [bin, key] = objects(day, id);
  await env.REPORTS.put(bin, body);
  await env.REPORTS.put(key, wrapped);
  await env.STATS.prepare('INSERT INTO form_reports (id, day, who, bytes, requests, cause) VALUES (?, ?, ?, ?, ?, ?)').bind(id, day, access.who, body.byteLength, requests, cause).run();
  const {reports} = await env.STATS.prepare('SELECT reports FROM form_report_days WHERE day = ?').bind(day).first() || {reports: 1};
  await tellOwner(env, {cause, requests, who: access.who, now}, reports, fetcher);   // counts only; a failure to tell never fails the upload
  return Response.json({ok: true, id});
}

// Only the install that sent a report deletes it (its digest is on the row); a wrong install is told "no such report", like a missing one.
async function remove(request, env, id) {
  const install = String(request.headers.get('X-Install') || '');
  const access = await authorize(env, install, bearerOf(request), 'report');
  if (!access.ok) return bad(401, 'unauthorized');
  const row = await env.STATS.prepare('SELECT id, day FROM form_reports WHERE id = ? AND who = ?').bind(id, access.who).first();
  if (!row) return bad(404, 'no such report');
  for (const name of objects(row.day, row.id)) await env.REPORTS.delete(name);
  await env.STATS.prepare('DELETE FROM form_reports WHERE id = ?').bind(id).run();
  return Response.json({ok: true});
}
