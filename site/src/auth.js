// Who may open the owner's admin pages and APIs. Two keys, one session:
//   STATS_KEY      the owner's login: ?key= once in a browser; it is swapped at once for a session cookie, never kept
//   STATS_API_KEY  the scripts' key (`Authorization: Bearer`): the form lab, triage, proposer, canary promote, product brain
//   jp_admin       the session: an expiry signed with STATS_KEY (HMAC-SHA256), 30 days. Rotating STATS_KEY ends every session.
// Until STATS_API_KEY is set, the old ways still work (STATS_KEY as Bearer, the old cookie that held the raw key), so nothing
// breaks before the scripts have moved to the new key. Every ?key= login, good or bad, is logged (admin_logins): when, where
// from (country, device), never the key. Anyone without access gets the same 404 as a page that does not exist.
import {device} from './stats.js';

export const SESSION_COOKIE = 'jp_admin', LEGACY_COOKIE = 'jp_stats', SESSION_DAYS = 30;
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
// Equal strings, compared in a time that does not depend on where they differ.
export function same(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
const cookieOf = (request, name) => (request.headers.get('Cookie') || '').split(/;\s*/).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const legacy = env => !env.STATS_API_KEY;

export async function sessionToken(env, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  return `v1.${expires}.${await sign(env.STATS_KEY, `admin|v1|${expires}`)}`;
}
export async function validSession(env, token, now = Date.now()) {
  const match = /^v1\.(\d{10})\.([\w-]{40,})$/.exec(String(token || ''));
  if (!match || !env.STATS_KEY || Number(match[1]) * 1000 < now) return false;
  return same(match[2], await sign(env.STATS_KEY, `admin|v1|${match[1]}`));
}

// Is this request the owner (or the owner's scripts)? Always awaited: a forgotten await would be a truthy Promise, and
// test/auth.test.js fails on any call site without one.
export async function isOwner(request, env, now = Date.now()) {
  if (!env.STATS_KEY) return false;
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const key = auth.slice(7);
    return (!!env.STATS_API_KEY && same(key, env.STATS_API_KEY)) || (legacy(env) && same(key, env.STATS_KEY));
  }
  const given = new URL(request.url).searchParams.get('key');
  if (given) {
    const ok = same(given, env.STATS_KEY);
    if (!ok) await logLogin(request, env, false, now);   // a wrong key is logged; a right one is logged by remember()
    return ok;
  }
  if (await validSession(env, cookieOf(request, SESSION_COOKIE), now)) return true;
  return legacy(env) && same(cookieOf(request, LEGACY_COOKIE), env.STATS_KEY);
}

// After a good ?key=: the session cookie, the old raw-key cookie removed, the key taken out of the address bar and history.
export async function remember(url, env, request = null, now = Date.now()) {
  if (request) await logLogin(request, env, true, now);
  url.searchParams.delete('key');
  const headers = new Headers({Location: url.pathname + url.search, 'Cache-Control': 'no-store'});
  headers.append('Set-Cookie', `${SESSION_COOKIE}=${await sessionToken(env, now)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`);
  headers.append('Set-Cookie', `${LEGACY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  return new Response(null, {status: 302, headers});
}

async function logLogin(request, env, ok, now) {
  if (!env.STATS) return;
  const at = new Date(now).toISOString();
  await env.STATS.prepare('INSERT INTO admin_logins (at, day, ok, country, device, path) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(at, at.slice(0, 10), ok ? 1 : 0, String(request.cf?.country || request.headers.get('CF-IPCountry') || '').slice(0, 2), device(request.headers.get('User-Agent') || ''),
      new URL(request.url).pathname.slice(0, 60)).run().catch(() => {});
}
export async function recentLogins(db, limit = 10) {
  try { return (await db.prepare('SELECT at, ok, country, device, path FROM admin_logins ORDER BY at DESC LIMIT ?').bind(limit).all()).results || []; } catch { return []; }
}
