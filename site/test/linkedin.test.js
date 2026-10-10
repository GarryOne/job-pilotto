// Connect with LinkedIn (src/linkedin.js): start sends the user to LinkedIn, the callback trades the code server-side and keeps ONLY the OpenID
// profile (never the token) for the app to collect once. Same shape as notion.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as linkedin from '../src/linkedin.js';

function kv() {
  const data = new Map();
  return {data, get: async k => data.get(k) ?? null, put: async (k, v) => { data.set(k, v); }, delete: async k => { data.delete(k); }};
}
const SESSION = 'a'.repeat(43);
const env = () => ({LINKEDIN_CLIENT_ID: 'id-1', LINKEDIN_CLIENT_SECRET: 'secret-1', WAITLIST: kv()});
const collect = (e, session = SESSION) => linkedin.collect(new Request('https://site/api/linkedin/token', {method: 'POST', body: JSON.stringify({session})}), e);
const INFO = {sub: 'abc123', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', email_verified: true, locale: {country: 'CH', language: 'en'}, picture: 'https://media.licdn.com/x.jpg'};
const fetcher = (info = INFO, calls = []) => async (url, init) => {
  calls.push({url, init});
  if (String(url).includes('accessToken')) return new Response(JSON.stringify({access_token: 'AQ-secret-token', expires_in: 5184000}), {status: 200});
  return new Response(JSON.stringify(info), {status: 200});
};

test('start sends the user to LinkedIn with the session as state, the scopes and this site as the way back', () => {
  const response = linkedin.start(new Request(`https://site.test/api/linkedin/start?session=${SESSION}`), env());
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(to.searchParams.get('client_id'), 'id-1');
  assert.equal(to.searchParams.get('state'), SESSION);
  assert.equal(to.searchParams.get('scope'), 'openid profile email');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://site.test/api/linkedin/callback');
  assert.equal(linkedin.start(new Request('https://site.test/api/linkedin/start?session=short'), env()).status, 400);
});

test('the code is traded server-side; only the profile is kept, under a hash, and collected once', async () => {
  const e = env(), calls = [];
  assert.deepEqual(await (await collect(e)).json(), {ok: false, pending: true});
  const page = await linkedin.callback(new Request(`https://site.test/api/linkedin/callback?code=c-1&state=${SESSION}`), e, fetcher(INFO, calls));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connected to LinkedIn/);
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('client_secret'), 'secret-1');
  assert.equal(body.get('redirect_uri'), 'https://site.test/api/linkedin/callback');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer AQ-secret-token');
  const stored = [...e.WAITLIST.data.entries()];
  assert.equal(stored.length, 1);
  assert.ok(!stored[0][0].includes(SESSION), 'stored under a hash, not the session');
  assert.ok(!stored[0][1].includes('AQ-secret-token'), 'the LinkedIn token is never kept');
  assert.ok(!stored[0][1].includes('licdn'), 'the picture link is not kept');
  assert.deepEqual(await (await collect(e)).json(), {ok: true, sub: 'abc123', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', locale: 'en'});
  assert.deepEqual(await (await collect(e)).json(), {ok: false, pending: true}, 'gone after one read');
  assert.deepEqual(await (await collect(e, 'b'.repeat(43))).json(), {ok: false, pending: true}, 'another session gets nothing');
});

test('an unverified email is not passed on; cancelled, broken or unconfigured: a clear page, nothing stored', async () => {
  const e = env();
  await linkedin.callback(new Request(`https://site.test/api/linkedin/callback?code=c&state=${SESSION}`), e, fetcher({...INFO, email_verified: false}));
  assert.equal((await (await collect(e)).json()).email, '');
  const cancelled = await linkedin.callback(new Request(`https://site.test/api/linkedin/callback?error=user_cancelled_login&state=${SESSION}`), env());
  assert.equal(cancelled.status, 400);
  const refused = env();
  const bad = async () => new Response(JSON.stringify({error: 'invalid_request', error_description: 'bad code'}), {status: 400});
  const page = await linkedin.callback(new Request(`https://site.test/api/linkedin/callback?code=c&state=${SESSION}`), refused, bad);
  assert.equal(page.status, 400);
  assert.match(await page.text(), /bad code/);
  assert.equal(refused.WAITLIST.data.size, 0);
  assert.equal((await linkedin.collect(new Request('https://site/x', {method: 'POST', body: JSON.stringify({session: SESSION})}), {WAITLIST: kv()})).status, 503);
  assert.equal(linkedin.start(new Request(`https://site.test/api/linkedin/start?session=${SESSION}`), {}).status, 400);
});
