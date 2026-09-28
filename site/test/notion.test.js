import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../src/notion.js';

function kv() {
  const data = new Map();
  return {data, get: async k => data.get(k) ?? null, put: async (k, v) => { data.set(k, v); }, delete: async k => { data.delete(k); }};
}
const SESSION = 'a'.repeat(43);
const env = () => ({NOTION_CLIENT_ID: 'client-1', NOTION_CLIENT_SECRET: 'secret-1', WAITLIST: kv()});
const collect = (e, session = SESSION) => notion.collect(new Request('https://site/api/notion/token', {method: 'POST', body: JSON.stringify({session})}), e);

test('start sends the user to Notion with the session as state and this site as the way back', async () => {
  const response = notion.start(new Request(`https://site.test/api/notion/start?session=${SESSION}`), env());
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://api.notion.com/v1/oauth/authorize');
  assert.equal(to.searchParams.get('client_id'), 'client-1');
  assert.equal(to.searchParams.get('state'), SESSION);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://site.test/api/notion/callback');
  assert.equal(notion.start(new Request('https://site.test/api/notion/start?session=short'), env()).status, 400);
});

test('the code is traded for the token server-side; the app collects it once with its session', async () => {
  const e = env();
  let sent;
  const fetcher = async (url, init) => { sent = {url, init}; return new Response(JSON.stringify({access_token: 'ntn_user', workspace_name: 'Igor Mardari\'s Space', duplicated_template_id: 'tpl'}), {status: 200}); };
  assert.deepEqual(await (await collect(e)).json(), {ok: false, pending: true});  // not approved yet
  const page = await notion.callback(new Request(`https://site.test/api/notion/callback?code=c-1&state=${SESSION}`), e, fetcher);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connected to Notion/);
  assert.equal(sent.init.headers.Authorization, `Basic ${btoa('client-1:secret-1')}`);
  assert.equal(JSON.parse(sent.init.body).redirect_uri, 'https://site.test/api/notion/callback');
  assert.ok(![...e.WAITLIST.data.keys()].some(k => k.includes(SESSION)));  // stored under a hash, not the session
  assert.deepEqual(await (await collect(e)).json(), {ok: true, access_token: 'ntn_user', workspace_name: 'Igor Mardari\'s Space', workspace_id: '', duplicated_template_id: 'tpl'});
  assert.deepEqual(await (await collect(e)).json(), {ok: false, pending: true});  // gone after one read
  assert.deepEqual(await (await collect(e, 'b'.repeat(43))).json(), {ok: false, pending: true});  // another session gets nothing
});

test('cancelled, broken or unconfigured: a clear page, nothing stored', async () => {
  const e = env();
  assert.equal((await notion.callback(new Request(`https://site.test/api/notion/callback?error=access_denied&state=${SESSION}`), e)).status, 400);
  const refused = async () => new Response(JSON.stringify({error: 'invalid_grant'}), {status: 400});
  assert.match(await (await notion.callback(new Request(`https://site.test/api/notion/callback?code=x&state=${SESSION}`), e, refused)).text(), /invalid_grant/);
  assert.equal(e.WAITLIST.data.size, 0);
  assert.equal((await collect({WAITLIST: kv()})).status, 503);
});
