// "I have Pro" on another computer (Pro spec PR 5, owner 16 Oct 2026): the person gives the e-mail of their Pro account, we mail a 6-digit code (10 minutes, 5 tries, bound to the asking install,
// rate-limited per address by src/mail.js), and the code adds that install to pro_devices (max 3; a 4th asks which device to remove). It moves Pro only, never data (export/import does that).
// The answer to "start" is the same whether or not the address has Pro, so it cannot be used to look addresses up. Hidden (404) while PRO_PLAN is off. Guard: test/pro-signin.test.js.
import {authorize, digestOf, equal} from './guard.js';
import {addrOf, clean, send} from './mail.js';
import {DEVICES_PER_ACCOUNT, accountOf, link, planOn} from './pro.js';

export const CODE_MINUTES = 10, MAX_TRIES = 5;
const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };
const json = (status, body) => Response.json(body, {status});
const codeHash = async (env, hash, code) => digestOf(`${env.STATS_SALT || env.STATS_KEY || 'dev'}:${hash}:${code}`);
const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');

async function who(request, env) {
  if (!planOn(env) || !env.STATS) return {response: new Response('Not found', {status: 404})};
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  if (!access?.ok) return {response: json(401, {ok: false, error: 'unauthorized'})};
  const body = await request.json().catch(() => ({}));
  return {install: given.install, body};
}
const proAccount = (env, hash) => env.STATS.prepare("SELECT * FROM pro_accounts WHERE email_hash = ? AND plan = 'pro' AND status = 'active'").bind(hash).first();

// POST /api/pro/signin/start {email} -> {ok: true, minutes} always (a code is mailed only when the address has an active Pro account).
export async function start(request, env, now = new Date()) {
  if (request.method !== 'POST') return json(405, {ok: false});
  const asked = await who(request, env);
  if (asked.response) return asked.response;
  const email = clean(asked.body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, {ok: false, error: 'Enter the email address you bought Pro with.'});
  const hash = await addrOf(email), account = await proAccount(env, hash);
  if (account) {
    const code = newCode();
    const sent = await send(env, 'account-code', email, {code}, {now});
    if (sent.ok) {
      await env.STATS.prepare('INSERT OR REPLACE INTO pro_codes (email_hash, code_hash, install, expires_at, tries, created_at) VALUES (?, ?, ?, ?, 0, ?)')
        .bind(hash, await codeHash(env, hash, code), asked.install, new Date(now.getTime() + CODE_MINUTES * 60000).toISOString(), now.toISOString()).run();
    }
  }
  return json(200, {ok: true, minutes: CODE_MINUTES});
}

// The account's devices as the window may see them: a short id (a digest, never the raw install id), when it was added and last seen.
async function devicesOf(env, account) {
  const rows = (await env.STATS.prepare('SELECT install, added_at, last_seen FROM pro_devices WHERE account = ? ORDER BY added_at').bind(account).all()).results || [];
  return Promise.all(rows.map(async row => ({id: await digestOf(row.install), added: row.added_at, lastSeen: row.last_seen, install: row.install})));
}

// POST /api/pro/signin/verify {email, code, remove?} -> {ok: true}, or {ok: false, error: 'expired' | 'wrong' | 'locked' | 'devices' | 'other', ...}.
// With 3 devices already, the first answer is 409 {error: 'devices', devices: [{id, added, lastSeen}]} (the code is kept); the same call with remove: <id> replaces that device.
export async function verify(request, env, now = new Date()) {
  if (request.method !== 'POST') return json(405, {ok: false});
  const asked = await who(request, env);
  if (asked.response) return asked.response;
  const email = clean(asked.body.email), code = String(asked.body.code || '').replace(/\s+/g, '');
  const hash = await addrOf(email), row = await env.STATS.prepare('SELECT * FROM pro_codes WHERE email_hash = ?').bind(hash).first();
  if (!row || row.install !== asked.install || Date.parse(row.expires_at) < now.getTime()) return json(400, {ok: false, error: 'expired'});
  if (row.tries >= MAX_TRIES) return json(429, {ok: false, error: 'locked'});
  if (!equal(await codeHash(env, hash, code), row.code_hash)) {
    await env.STATS.prepare('UPDATE pro_codes SET tries = tries + 1 WHERE email_hash = ?').bind(hash).run();
    return json(400, {ok: false, error: 'wrong', left: Math.max(0, MAX_TRIES - row.tries - 1)});
  }
  const account = await proAccount(env, hash);
  if (!account) return json(400, {ok: false, error: 'expired'});
  const mine = await accountOf(env, asked.install);
  if (mine && mine.id !== account.id) {
    if (mine.plan === 'pro') return json(409, {ok: false, error: 'other'});   // this computer already belongs to another Pro account
    await env.STATS.prepare('DELETE FROM pro_devices WHERE install = ?').bind(asked.install).run();   // its trial identity gives way to the Pro account
  }
  const devices = await devicesOf(env, account.id);
  if (!devices.some(device => device.install === asked.install) && devices.length >= DEVICES_PER_ACCOUNT) {
    const gone = devices.find(device => device.id === asked.body.remove);
    if (!gone) return json(409, {ok: false, error: 'devices', devices: devices.map(({id, added, lastSeen}) => ({id, added, lastSeen}))});
    await env.STATS.prepare('DELETE FROM pro_devices WHERE account = ? AND install = ?').bind(account.id, gone.install).run();
  }
  const linked = await link(env, account.id, asked.install, now);
  if (!linked.ok) return json(409, {ok: false, error: 'devices', message: linked.error});
  await env.STATS.prepare('DELETE FROM pro_codes WHERE email_hash = ?').bind(hash).run();
  return json(200, {ok: true});
}
