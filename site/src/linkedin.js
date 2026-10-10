// "Connect with LinkedIn" for the desktop app (Sign In with LinkedIn using OpenID Connect: name, email, LinkedIn id; nothing else, LinkedIn gives
// positions and skills only to registered companies). Same shape as src/notion.js: the app never holds the secret. It opens /api/linkedin/start
// with a random session id; LinkedIn sends the user back to /api/linkedin/callback; this Worker trades the one-time code for a token, reads
// the member's OpenID profile ONCE, drops the token, and keeps only that profile in KV for 10 minutes under a hash of the session id; the app
// collects it once with POST /api/linkedin/token (deleted on read). Configuration: LINKEDIN_CLIENT_ID (var) and LINKEDIN_CLIENT_SECRET
// (secret), see wrangler.toml. Guarded by test/linkedin.test.js.
const TTL = 600;
const SESSION = /^[A-Za-z0-9_-]{32,128}$/;
export const CALLBACK = '/api/linkedin/callback';
const SCOPE = 'openid profile email';

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function page(title, text, ok) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.5 system-ui,-apple-system,sans-serif;background:#eef3f7;color:#0f1b2d;display:grid;place-items:center;min-height:90vh;margin:0}
main{background:#fff;border-radius:16px;padding:32px 36px;max-width:440px;box-shadow:0 10px 30px rgba(15,30,50,.12);text-align:center}
h1{font-size:22px;margin:0 0 8px;color:${ok ? '#0e7c7b' : '#b42318'}}p{margin:0;color:#4c5d72}</style>
<main><h1>${title}</h1><p>${text}</p></main>`;
  return new Response(html, {status: ok ? 200 : 400, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
const configured = env => env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET && env.WAITLIST;

// GET /api/linkedin/start?session=… -> LinkedIn's consent page.
export function start(request, env) {
  const url = new URL(request.url);
  const session = url.searchParams.get('session') || '';
  if (!configured(env)) return page('Not available yet', 'Connect with LinkedIn isn\'t set up on this server yet.', false);
  if (!SESSION.test(session)) return page('Something went wrong', 'Start again from the Job Pilotto app.', false);
  const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorize.search = new URLSearchParams({response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: url.origin + CALLBACK,
    state: session, scope: SCOPE}).toString();
  return Response.redirect(authorize.toString(), 302);
}

// GET /api/linkedin/callback?code=…&state=… (from LinkedIn) -> the member's OpenID profile, kept for the app to collect. The token is not kept.
export async function callback(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const session = url.searchParams.get('state') || '';
  if (url.searchParams.get('error')) return page('Not connected', 'You cancelled on LinkedIn\'s page. Go back to Job Pilotto and try again.', false);
  if (!configured(env) || !SESSION.test(session) || !url.searchParams.get('code')) return page('Something went wrong', 'Start again from the Job Pilotto app.', false);
  const tokenResponse = await fetcher('https://www.linkedin.com/oauth/v2/accessToken', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: url.origin + CALLBACK,
      client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET}).toString()});
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.access_token) return page('Not connected', `LinkedIn said: ${String(token.error_description || token.error || tokenResponse.status).slice(0, 200)}. Try again from the app.`, false);
  const infoResponse = await fetcher('https://api.linkedin.com/v2/userinfo', {headers: {Authorization: `Bearer ${token.access_token}`}});
  const info = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok || !info.sub) return page('Not connected', 'LinkedIn did not share your profile. Try again from the app.', false);
  const keep = {sub: String(info.sub), name: info.name || '', given_name: info.given_name || '', family_name: info.family_name || '',
    email: info.email_verified === false ? '' : info.email || '', locale: typeof info.locale === 'string' ? info.locale : (info.locale?.language || '')};
  await env.WAITLIST.put(`linkedin:${await sha256(session)}`, JSON.stringify(keep), {expirationTtl: TTL});
  return page('Connected to LinkedIn ✓', `${keep.name ? `${keep.name} is connected. ` : ''}Go back to Job Pilotto: it takes it from here. You can close this tab.`, true);
}

// POST /api/linkedin/token {session} -> {ok, pending} until the user has approved, then the profile (once).
export async function collect(request, env) {
  if (request.method !== 'POST') return json(405, {ok: false, error: 'Use POST'});
  let body = {};
  try { body = await request.json(); } catch {}
  if (!SESSION.test(String(body.session || ''))) return json(400, {ok: false, error: 'Bad session'});
  if (!configured(env)) return json(503, {ok: false, error: 'Connect with LinkedIn is not set up on this server'});
  const key = `linkedin:${await sha256(body.session)}`;
  const kept = await env.WAITLIST.get(key);
  if (!kept) return json(200, {ok: false, pending: true});
  await env.WAITLIST.delete(key);
  return json(200, {ok: true, ...JSON.parse(kept)});
}
