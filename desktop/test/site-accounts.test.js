// The record of accounts we made (lib/site-accounts.js): sign-in only for a confirmed account of this very email; a pending one waits for its mail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {modeOf, record} from '../lib/site-accounts.js';

test('no account, another email, or a pending one: never a sign-in', () => {
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'a@b.c'), 'sign-up');
  const pending = record({}, 'Career2.SuccessFactors.eu', 'A@B.c', 'pending', 0);
  assert.equal(modeOf(pending, 'career2.successfactors.eu', 'a@b.c'), 'confirm');
  assert.equal(modeOf(pending, 'career2.successfactors.eu', 'other@b.c'), 'sign-up');
  assert.equal(modeOf(pending, 'jobs.other.ch', 'a@b.c'), 'sign-up');
});

test('a confirmed account of this email is signed in to; recording one host keeps the others', () => {
  const both = record(record({}, 'a.example', 'a@b.c', 'confirmed'), 'b.example', 'a@b.c');
  assert.equal(modeOf(both, 'a.example', 'a@b.c'), 'sign-in');
  assert.equal(modeOf(both, 'b.example', 'a@b.c'), 'confirm');
  assert.equal(JSON.stringify(Object.keys(both)), '["a.example","b.example"]');
});

import {DEFAULT_AUTOMATION, automationOf} from '../lib/site-accounts.js';

test('the account automation setting: full or assist, anything else is the default (full for now: the owner chose it; flip DEFAULT_AUTOMATION before it ships)', () => {
  assert.equal(automationOf({accountAutomation: 'assist'}), 'assist');
  assert.equal(automationOf({accountAutomation: 'full'}), 'full');
  assert.equal(automationOf({accountAutomation: 'nonsense'}), DEFAULT_AUTOMATION);
  assert.equal(automationOf(undefined), DEFAULT_AUTOMATION);
  assert.equal(DEFAULT_AUTOMATION, 'full');
});

import {withAccounts} from '../lib/site-accounts.js';

test('Credentials shows the account we made: its email fills a password item that lacks one, its state is said, an account without an item is listed too', () => {
  const accounts = record(record({}, 'career2.successfactors.eu', 'Me+X@Example.com', 'confirmed', Date.parse('2026-10-08T19:21:30Z')), 'gone.example', 'me@example.com', 'pending');
  const rows = withAccounts([{host: 'career2.successfactors.eu', email: '', job: '', created: '2026-10-08T11:54:02Z'}, {host: 'other.example', email: 'a@b.c', job: '', created: ''}], accounts);
  assert.deepEqual([rows[0].email, rows[0].state, rows[0].accountAt], ['me+x@example.com', 'confirmed', '2026-10-08T19:21:30.000Z']);
  assert.deepEqual([rows[1].email, rows[1].state], ['a@b.c', undefined]);
  assert.deepEqual([rows[2].host, rows[2].state], ['gone.example', 'pending']);
});

test('an account made earlier counts: the email recorded on the Credentials item means sign-in; another email, or none, means sign-up', () => {
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'Me+X@Example.com', 'me+x@example.com'), 'sign-in');
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'me+x@example.com', 'someone@else.com'), 'sign-up');
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'me+x@example.com', ''), 'sign-up');
  assert.equal(modeOf(record({}, 'a.example', 'me@example.com', 'pending'), 'a.example', 'me@example.com', 'me@example.com'), 'confirm');   // our record wins
});
