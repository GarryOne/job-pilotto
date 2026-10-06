// /admin/access: the super admin's page to share the admin pages. Invite someone (a name and how long), copy their single-use link
// (shown once: only its hash is kept), set a new expiry, or remove them; and every login, good or bad. Admins and anyone else get
// the usual 404: nobody but the super admin sees or changes access. Changes are POSTs from this page only (same origin, and the
// session cookie is SameSite=Strict).
import {GUEST_DAYS, extend, invite, isOwner, people, recentLogins, remember, revoke} from './auth.js';
import {esc} from './stats.js';

const NOT_FOUND = () => new Response('Not found', {status: 404});
const html = body => new Response(body, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});

export function statusOf(person, now = Date.now()) {
  if (person.revoked_at) return {text: 'Removed', tone: 'muted'};
  if (Date.parse(person.expires_at) < now) return {text: 'Expired', tone: 'bad'};
  if (!person.invite_used_at) return {text: 'Link not opened yet', tone: 'warn'};
  return {text: 'Active', tone: 'good'};
}

export function page({list = [], logins = [], created = null, now = Date.now()}) {
  const date = value => (value ? esc(String(value).slice(0, 16).replace('T', ' ')) : '–');
  const day = value => (value ? esc(String(value).slice(0, 10)) : '–');
  const days = GUEST_DAYS.map(n => `<option value="${n}"${n === 30 ? ' selected' : ''}>${n} days</option>`).join('');
  const fromToday = GUEST_DAYS.map(n => `<option value="${n}"${n === 30 ? ' selected' : ''}>${n} days</option>`).join('');
  const rows = list.map(person => {
    const status = statusOf(person, now), open = !person.revoked_at;
    return `<tr><td><b>${esc(person.name)}</b></td><td class="${status.tone}">${status.text}</td><td>${day(person.expires_at)}</td><td>${date(person.last_seen)}</td><td>${day(person.created_at)}</td>
<td class="actions">${open ? `<form method="post"><input type="hidden" name="action" value="extend"><input type="hidden" name="id" value="${esc(person.id)}"><select name="days" aria-label="New expiry for ${esc(person.name)}">${fromToday}</select><button>Set expiry</button></form>
<form method="post" onsubmit="return confirm('Remove ${esc(person.name)}? Their access ends now; a new invite brings them back.')"><input type="hidden" name="action" value="revoke"><input type="hidden" name="id" value="${esc(person.id)}"><button class="danger">Remove</button></form>` : ''}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Access · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
.card{padding:16px;margin-bottom:12px}h2{margin:0 0 4px}.good{color:#3fb68b}.bad{color:#e5484d}.warn{color:#f5b54a}
th,td{padding:8px 6px;vertical-align:middle}.actions{display:flex;gap:6px;white-space:nowrap}form{display:inline-flex;gap:6px;margin:0}@media (max-width:560px){form.invite{display:flex;flex-direction:column;align-items:stretch}form.invite>*{width:100%;box-sizing:border-box}}
input[type=text],select{background:#0b0d10;color:#f4efe3;border:1px solid #262c33;border-radius:8px;padding:7px 9px;font:inherit}
button{background:#1b2027;color:#f4efe3;border:1px solid #262c33;border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer}
button.primary{background:#f5b54a;color:#0b0d10;border-color:#f5b54a;font-weight:600}button.danger{color:#e5484d}
.link{display:flex;gap:8px;margin-top:10px}.link input{flex:1;min-width:0;font-family:ui-monospace,monospace}.created{border-color:#3fb68b}
</style></head><body><main>
<header><h1>🔐 Access</h1><span class="muted">only you see this page · admins see every other page and change nothing</span></header>
${created ? `<section class="card created"><h2>Invite for ${esc(created.name)}</h2><small class="muted">Send this link to them. It works once, for ${created.days} days, and is shown only now: it is not stored.</small>
<div class="link"><input id="invite" type="text" readonly value="${esc(created.link)}" aria-label="Invite link"><button class="primary" type="button" onclick="navigator.clipboard.writeText(document.getElementById('invite').value);this.textContent='Copied'">Copy</button></div></section>` : ''}
<section class="card"><h2>Invite someone</h2><small class="muted">They get the admin role: every admin page, read only. You can change the expiry or remove them at any time.</small>
<form method="post" class="invite" style="margin-top:10px"><input type="hidden" name="action" value="invite"><input type="text" name="name" placeholder="Their name" required maxlength="60" aria-label="Name">
<select name="days" aria-label="Access for">${days}</select><button class="primary">Create invite link</button></form></section>
<section class="card"><h2>People</h2><div class="wrap"><table><tr><th>Name</th><th>Status</th><th>Access until</th><th>Last seen (UTC)</th><th>Invited</th><th>New expiry, from today</th></tr>
${rows || '<tr><td colspan="6" class="muted">Nobody invited yet.</td></tr>'}</table></div></section>
<section class="card"><h2>Logins</h2><small class="muted">Every sign-in, with the key or an invite link, good or bad. Never a key or a link.</small>
<table><tr><th>When (UTC)</th><th>Who</th><th>Result</th><th>Country</th><th>Device</th></tr>${logins.map(row =>
  `<tr><td>${date(row.at)}</td><td>${esc(row.person || 'super admin')}</td><td>${row.ok ? '✅ signed in' : '🔴 refused'}</td><td>${esc(row.country || '–')}</td><td>${esc(row.device)}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">No logins recorded yet.</td></tr>'}</table></section>
</main></body></html>`;
}

// GET shows the page; POST (from this page) invites, sets an expiry or removes. Super admin only.
export async function view(request, env, now = Date.now()) {
  if (!await isOwner(request, env, now) || !env.STATS) return NOT_FOUND();
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.has('key')) return remember(url, env, request);
  let created = null;
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return NOT_FOUND();   // a form on another site cannot post here
    const form = await request.formData().catch(() => new FormData());
    const action = form.get('action'), id = String(form.get('id') || ''), days = Number(form.get('days'));
    if (action === 'invite') created = {...await invite(env, form.get('name'), days, url.origin, now), name: String(form.get('name') || '').trim().slice(0, 60) || 'Guest', days: GUEST_DAYS.includes(days) ? days : 30};
    else if (action === 'extend' && id) await extend(env, id, days, now);
    else if (action === 'revoke' && id) await revoke(env, id, now);
    else return new Response('Unknown action', {status: 400});
    if (!created) return new Response(null, {status: 303, headers: {Location: '/admin/access'}});
  } else if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  return html(page({list: await people(env.STATS), logins: await recentLogins(env.STATS, 30), created, now}));
}
