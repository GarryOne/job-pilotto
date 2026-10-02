// The Chrome extension, delivered by the website instead of the public repo: the extension's source is private
// (GarryOne/job-pilotto-extension), its CI publishes each version here, and an app with a valid license or a running trial
// downloads it. Stored in WAITLIST as "extpack:meta" (JSON) and "extpack:data" (the .tar.gz bytes, a few hundred KB).
//   POST /api/extension/publish   the extension repo's CI: Authorization Bearer EXTENSION_PUBLISH_TOKEN, X-Version, X-Hash
//                                 (sha256 hex of the body), body = the package. A version below the stored one is refused.
//   GET  /api/extension/latest    an app: {ok, version, hash, size}. Authorization Bearer <install token>, X-Install <id>,
//                                 X-License <JP1 key, optional>. 402 when neither a license nor a running trial.
//   GET  /api/extension/download  the package itself, same headers. The trial is EXTENSION_TRIAL_DAYS (60) from the first ask
//                                 of that install id; install ids can be minted but only a few per address per day.
import {verifyLicense} from './license.js';
import {tokenFor, equal} from './recipes.js';

const META = 'extpack:meta', DATA = 'extpack:data';
const DAY = 86400000;
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store'}});
const versionParts = text => String(text || '').split('.').map(part => Number(part) || 0);
export function newer(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function publish(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.EXTENSION_PUBLISH_TOKEN || !equal(bearer, env.EXTENSION_PUBLISH_TOKEN)) return json({ok: false, error: 'unauthorized'}, 401);
  if (!env.WAITLIST) return json({ok: false, error: 'not configured'}, 503);
  const version = String(request.headers.get('X-Version') || ''), claimed = String(request.headers.get('X-Hash') || '').toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version)) return json({ok: false, error: 'bad version'}, 400);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > 5 * 1024 * 1024) return json({ok: false, error: 'package must be 1 byte to 5 MB'}, 400);
  const hash = hex(await crypto.subtle.digest('SHA-256', body));
  if (claimed && claimed !== hash) return json({ok: false, error: 'hash does not match the body'}, 400);
  const current = JSON.parse(await env.WAITLIST.get(META) || 'null');
  if (current && newer(current.version, version)) return json({ok: false, error: `${version} is older than the published ${current.version}`}, 409);
  await env.WAITLIST.put(DATA, body);
  await env.WAITLIST.put(META, JSON.stringify({version, hash, size: body.byteLength, at: new Date().toISOString()}));
  return json({ok: true, version, hash, size: body.byteLength});
}

// Who may have the package: a genuinely signed, unexpired license key, or an install id still inside its trial.
async function allowed(request, env, now) {
  const install = String(request.headers.get('X-Install') || '');
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[\w-]{8,64}$/.test(install) || !equal(bearer, await tokenFor(install, env))) return {ok: false, status: 401, error: 'unauthorized'};
  const license = await verifyLicense(request.headers.get('X-License') || '', env.LICENSE_PUBLIC_KEY);
  if (license) return {ok: true, via: 'license'};
  const days = Number(env.EXTENSION_TRIAL_DAYS || 60), key = `extpack:first:${install}`;
  const first = Number(await env.WAITLIST.get(key)) || now.getTime();
  if (!await env.WAITLIST.get(key)) await env.WAITLIST.put(key, String(first), {expirationTtl: Math.ceil((days + 30) * 86400)});
  if (now.getTime() - first <= days * DAY) return {ok: true, via: 'trial', daysLeft: Math.max(0, Math.ceil(days - (now.getTime() - first) / DAY))};
  return {ok: false, status: 402, error: 'The trial is over: the extension needs a Job Pilotto license key.', gate: 'license'};
}

export async function pack(request, env, now = new Date()) {
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  if (!env.WAITLIST) return json({ok: false, error: 'not configured'}, 503);
  const gate = await allowed(request, env, now);
  if (!gate.ok) return json({ok: false, error: gate.error, ...(gate.gate ? {gate: gate.gate} : {})}, gate.status);
  const meta = JSON.parse(await env.WAITLIST.get(META) || 'null');
  if (!meta) return json({ok: false, error: 'No extension has been published yet.'}, 404);
  if (new URL(request.url).pathname.endsWith('/latest')) return json({ok: true, ...meta, via: gate.via, ...(gate.daysLeft != null ? {daysLeft: gate.daysLeft} : {})});
  const data = await env.WAITLIST.get(DATA, 'arrayBuffer');
  if (!data) return json({ok: false, error: 'package missing'}, 404);
  return new Response(data, {headers: {'Content-Type': 'application/gzip', 'X-Version': meta.version, 'X-Hash': meta.hash, 'Cache-Control': 'private, no-store'}});
}
