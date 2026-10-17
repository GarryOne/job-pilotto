// "Join the Pro waitlist" (Settings → Plan): sends the address to the website's one waitlist (POST /api/waitlist, source "app") and remembers on this install that it joined.
// No payment and no marketing mail here; the owner e-mails once when Pro opens. Guard: test/pro-waitlist.test.js (a fake fetch, never the live site).
import {FREE_BASE} from './ai-free.js';
import {siteIsOff} from './recipes.js';

const SITE = FREE_BASE.replace(/\/api\/ai$/, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// -> {ok: true, email} or {ok: false, error}; saves {email, at} as settings.proWaitlist on success.
export async function joinProWaitlist(storage, email, {fetcher = globalThis.fetch, now = () => Date.now()} = {}) {
  const address = String(email || '').trim().toLowerCase();
  if (address.length > 254 || !EMAIL.test(address)) return {ok: false, error: 'Enter an email address like you@example.com.'};
  if (siteIsOff()) return {ok: false, error: 'The waitlist is not available in this build.'};
  try {
    const response = await fetcher(`${SITE}/api/waitlist`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: address, source: 'app'})});
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) return {ok: false, error: body.error || 'That did not work. Try again in a moment.'};
  } catch { return {ok: false, error: 'Could not reach Job Pilotto. Check your connection and try again.'}; }
  storage.saveSettings({proWaitlist: {email: address, at: now()}});
  return {ok: true, email: address};
}
