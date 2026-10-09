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

import {DEFAULT_AUTOMATION, automationOf, forWindow} from '../lib/site-accounts.js';

test('the account automation setting: full or assist, anything else is the default (assist)', () => {
  assert.equal(automationOf({accountAutomation: 'assist'}), 'assist');
  assert.equal(automationOf({accountAutomation: 'full'}), 'full');
  assert.equal(automationOf({accountAutomation: 'nonsense'}), DEFAULT_AUTOMATION);
  assert.equal(automationOf(undefined), DEFAULT_AUTOMATION);
  assert.equal(DEFAULT_AUTOMATION, 'assist');   // 9 Oct 2026: assist is what a new install gets
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

import fs from 'node:fs';

test('the account automation switch is in the window (Profile > Application assistant), saves full or assist, and the state the window gets carries the effective choice', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.ok(read('renderer/index.html').includes('id="account-automation"'));
  assert.match(read('renderer/pages/startup.js'), /accountAutomation: \$\('account-automation'\)\.checked \? 'full' : 'assist'/);
  assert.match(read('renderer/pages/settings.js'), /account-automation'\)\.checked = shared\.state\.settings\.accountAutomation !== 'assist'/);
  assert.match(read('main.js'), /settings: forWindow\(storage\.settings\(\)\)/);
});

test('the closer-look switch is in the window and off until turned on: saved as on or off, shown as on only when it says on', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.ok(read('renderer/index.html').includes('id="escalation"'));
  assert.match(read('renderer/pages/startup.js'), /escalation: \$\('escalation'\)\.checked \? 'on' : 'off'/);
  assert.match(read('renderer/pages/settings.js'), /\$\('escalation'\)\.checked = shared\.state\.settings\.escalation === 'on'/);
});

test('a password just made for a sign-up under way is not an account: the next page stays a sign-up', () => {
  const creating = record({}, 'auth.jobs.ch', 'me@example.com', 'creating');
  assert.equal(modeOf(creating, 'auth.jobs.ch', 'me@example.com', 'me@example.com'), 'sign-up');   // the item already holds the email
  assert.equal(modeOf(record(creating, 'auth.jobs.ch', 'me@example.com', 'confirmed'), 'auth.jobs.ch', 'me@example.com', 'me@example.com'), 'sign-in');   // the press overwrote it
});

test('every settings answer to the window is the effective one: an unset account automation draws as assist, in every handler (9 Oct 2026: the switch showed ON after saving another setting)', () => {
  assert.equal(forWindow({}).accountAutomation, 'assist');
  assert.equal(forWindow({accountAutomation: 'full'}).accountAutomation, 'full');
  assert.equal(forWindow({escalation: 'on'}).escalation, 'on');   // the rest is kept
  // the class: a handler that hands the window the settings (or a saveSettings result) goes through forWindow
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const file of ['main.js', 'lib/setup-handlers.js', 'lib/focus-handlers.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /return storage\.settings\(\);|return saved;|return storage\.saveSettings\(/, `${file} returns raw settings to the window`);
    assert.match(source, /forWindow\(/, `${file} uses forWindow`);
  }
});

test('a saved password for the host means sign in first, once: no email recorded, or this email; another email is not ours; a refused sign-in then means sign-up (owner, 9 Oct 2026)', () => {
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'me@example.com', '', true), 'sign-in');   // an item with no email recorded
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'me@example.com', 'me@example.com', true), 'sign-in');
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'me@example.com', 'else@example.com', true), 'sign-up');
  assert.equal(modeOf({}, 'career2.successfactors.eu', 'me@example.com', '', false), 'sign-up');   // no item at all
  assert.equal(modeOf({}, 'career2.successfactors.eu', '', '', true), 'sign-up');   // no email of ours to sign in with
  const refused = record({}, 'career2.successfactors.eu', 'me@example.com', 'refused');
  assert.equal(modeOf(refused, 'career2.successfactors.eu', 'me@example.com', '', true), 'sign-up');   // the item does not prove an account here (one host serves several employers)
  assert.equal(modeOf(record(refused, 'career2.successfactors.eu', 'me@example.com', 'confirmed'), 'career2.successfactors.eu', 'me@example.com', '', true), 'sign-in');   // a sign-up that worked
});

test('the app records a refused sign-in as state refused, without a confirmation to wait for', () => {
  const source = fs.readFileSync(new URL('../lib/ext-server-handlers.js', import.meta.url), 'utf8');
  assert.match(source, /state === 'refused'[\s\S]{0,200}record\(storage\.settings\(\)\.siteAccounts, host, email, 'refused', Date\.now\(\), /);
  assert.match(source, /modeOf\(storage\.settings\(\)\.siteAccounts, host, email, credentials\.emailOf\(host\), !!answer\.ok, company\)/);
});

test('one host, several employers: each employer keeps its own state, and a new employer on a host with a saved password signs in first (SuccessFactors: Coop, Migros)', () => {
  let accounts = record({}, 'career2.successfactors.eu', 'me@example.com', 'confirmed', 0, 'Coop Suisse');
  assert.equal(modeOf(accounts, 'career2.successfactors.eu', 'me@example.com', '', true, 'Coop Suisse'), 'sign-in');
  assert.equal(modeOf(accounts, 'career2.successfactors.eu', 'me@example.com', '', true, 'Migros'), 'sign-in');   // unseen employer: the saved password means try a sign-in first
  assert.equal(modeOf(accounts, 'career2.successfactors.eu', 'me@example.com', '', false, 'Migros'), 'sign-up');   // no item at all
  accounts = record(accounts, 'career2.successfactors.eu', 'me@example.com', 'refused', 1, 'Migros');   // its sign-in was refused
  assert.equal(modeOf(accounts, 'career2.successfactors.eu', 'me@example.com', '', true, 'Migros'), 'sign-up');
  assert.equal(modeOf(accounts, 'career2.successfactors.eu', 'me@example.com', '', true, 'Coop Suisse'), 'sign-in');   // Coop is not flipped by Migros
  accounts = record(accounts, 'career2.successfactors.eu', 'me@example.com', 'confirmed', 2, 'Migros');
  assert.deepEqual(Object.keys(accounts['career2.successfactors.eu'].employers), ['Coop Suisse', 'Migros']);
  assert.equal(modeOf(accounts, 'career2.successfactors.eu', 'me@example.com', '', true, 'Migros'), 'sign-in');
  assert.equal(modeOf(record({}, 'a.example', 'me@example.com', 'pending'), 'a.example', 'me@example.com', '', true, 'Anyone'), 'confirm');   // an old record without employers: the host's state
});

test('Credentials rows say which employers an account was used for, and cap them at six', () => {
  let accounts = {};
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) accounts = record(accounts, 'career2.successfactors.eu', 'me@example.com', 'confirmed', 0, name);
  const rows = withAccounts([{host: 'career2.successfactors.eu', email: ''}], accounts);
  assert.deepEqual(rows[0].employers.map(item => item.name), ['B', 'C', 'D', 'E', 'F', 'G']);
  assert.equal(rows[0].email, 'me@example.com');
});
