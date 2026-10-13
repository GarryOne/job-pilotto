// Test accounts a live pool row may sign in with (docs/rules/applying.md "Signing in", owner 13 Oct 2026): only hosts listed in the Keychain
// (job-pilotto.test-account.<host>.email / .password) on a Mac, or in the POOL_TEST_ACCOUNTS secret ({"<host>": {"email", "password"}}) on CI. Never a person's
// own data. They go into the TEST app's own secrets file (never the Keychain: lib/keychain.js), where the product's saved-password sign-in finds them.
// Guard: e2e/test/test-accounts.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {writePrivate} from '../../lib/private-file.js';

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

// -> {host: {email, password}}: the CI secret's JSON (JP_TEST_ACCOUNTS), else the Keychain items of the hosts JP_TEST_ACCOUNT_HOSTS names (a Mac). Values never printed.
export function testAccounts(env = process.env, {keychain = (service) => execFileSync('security', ['find-generic-password', '-s', service, '-w'], {encoding: 'utf8'}).trim()} = {}) {
  let accounts = {};
  if (env.JP_TEST_ACCOUNTS) { try { accounts = JSON.parse(env.JP_TEST_ACCOUNTS) || {}; } catch { accounts = {}; } }
  else for (const host of String(env.JP_TEST_ACCOUNT_HOSTS || '').split(',').map(one => one.trim()).filter(Boolean)) {
    try { accounts[host] = {email: keychain(`job-pilotto.test-account.${host}.email`), password: keychain(`job-pilotto.test-account.${host}.password`)}; } catch { /* not listed: no sign-in there */ }
  }
  return Object.fromEntries(Object.entries(accounts).filter(([host, one]) => HOST.test(host) && one?.email && one?.password));
}

// Writes each account into the test app's secrets file as the product saves a site password (the item's comment carries the email). -> the hosts seeded.
export function seedTestAccounts(profileDir, accounts) {
  const file = path.join(profileDir, 'isolated-secrets.json');
  let items = {}; try { items = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* the first item */ }
  for (const [host, {email, password}] of Object.entries(accounts)) items[`job-pilotto.${host}.password`] = {value: password, account: 'job-pilotto', comment: `email=${email}`, created: new Date().toISOString()};
  writePrivate(file, JSON.stringify(items, null, 2));
  return Object.keys(accounts);
}

// The values the privacy tripwire lets through: a listed test account's email only (its password field is never read).
export const allowedValues = accounts => Object.values(accounts).map(one => String(one.email).toLowerCase());
