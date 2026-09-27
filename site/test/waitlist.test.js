import assert from 'node:assert/strict';
import {test} from 'node:test';
import {waitlist} from '../src/index.js';

function kv() {
  const data = new Map();
  return {data, get: async key => data.get(key) ?? null, put: async (key, value) => { data.set(key, value); }};
}
const post = (body, ip = '1.2.3.4') => new Request('https://site/api/waitlist', {method: 'POST',
  headers: {'Content-Type': 'application/json', 'CF-Connecting-IP': ip}, body: JSON.stringify(body)});

test('a sign-up is stored once, keyed by its lower-case email', async () => {
  const env = {WAITLIST: kv()};
  assert.deepEqual(await (await waitlist(post({email: ' Ada@Example.com ', role: 'SRE in Zurich'}), env)).json(), {ok: true});
  assert.deepEqual(await (await waitlist(post({email: 'ada@example.com'}), env)).json(), {ok: true, already: true});
  const saved = JSON.parse(env.WAITLIST.data.get('signup:ada@example.com'));
  assert.equal(saved.role, 'SRE in Zurich');
});

test('bad emails, bots and floods are turned away', async () => {
  const env = {WAITLIST: kv()};
  assert.equal((await waitlist(post({email: 'not-an-email'}), env)).status, 400);
  assert.equal((await waitlist(post({email: 'bot@spam.io', website: 'x'}), env)).status, 200);
  assert.equal(env.WAITLIST.data.has('signup:bot@spam.io'), false);
  for (let i = 0; i < 10; i++) await waitlist(post({email: `p${i}@example.com`}, '9.9.9.9'), env);
  assert.equal((await waitlist(post({email: 'late@example.com'}, '9.9.9.9'), env)).status, 429);
  assert.equal((await waitlist(new Request('https://site/api/waitlist'), env)).status, 405);
});
