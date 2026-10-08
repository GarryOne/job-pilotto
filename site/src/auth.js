// Who may open the owner's admin pages and APIs. Two keys, one session, and invited guests:
//   STATS_KEY      the owner's login: ?key= once in a browser; it is swapped at once for a session cookie, never kept
//   STATS_API_KEY  the scripts' key (`Authorization: Bearer`): the form lab, triage, proposer, canary promote, product brain
//   jp_admin       the session: an expiry signed with STATS_KEY (HMAC-SHA256), 30 days. Rotating STATS_KEY ends every session.
// Until STATS_API_KEY is set, the old ways still work (STATS_KEY as Bearer, the old cookie that held the raw key), so nothing
// breaks before the scripts have moved to the new key. Every ?key= login, good or bad, is logged (admin_logins): when, where
// from (country, device), never the key. Anyone without access gets the same 404 as a page that does not exist.
// Roles: the super admin (the owner: STATS_KEY or the scripts' key) and admins (invited). The super admin makes a personal invite
// link on /admin/access (a name and an expiry). Opened, it gives that person a session of their own (v2: signed with their
// id); every request checks they are still invited and not expired, so Remove takes effect at once. An admin reads every admin
// page; only the super admin manages access (invites, expiry, removal) and calls the APIs.
import {device} from './stats.js';

export const SESSION_COOKIE = 'jp_admin', LEGACY_COOKIE = 'jp_stats', SESSION_DAYS = 30;
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function sign(secret, text) {
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
const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async text => base64url(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
export const GUEST_DAYS = [7, 30, 90];   // how long an invite (and the admin's access) lasts

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
    if (!ok) await logLogin(request, env, false, now, 'wrong key');   // a wrong key is logged; a right one is logged by remember()
    return ok;
  }
  if (await validSession(env, cookieOf(request, SESSION_COOKIE), now)) return true;
  return legacy(env) && same(cookieOf(request, LEGACY_COOKIE), env.STATS_KEY);
}

// Who is looking at an admin page: {role: 'superadmin'}, {role: 'admin', id, name}, or null (a 404). Admins read pages;
// every API and every change (access included) stays isOwner(), the super admin's.
export async function viewer(request, env, now = Date.now()) {
  if (await isOwner(request, env, now)) return {role: 'superadmin'};
  const match = /^v2\.(\d{10})\.([\w-]{16,40})\.([\w-]{40,})$/.exec(cookieOf(request, SESSION_COOKIE));
  if (!match || !env.STATS_KEY || !env.STATS || Number(match[1]) * 1000 < now) return null;
  if (!same(match[3], await sign(env.STATS_KEY, `admin|v2|${match[1]}|${match[2]}`))) return null;
  const person = await env.STATS.prepare('SELECT id, name, expires_at, revoked_at, last_seen FROM admin_people WHERE id = ?').bind(match[2]).first().catch(() => null);
  if (!person || person.revoked_at || Date.parse(person.expires_at) < now) return null;
  if (!person.last_seen || Date.parse(person.last_seen) < now - 3600000) {
    await env.STATS.prepare('UPDATE admin_people SET last_seen = ? WHERE id = ?').bind(new Date(now).toISOString(), person.id).run().catch(() => {});
  }
  return {role: 'admin', id: person.id, name: person.name};
}

// The owner invites someone: a person row and a link that works until the access expires or is removed (only its hash is stored). -> {id, link}
export async function invite(env, name, days, origin, now = Date.now()) {
  const id = randomToken(12), token = randomToken(32);
  const span = GUEST_DAYS.includes(Number(days)) ? Number(days) : 30;
  await env.STATS.prepare('INSERT INTO admin_people (id, name, created_at, expires_at, invite_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(id, String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'Guest', new Date(now).toISOString(),
      new Date(now + span * 86400000).toISOString(), await sha256(token)).run();
  return {id, link: `${origin}/admin/join?t=${token}`};
}
export async function revoke(env, id, now = Date.now()) {
  await env.STATS.prepare('UPDATE admin_people SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(new Date(now).toISOString(), String(id)).run();
}
// The super admin sets a new expiry: N days from now (an expired person can be brought back this way; a removed one cannot).
export async function extend(env, id, days, now = Date.now()) {
  const span = GUEST_DAYS.includes(Number(days)) ? Number(days) : 30;
  await env.STATS.prepare('UPDATE admin_people SET expires_at = ? WHERE id = ? AND revoked_at IS NULL').bind(new Date(now + span * 86400000).toISOString(), String(id)).run();
}
export async function people(db) {
  try { return (await db.prepare('SELECT id, name, created_at, expires_at, revoked_at, invite_used_at, last_seen FROM admin_people ORDER BY created_at DESC LIMIT 50').all()).results || []; }
  catch { return []; }
}
// GET /admin/join?t=…: an invite link, reusable until it expires or is removed (owner, 8 Oct 2026: link-preview scanners spent every
// single-use link before the person clicked). A revoked, expired or unknown link is the usual 404.
export async function join(request, env, now = Date.now()) {
  const url = new URL(request.url), token = url.searchParams.get('t') || '';
  if (!env.STATS || !env.STATS_KEY || !/^[\w-]{40,}$/.test(token)) return new Response('Not found', {status: 404});
  const person = await env.STATS.prepare('SELECT id, name, expires_at, revoked_at, invite_used_at FROM admin_people WHERE invite_hash = ?').bind(await sha256(token)).first().catch(() => null);
  if (!person || person.revoked_at || Date.parse(person.expires_at) < now) {
    await logLogin(request, env, false, now, person ? `${person.name} (invite revoked or expired)` : 'unknown invite link');
    return new Response('Not found', {status: 404});
  }
  await env.STATS.prepare('UPDATE admin_people SET invite_used_at = COALESCE(invite_used_at, ?), last_seen = ? WHERE id = ?').bind(new Date(now).toISOString(), new Date(now).toISOString(), person.id).run();
  await logLogin(request, env, true, now, person.name);
  // The cookie lasts as long as the longest access (90 days); the expiry the super admin sets, read on every request, decides.
  const expires = Math.floor((now + Math.max(...GUEST_DAYS) * 86400000) / 1000);
  const session = `v2.${expires}.${person.id}.${await sign(env.STATS_KEY, `admin|v2|${expires}|${person.id}`)}`;
  return new Response(null, {status: 302, headers: {Location: '/admin', 'Cache-Control': 'no-store',
    'Set-Cookie': `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${Math.max(0, expires - Math.floor(now / 1000))}; HttpOnly; Secure; SameSite=Strict`}});
}

// After a good ?key=: the session cookie, the old raw-key cookie removed, the key taken out of the address bar and history.
export async function remember(url, env, request = null, now = Date.now()) {
  if (request) await logLogin(request, env, true, now, 'super admin');
  url.searchParams.delete('key');
  const headers = new Headers({Location: url.pathname + url.search, 'Cache-Control': 'no-store'});
  headers.append('Set-Cookie', `${SESSION_COOKIE}=${await sessionToken(env, now)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`);
  headers.append('Set-Cookie', `${LEGACY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  return new Response(null, {status: 302, headers});
}

async function logLogin(request, env, ok, now, person) {
  if (!env.STATS) return;
  const at = new Date(now).toISOString();
  await env.STATS.prepare('INSERT INTO admin_logins (at, day, ok, country, device, path, person) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(at, at.slice(0, 10), ok ? 1 : 0, String(request.cf?.country || request.headers.get('CF-IPCountry') || '').slice(0, 2), device(request.headers.get('User-Agent') || ''),
      new URL(request.url).pathname.slice(0, 60), String(person).slice(0, 80)).run().catch(() => {});
}
export async function recentLogins(db, limit = 10) {
  try { return (await db.prepare('SELECT at, ok, country, device, path, person FROM admin_logins ORDER BY at DESC LIMIT ?').bind(limit).all()).results || []; } catch { return []; }
}
