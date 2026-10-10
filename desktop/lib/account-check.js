// The Gmail check for a site account that awaits its confirmation mail (owner, 10 Oct 2026: "after the signup it should automatically trigger the Gmail check").
// Runs lib/account-confirm.js at most once at a time per site, once more whenever a pending account's sign-in page is met, and tells the session when only the person
// can finish it (a code in the mail, or no mail), so the card says why the page sits untouched. Guard: test/account-check.test.js.
import {log as appLog} from './log.js';

const NEEDS = {code: 'Enter the code from your confirmation email', none: 'Confirm your email (no confirmation mail found yet)'};

export function createAccountCheck({confirm, noteStuck, now = Date.now, gapMs = 120000, log = appLog}) {
  const running = new Set(), last = new Map();
  // -> 'confirmed' | 'code' | 'none' | 'busy' | 'recent' | 'error'. force: a press just made the account, so no gap applies.
  return async function check({host, email, session, force = false, ...rest}) {
    const key = `${String(host || '').toLowerCase()}|${String(email || '').toLowerCase()}`;
    if (running.has(key)) return 'busy';
    if (!force && now() - (last.get(key) || -Infinity) < gapMs) return 'recent';
    running.add(key); last.set(key, now());
    try {
      const outcome = await confirm({host, email, ...rest});
      if (NEEDS[outcome] && session) noteStuck(session, 'account', host, NEEDS[outcome]);
      return outcome;
    } catch (error) {
      log('extension', `account check failed: ${String(error?.message || error).slice(0, 80)}`, {host: String(host || '').slice(0, 120)});
      return 'error';
    } finally { running.delete(key); }
  };
}
