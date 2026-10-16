// Settings → Credentials: the accounts Claude made on job sites (src/ai/passwords.py: Keychain item job-pilotto.<site>.password,
// with "email=… job=…" as its comment). The list comes from the Keychain's item attributes, never its secrets; a password is read
// only when you press Show or Copy. Mac only: Windows' Credential Manager is read by the engine.
import {execFileSync} from 'node:child_process';
import * as keychain from './keychain.js';   // a test run or a twin never reaches the real Keychain the same way

const ITEM = /^job-pilotto\.(.+)\.password$/;
// A TEST ACCOUNT (owner, 15 Oct 2026; docs/rules/applying.md "Signing in"): an account the owner made by hand for the tests, item job-pilotto.test-account.<host>.password.
// Listed beside the real ones with test: true; its key (test-account.<host>) is what Show/Copy/Delete name. Only tests read it, never an application (forExtension refuses it).
export const TEST_PREFIX = 'test-account.';

// `security dump-keychain` (attributes only) → [{host, email, job, created}], newest first. The job-site password itself
// (job-pilotto.sites.password) is not a site.
export function parseDump(text) {
  const rows = [];
  for (const block of String(text || '').split(/^keychain: /m)) {
    if (!/^class: "genp"/m.test(block)) continue;
    const attr = name => (block.match(new RegExp(`"${name}"<[a-z]+>="([^"]*)"`)) || [])[1] || '';
    const key = (attr('svce').match(ITEM) || [])[1], test = !!key && key.startsWith(TEST_PREFIX), host = test ? key.slice(TEST_PREFIX.length) : key;
    if (!host || !host.includes('.') || attr('acct') !== 'job-pilotto') continue;   // a site's host name: not 'sites' (the shared one) nor 'mac-sign'
    const note = attr('icmt'), stamp = (block.match(/"cdat"<timedate>=0x[0-9A-F]+\s+"(\d{14})Z/) || [])[1] || '';
    rows.push({host, ...(test ? {test: true, key} : {}), email: (note.match(/(?:^|\s)email=(\S+)/) || [])[1] || '', job: (note.match(/(?:^|\s)job=(\S+)/) || [])[1] || '',
      created: stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z` : ''});
  }
  return rows.sort((a, b) => b.created.localeCompare(a.created));
}

export function list(platform = process.platform, exec = execFileSync) {
  if (platform !== 'darwin' && !keychain.isolated()) return {ok: false, rows: [], error: 'Credentials are listed on a Mac only for now.'};
  const text = keychain.dump({exec, platform});
  return text === null ? {ok: false, rows: [], error: 'The Keychain could not be read.'} : {ok: true, rows: parseDump(text).map(row => withTestEmail(row, platform, exec))};
}

// A test account keeps its email in a sibling item (job-pilotto.test-account.<host>.email, the address as its value, no comment on the password item): shown on its row so a
// test account never reads "email not recorded" (owner, 16 Oct 2026). Test rows only; a real account's row is never given an address from anywhere but its own comment.
function withTestEmail(row, platform, exec) {
  if (!row.test || row.email) return row;
  let email = '';
  try { email = keychain.read(`job-pilotto.${row.key}.email`, {account: 'job-pilotto', exec, platform}) || ''; } catch { /* no email item: the row says so */ }
  return {...row, email};
}

// One site's password, when you ask for it. host comes from the list: only a plain host name is read.
export function reveal(host, platform = process.platform, exec = execFileSync) {
  if (!/^[a-z0-9.-]{1,253}$/i.test(String(host || ''))) return null;
  return keychain.read(`job-pilotto.${host}.password`, {account: 'job-pilotto', exec, platform});
}

// The owner's choice (8 Oct 2026): the extension fills a sign-in or sign-up page's password boxes from the Keychain, as a
// browser's password manager would, in a tab the app opened. Given only while an application is open, and only a site's own
// item (a plain host name with a dot). host: from Chrome's tab address, not from the page.
export function forExtension(host, {applying = false, read = reveal} = {}) {
  if (!applying || !/^[a-z0-9.-]{1,253}$/i.test(String(host || '')) || !String(host).includes('.') || String(host).startsWith(TEST_PREFIX)) return {ok: false};
  const password = read(host);
  return password ? {ok: true, password} : {ok: false};
}

// The email recorded on one site's password item (its comment "email=… job=…", set when an account was made for it), or '' (no item, or none recorded). Attributes only, never the secret.
export function emailOf(host, platform = process.platform, exec = execFileSync) {
  if (!/^[a-z0-9.-]{1,253}$/i.test(String(host || ''))) return '';
  const note = keychain.comment(`job-pilotto.${host}.password`, {account: 'job-pilotto', exec, platform});
  return (note.match(/(?:^|\s)email=(\S+)/) || [])[1] || '';
}

// Deletes one site's password item (Settings → Credentials → Delete). The account on the site stays; only this Mac forgets its password.
export function forget(host, platform = process.platform, exec = execFileSync) {
  if (!/^[a-z0-9.-]{1,253}$/i.test(String(host || '')) || !String(host).includes('.')) return false;
  return keychain.remove(`job-pilotto.${host}.password`, {account: 'job-pilotto', exec, platform});
}
