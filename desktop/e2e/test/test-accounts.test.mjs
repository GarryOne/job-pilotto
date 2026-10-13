// A live pool row signs in only with a listed test account (lib/test-accounts.mjs, docs/rules/applying.md "Signing in"): the account goes into the test
// app's own secrets file as the product saves a site password, the privacy tripwire lets that email through and nothing else of the owner's. Pure: no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {allowedValues, seedTestAccounts, testAccounts} from '../lib/test-accounts.mjs';
import {tripwire} from '../lib/privacy-tripwire.mjs';

test('accounts come from the CI secret or the Keychain items of listed hosts only; a malformed host is dropped', () => {
  const ci = testAccounts({JP_TEST_ACCOUNTS: JSON.stringify({'tenant.wd3.example.test': {email: 'a@b.test', password: 'p'}, 'not a host': {email: 'x', password: 'y'}})});
  assert.deepEqual(Object.keys(ci), ['tenant.wd3.example.test']);
  const asked = [];
  const mac = testAccounts({JP_TEST_ACCOUNT_HOSTS: 'jobs.example.test, missing.example.test'}, {keychain: service => { asked.push(service); if (service.includes('missing')) throw new Error('not found'); return service.endsWith('.email') ? 'me@x.test' : 'secret'; }});
  assert.deepEqual(mac, {'jobs.example.test': {email: 'me@x.test', password: 'secret'}});
  assert.ok(asked.every(service => service.startsWith('job-pilotto.test-account.')), asked.join(' '));
  assert.deepEqual(testAccounts({}), {}, 'nothing listed: no sign-in anywhere');
});

test('a seeded account is the product\'s saved site password: the host\'s item, the email in its comment, a private file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-accounts-'));
  fs.writeFileSync(path.join(dir, 'isolated-secrets.json'), JSON.stringify({'job-pilotto.other.test.password': {value: 'keep'}}));
  assert.deepEqual(seedTestAccounts(dir, {'jobs.example.test': {email: 'me@x.test', password: 'secret'}}), ['jobs.example.test']);
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'isolated-secrets.json'), 'utf8'));
  assert.equal(items['job-pilotto.jobs.example.test.password'].value, 'secret');
  assert.equal(items['job-pilotto.jobs.example.test.password'].comment, 'email=me@x.test');
  assert.equal(items['job-pilotto.other.test.password'].value, 'keep', 'an item already there stays');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'isolated-secrets.json')).mode & 0o777, 0o600);
});

test('the tripwire lets a listed test account\'s email through, never the owner\'s other values', async () => {
  const values = [['owner@real.test', 'email'], ['Ada Owner', 'name']];
  const page = fields => ({typed: async () => fields, clear: async () => {}});
  const allow = allowedValues({'jobs.example.test': {email: 'Owner@Real.test', password: 'secret'}});
  assert.equal((await tripwire(page([{label: 'Email', value: 'owner@real.test'}]), {values, allow})).ok, true);
  const tripped = await tripwire(page([{label: 'Email', value: 'owner@real.test'}, {label: 'Name', value: 'Ada Owner'}]), {values, allow});
  assert.equal(tripped.ok, false);
  assert.match(tripped.reason, /name typed into "Name"/);
  assert.equal((await tripwire(page([{label: 'Email', value: 'owner@real.test'}]), {values})).ok, false, 'no allow list: the email still trips');
});
