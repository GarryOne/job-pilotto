// Hosted Always on, the person's data at rest (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §2): the run's state (tar of data/) and the profile/search/CV the app pushes live encrypted in R2
// (env.HOSTED_STATE) under a key per account derived from the Worker secret HOSTED_KEK. Routes: GET/PUT /api/hosted/state and GET /api/hosted/config (the run token, for the container);
// PUT /api/hosted/config, GET /api/hosted/export and DELETE /api/hosted/data (the install key, for the person). Guard: site/test/hosted-state.test.js.
import {accountOf} from './pro.js';
import {hostedOn, installOf, runOf} from './hosted.js';

export const STATE_MAX = 50 * 1024 * 1024, CONFIG_MAX = 2 * 1024 * 1024;
const notFound = () => new Response('Not found', {status: 404});
const deny = () => Response.json({ok: false, error: 'unauthorized'}, {status: 401});
const keyOf = (account, name) => `hosted/${account}/${name}`;

// secret: the Worker secret the key derives from (Hosted Always on: HOSTED_KEK; Ready to send has its own, READY_KEK, so the two never share a key).
async function aesKey(env, account, secret = 'HOSTED_KEK') {
  if (!env[secret]) throw new Error(`${secret} is not set`);
  const mac = await crypto.subtle.importKey('raw', new TextEncoder().encode(env[secret]), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const raw = await crypto.subtle.sign('HMAC', mac, new TextEncoder().encode(`hosted-state:${account}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, account, bytes, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await aesKey(env, account, secret), bytes));
  const joined = new Uint8Array(12 + out.length); joined.set(iv); joined.set(out, 12);
  return joined;
}
export async function open(env, account, bytes, secret) {
  return new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.slice(0, 12)}, await aesKey(env, account, secret), bytes.slice(12)));
}
async function read(env, account, name) {
  const object = await env.HOSTED_STATE.get(keyOf(account, name));
  return object ? open(env, account, new Uint8Array(await object.arrayBuffer())) : null;
}
const write = async (env, account, name, bytes) => env.HOSTED_STATE.put(keyOf(account, name), await seal(env, account, bytes));

// The container: GET gives back its state (404 on the first run), PUT keeps the new one. Only while its run is open.
export async function state(request, env, now = new Date()) {
  if (!hostedOn(env) || !env.HOSTED_STATE) return notFound();
  const run = await runOf(env, request.headers.get('authorization'), now);
  if (!run) return deny();
  if (request.method === 'GET') {
    const bytes = await read(env, run.account, 'state.tgz');
    return bytes ? new Response(bytes, {headers: {'content-type': 'application/gzip'}}) : new Response('No state yet', {status: 404});
  }
  if (request.method !== 'PUT') return Response.json({ok: false, error: 'Use GET or PUT'}, {status: 405});
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length || body.length > STATE_MAX) return Response.json({ok: false, error: 'bad size'}, {status: 413});
  await write(env, run.account, 'state.tgz', body);
  return Response.json({ok: true});
}

// PUT (install key): the app pushes {search, profile, cv} when hosted goes on and whenever they change. GET (run token): the container reads them as JSON.
export async function config(request, env, now = new Date()) {
  if (!hostedOn(env) || !env.HOSTED_STATE) return notFound();
  if (request.method === 'GET') {
    const run = await runOf(env, request.headers.get('authorization'), now);
    if (!run) return deny();
    const bytes = await read(env, run.account, 'config.json');
    return bytes ? new Response(bytes, {headers: {'content-type': 'application/json'}}) : new Response('No config yet', {status: 404});
  }
  if (request.method !== 'PUT') return Response.json({ok: false, error: 'Use GET or PUT'}, {status: 405});
  const install = await installOf(request, env), account = install && await accountOf(env, install);
  if (!account) return deny();
  const text = await request.text();
  let given;
  try { given = JSON.parse(text); } catch { return Response.json({ok: false, error: 'Send JSON'}, {status: 400}); }
  if (text.length > CONFIG_MAX || typeof given.search !== 'object' || !given.search) return Response.json({ok: false, error: 'bad config'}, {status: 413});
  const kept = JSON.stringify({search: given.search, profile: String(given.profile || ''), cv: String(given.cv || '')});
  await write(env, account.id, 'config.json', new TextEncoder().encode(kept));
  return Response.json({ok: true});
}

// Everything we hold for an account, gone: R2 objects, schedule, runs, inbox. -> a receipt of what was removed. (The account stays: "Delete my account" is separate.)
export async function wipe(env, account) {
  let objects = 0;
  for (const name of ['state.tgz', 'config.json']) if (await env.HOSTED_STATE?.head?.(keyOf(account, name))) { await env.HOSTED_STATE.delete(keyOf(account, name)); objects++; }
  const gone = async table => (await env.STATS.prepare(`DELETE FROM ${table} WHERE account = ?`).bind(account).run()).meta?.changes ?? 0;
  const inbox = await gone('hosted_inbox'), runs = await gone('hosted_runs'), schedules = await gone('hosted_schedules');
  return {objects, inbox, runs, schedules};
}

// GET /api/hosted/export and DELETE /api/hosted/data (install key): "Download my hosted data" and "Delete everything".
export async function own(request, env) {
  if (!hostedOn(env)) return notFound();
  const install = await installOf(request, env), account = install && await accountOf(env, install);
  if (!account) return deny();
  if (request.method === 'DELETE') return Response.json({ok: true, receipt: await wipe(env, account.id)});
  if (request.method !== 'GET') return Response.json({ok: false, error: 'Use GET or DELETE'}, {status: 405});
  const {results} = await env.STATS.prepare('SELECT job, payload, at FROM hosted_inbox WHERE account = ? ORDER BY id').bind(account.id).all();
  const bytes = env.HOSTED_STATE ? await read(env, account.id, 'state.tgz') : null;
  const config = env.HOSTED_STATE ? await read(env, account.id, 'config.json') : null;
  const b64 = array => { let s = ''; for (const b of array) s += String.fromCharCode(b); return btoa(s); };
  return new Response(JSON.stringify({ok: true, inbox: results.map(r => ({job: r.job, at: r.at, ...JSON.parse(r.payload)})),
    config: config ? JSON.parse(new TextDecoder().decode(config)) : null, stateTgzBase64: bytes ? b64(bytes) : null}, null, 1), {headers: {'content-type': 'application/json', 'content-disposition': 'attachment; filename="job-pilotto-hosted-data.json"'}});
}
