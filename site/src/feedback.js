// POST /api/feedback: feedback from the Job Pilotto app ("Send feedback…", desktop/lib/feedback.js). Stored in D1
// (migrations/0003_feedback.sql) and sent at once to the owner's Job Pilotto Brain bot. Stage 1's exit criterion is
// feedback from real users, so it must be one click away. At most 10 a day per install; ≤ 2000 characters.

import {viewer} from './auth.js';   // admins (invited) read this page too
import {isOwner, remember} from './stats.js';

const PER_INSTALL_PER_DAY = 10;
const clip = (value, max) => String(value ?? '').replace(/\s+$/g, '').slice(0, max);
const esc = text => String(text).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));

export async function feedback(request, env, fetcher = fetch, now = new Date()) {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const text = clip(body.text, 2000).trim();
  const install = clip(body.install, 64);
  if (!text || !/^[\w-]{8,64}$/.test(install)) return Response.json({ok: false, error: 'give a message'}, {status: 400});
  const day = now.toISOString().slice(0, 10);
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM feedback WHERE day = ? AND install = ?').bind(day, install).first() || {n: 0};
  if (n >= PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  const row = {at: now.toISOString(), day, install, version: clip(body.version, 30) || '?', platform: clip(body.platform, 20) || '?',
    text, contact: clip(body.contact, 200).trim()};
  await env.STATS.prepare('INSERT INTO feedback (at, day, install, version, platform, text, contact) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.at, row.day, row.install, row.version, row.platform, row.text, row.contact).run();
  if (env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID) {
    const message = `💬 <b>Feedback</b> · v${esc(row.version)} · ${esc(row.platform)} · install ${esc(install.slice(0, 8))}\n\n${esc(text)}` +
      (row.contact ? `\n\n↩︎ ${esc(row.contact)}` : '');
    await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID, text: message, parse_mode: 'HTML'})})
      .catch(error => console.log('feedback notify failed', error.message));
  }
  return Response.json({ok: true});
}

// The owner's list on /telemetry (key only): newest first, with the contact when one was given.
export async function feedbackList(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return ((await db.prepare('SELECT at, version, platform, install, text, contact FROM feedback WHERE day >= ? ORDER BY at DESC LIMIT 200')
    .bind(from).all()).results || []);
}

// The last feedback, for the product brain's signals (src/signals.js): newest first.
export async function recentFeedback(db, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return ((await db.prepare('SELECT at, version, text, contact != \'\' AS canReply FROM feedback WHERE day >= ? ORDER BY at DESC LIMIT 30')
    .bind(from).all()).results || []);
}

// GET /feedback: the owner's live page (same key or cookie as /stats). It polls /feedback?json=1 every 10 s and puts
// new messages on top, marked, so feedback can be read as it arrives. Everything is escaped on the page (textContent).
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (url.searchParams.has('json')) {
    const rows = await feedbackList(env.STATS, 90, now).catch(() => []);
    return Response.json({rows, now: now.toISOString()}, {headers: {'Cache-Control': 'no-store'}});
  }
  return new Response(PAGE, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Feedback · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px 48px}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:16px}
h1{margin:0;font-size:24px}a{color:var(--amber)}.muted{color:var(--muted)}.live{font-size:13px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:6px}
.live.on .dot{background:var(--green);animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.35}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.card.fresh{border-color:var(--amber)}.meta{font-size:12px;color:var(--muted);margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap}
.text{white-space:pre-wrap;overflow-wrap:anywhere}.reply{margin-top:8px;font-size:13px}.badge{color:var(--amber);font-weight:700}
</style></head><body><main>
<header><h1>💬 Feedback</h1><span class="muted"><span class="live" id="live"><span class="dot"></span><span id="state">connecting…</span></span></span></header>
<div id="list"><p class="muted">Loading…</p></div>
<script>
const list = document.getElementById('list'), state = document.getElementById('state'), live = document.getElementById('live');
let known = null;
const make = (row, fresh) => {
  const card = document.createElement('div'), meta = document.createElement('div'), text = document.createElement('div');
  card.className = 'card' + (fresh ? ' fresh' : ''); meta.className = 'meta'; text.className = 'text';
  const parts = [String(row.at).slice(0, 16).replace('T', ' ') + ' UTC', row.version + ' · ' + row.platform, 'install ' + String(row.install).slice(0, 8)];
  if (fresh) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'NEW'; meta.append(b); }
  for (const part of parts) { const s = document.createElement('span'); s.textContent = part; meta.append(s); }
  text.textContent = row.text;
  card.append(meta, text);
  if (row.contact) { const reply = document.createElement('div'); reply.className = 'reply'; reply.textContent = '↩︎ ' + row.contact; card.append(reply); }
  return card;
};
async function refresh() {
  try {
    const response = await fetch('?json=1', {cache: 'no-store'});
    if (!response.ok) throw new Error(response.status);
    const {rows} = await response.json();
    const seen = new Set(known || []);
    list.replaceChildren(...(rows.length ? rows.map(row => make(row, known && !seen.has(row.at + row.install))) : [Object.assign(document.createElement('p'), {className: 'muted', textContent: 'No feedback yet.'})]));
    known = rows.map(row => row.at + row.install);
    state.textContent = 'live · ' + rows.length + ' message' + (rows.length === 1 ? '' : 's') + ' · updated ' + new Date().toLocaleTimeString();
    live.classList.add('on');
  } catch (error) { state.textContent = 'offline, retrying…'; live.classList.remove('on'); }
}
refresh(); setInterval(refresh, 10000);
</script></main></body></html>`;
