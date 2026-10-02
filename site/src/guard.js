// Who may use the recipe library and the employer index, and what looks wrong (Notion: "Intellectual Property").
//   An install gets a token per purpose ('recipes' or 'index'): an HMAC of its install id, so one purpose's token never opens the other.
//   authorize() checks the token and that the install was not revoked; flag() counts something odd per day; a honeypot (a decoy
//   fingerprint no real form produces) revokes whoever asks for it. The owner reads it all on /telemetry and at GET /api/guard.
// The honest limit: this adds friction and traceability. Anything a running app can download, a determined user can copy; the aim is that
// copying costs effort and leaves a trace. Every database call is allowed to fail (a missing table must never block a real user).
import {allowed} from './stats.js';

const day = date => date.toISOString().slice(0, 10);

export async function digestOf(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const equal = (a, b) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };

export async function tokenFor(install, env, purpose = 'recipes') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STATS_SALT || env.STATS_KEY || 'dev'), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${install}`)));
  return [...sig.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// -> {ok: true, who} or {ok: false, error}. `who` is the install's digest, the only name used in flags.
export async function authorize(env, install, bearer, purpose = 'recipes') {
  if (!/^[\w-]{8,64}$/.test(String(install || '')) || !equal(String(bearer || ''), await tokenFor(install, env, purpose))) return {ok: false, error: 'unauthorized'};
  const who = await digestOf(install);
  const gone = await env.STATS?.prepare('SELECT 1 AS x FROM revoked WHERE who = ?').bind(who).first().catch(() => null);
  return gone ? {ok: false, error: 'unauthorized'} : {ok: true, who};
}

export async function flag(env, kind, who, detail = '', now = new Date()) {
  await env.STATS?.prepare(`INSERT INTO anomalies (day, kind, who, n, detail) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (day, kind, who) DO UPDATE SET n = n + 1`).bind(day(now), kind, who, String(detail).slice(0, 100)).run().catch(() => {});
}

export async function revoke(env, who, reason, now = new Date()) {
  await env.STATS?.prepare('INSERT OR REPLACE INTO revoked (who, reason, created_at) VALUES (?, ?, ?)').bind(who, String(reason).slice(0, 100), now.toISOString()).run().catch(() => {});
}

export async function honeypotAmong(env, fingerprints) {
  for (const fingerprint of fingerprints) {
    const hit = await env.STATS?.prepare('SELECT 1 AS x FROM honeypots WHERE fingerprint = ?').bind(fingerprint).first().catch(() => null);
    if (hit) return fingerprint;
  }
  return null;
}

// What the owner sees: flags by kind in the last days, and who is revoked.
export async function flags(db, days = 7, now = new Date()) {
  const from = day(new Date(now.getTime() - (days - 1) * 86400000));
  const seen = (await db.prepare('SELECT kind, who, SUM(n) AS n FROM anomalies WHERE day >= ? GROUP BY kind, who ORDER BY n DESC LIMIT 40').bind(from).all()).results || [];
  const revoked = (await db.prepare('SELECT who, reason, created_at FROM revoked ORDER BY created_at DESC LIMIT 40').all()).results || [];
  const decoys = (await db.prepare('SELECT COUNT(*) AS n FROM honeypots').first())?.n || 0;
  return {seen, revoked, honeypots: decoys};
}

// GET /api/guard (owner): the flags. POST {action: 'honeypots', count} plants decoys; {action: 'revoke'|'unrevoke', who}.
export async function guard(request, env, now = new Date()) {
  if (!allowed(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  if (request.method === 'GET') return Response.json(await flags(env.STATS, 7, now), {headers: {'Cache-Control': 'private, no-store'}});
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const body = await request.json().catch(() => ({}));
  if (body.action === 'honeypots') {
    const count = Math.max(1, Math.min(50, Math.round(Number(body.count)) || 10));
    const planted = [];
    for (let i = 0; i < count; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(7));
      const fingerprint = [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
      await env.STATS.prepare('INSERT OR IGNORE INTO honeypots (fingerprint, created_at) VALUES (?, ?)').bind(fingerprint, now.toISOString()).run();
      planted.push(fingerprint);
    }
    return Response.json({ok: true, planted: planted.length});
  }
  if ((body.action === 'revoke' || body.action === 'unrevoke') && /^[0-9a-f]{16}$/.test(String(body.who))) {
    if (body.action === 'revoke') await revoke(env, body.who, 'owner', now);
    else await env.STATS.prepare('DELETE FROM revoked WHERE who = ?').bind(body.who).run();
    return Response.json({ok: true});
  }
  return Response.json({ok: false, error: 'unknown action'}, {status: 400});
}
