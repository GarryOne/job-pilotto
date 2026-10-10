// A tab's identity (extension/tab-identity.js): its job is the posting it was opened for, not the page it is on; the session the app answered is kept on the tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const store = {};
globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
  async get(keys) { const list = [].concat(keys); return Object.fromEntries(list.filter(key => key in store).map(key => [key, store[key]])); },
  async set(items) { Object.assign(store, items); }, async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }}}};
const {bindSession, identityOf, jobOf} = await import('../../extension/tab-identity.js');

const POSTING = 'https://www.jobs.ch/en/vacancies/detail/12181ac1/', SIGNIN = 'https://auth.jobs.ch/u/login/identifier?state=x#jobpilotto-fill';

test('a sign-in tab with no session yet: its job is the posting that led to it; the answered session is kept and then carried', async () => {
  store['from:7'] = POSTING;
  assert.deepEqual(await identityOf({id: 7, url: SIGNIN}), {session: '', job: POSTING, url: 'https://auth.jobs.ch/u/login/identifier?state=x'});
  assert.equal(await bindSession(7, 'f8ddb7ed', ''), true);
  assert.equal((await identityOf({id: 7, url: SIGNIN})).session, 'f8ddb7ed');
  assert.equal(await bindSession(7, 'f8ddb7ed', 'f8ddb7ed'), false, 'the same id is not written again');
  assert.equal(await bindSession(7, '', 'f8ddb7ed'), false, 'an empty answer never clears what the tab carries');
});

test('job: the job key wins over from, and a tab with neither is its own page', async () => {
  store['job:8'] = 'https://a.example/job/1'; store['from:8'] = 'https://b.example/job/2';
  assert.equal(await jobOf({id: 8, url: 'https://c.example/'}), 'https://a.example/job/1');
  assert.equal(String(await jobOf({id: 9, url: 'https://c.example/apply'})).startsWith('https://c.example'), true);
});
