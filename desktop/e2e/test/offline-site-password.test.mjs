// The offline app answers a sign-in page from an item that exists and never makes one (lib/offline-site-password.mjs). Pure: a fake storage and fake Keychain reads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {offlineSitePassword} from '../lib/offline-site-password.mjs';

const storage = () => ({settings: () => ({siteAccounts: {}})});

test('an existing item whose email is the applicant\'s: sign-in, its password and email handed over; another email: sign-up', async () => {
  const answer = async (applicantEmail, itemEmail) => {
    const handler = offlineSitePassword(storage(), {read: () => ({ok: true, password: 'pw-1234'}), emailOf: () => itemEmail, email: async () => ({email: applicantEmail})});
    return handler({host: 'tenant.wd3.example.test'});
  };
  const same = await answer('me+jp@x.test', 'me+jp@x.test');
  assert.equal(same.mode, 'sign-in'); assert.equal(same.password, 'pw-1234'); assert.equal(same.email, 'me+jp@x.test');
  const other = await answer('ada.tester@example.test', 'me+jp@x.test');
  assert.equal(other.mode, 'sign-up');
});

test('no item: not ok, nothing made, and a peek only says the mode', async () => {
  const handler = offlineSitePassword(storage(), {read: () => ({ok: false}), emailOf: () => '', email: async () => ({email: 'a@x.test'})});
  assert.deepEqual(await handler({host: 'x.example.test'}), {ok: false});
  assert.deepEqual(await handler({host: 'x.example.test', peek: true}), {ok: true, mode: 'sign-up', email: 'a@x.test'});
});
