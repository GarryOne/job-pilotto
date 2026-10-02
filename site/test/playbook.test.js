// The private playbook (src/playbook.js): the owner publishes per-board notes, installs with a token read one board at a time.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../src/index.js';

const map = new Map();
const env = () => ({STATS_KEY: 'secret', WAITLIST: {get: async key => map.get(key) ?? null, put: async (key, value) => { map.set(key, value); }}});
const call = (e, method, {headers = {}, body, query = ''} = {}) => worker.fetch(new Request(`https://www.jobpilotto.workers.dev/api/playbook${query}`,
  {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, {});
const tokenOf = async (e, install) => (await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/api/install-token', {method: 'POST', body: JSON.stringify({install})}), e, {})).json()).token;
const holder = async (e, install = 'abcd-1234-efgh') => ({'X-Install-Id': install, Authorization: `Bearer ${await tokenOf(e, install)}`});

test('only the owner publishes; a board name and size are checked', async () => {
  map.clear();
  const e = env();
  assert.equal((await call(e, 'PUT', {body: {board: 'greenhouse', text: 'x'}})).status, 404);
  assert.equal((await call(e, 'PUT', {headers: {Authorization: 'Bearer wrong'}, body: {board: 'greenhouse', text: 'x'}})).status, 404);
  const owner = {Authorization: 'Bearer secret'};
  assert.equal((await call(e, 'PUT', {headers: owner, body: {board: 'Bad Board!', text: 'x'}})).status, 400);
  assert.equal((await call(e, 'PUT', {headers: owner, body: {board: 'greenhouse', text: 'x'.repeat(40001)}})).status, 400);
  const ok = await call(e, 'PUT', {headers: owner, body: {board: 'Greenhouse', text: 'react-select quirks'}});
  assert.deepEqual(await ok.json(), {ok: true, board: 'greenhouse', chars: 19});
});

test('an install with a token reads one board; no token, a wrong one or a bad board is refused; unknown boards are empty', async () => {
  map.clear();
  const e = env();
  await call(e, 'PUT', {headers: {Authorization: 'Bearer secret'}, body: {board: 'ashby', text: 'ashby notes'}});
  assert.equal((await call(e, 'GET', {query: '?board=ashby'})).status, 401);
  assert.equal((await call(e, 'GET', {query: '?board=ashby', headers: {'X-Install-Id': 'abcd-1234-efgh', Authorization: 'Bearer nope'}})).status, 401);
  const headers = await holder(e);
  assert.deepEqual(await (await call(e, 'GET', {query: '?board=Ashby', headers})).json(), {ok: true, board: 'ashby', text: 'ashby notes'});
  assert.deepEqual(await (await call(e, 'GET', {query: '?board=lever', headers})).json(), {ok: true, board: 'lever', text: ''});
  assert.equal((await call(e, 'GET', {query: '?board=../x', headers})).status, 400);
});

test('an install can read the playbook only so many times a day', async () => {
  map.clear();
  const e = env(), headers = await holder(e, 'many-reads-001');
  for (let i = 0; i < 30; i++) assert.equal((await call(e, 'GET', {query: '?board=ashby', headers})).status, 200);
  assert.equal((await call(e, 'GET', {query: '?board=ashby', headers})).status, 429);
});
