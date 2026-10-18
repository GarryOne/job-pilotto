// Ready to send's "Open in my browser" (spec docs/superpowers/specs/2026-10-17-ready-to-send.md, PR 5b; owner 18 Oct 2026: carry the cookies, the normal fill takes over):
// the hand-off the night's server gave for one job (page address, its browser storage, a snapshot of the filled fields) waits here until the
// extension, in the tab the app opened for that job, asks for it once. Only that page's own site's cookies leave this module: the night's browser
// also holds other sites' cookies. Pure apart from the pending map. Guard: test/ready-handoff.test.js.

const WAIT_MS = 10 * 60 * 1000;   // a hand-off nobody asked for in 10 minutes is dropped (the tab never opened)
const pending = new Map();        // key -> {handoff, keys, at}

// A page's identity for matching: its origin and path, no #mark, no query, no trailing slash.
export function pageKey(url) {
  try { const at = new URL(String(url || '')); return `${at.origin}${at.pathname.replace(/\/+$/, '')}`; } catch { return ''; }
}

// The site a cookie belongs to, as the last two labels of its host (enough for the hosts job forms live on: boards.greenhouse.io and
// job-boards.greenhouse.io share greenhouse.io). A cookie for another site never goes with this page.
const siteOf = host => String(host || '').replace(/^\./, '').toLowerCase().split('.').slice(-2).join('.');

// Playwright's storageState cookies -> what chrome.cookies.set takes, for this page's site only.
export function cookiesFor(pageUrl, cookies = []) {
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { return []; }
  const site = siteOf(host);
  return cookies.filter(cookie => cookie?.name && siteOf(cookie.domain) === site).map(cookie => {
    const domain = String(cookie.domain || host);
    const set = {url: `${cookie.secure === false ? 'http' : 'https'}://${domain.replace(/^\./, '')}${cookie.path || '/'}`, name: String(cookie.name), value: String(cookie.value ?? ''),
      path: cookie.path || '/', secure: cookie.secure !== false, httpOnly: !!cookie.httpOnly};
    if (domain.startsWith('.')) set.domain = domain;   // a host-only cookie stays host-only
    if (['Strict', 'Lax', 'None'].includes(cookie.sameSite)) set.sameSite = {Strict: 'strict', Lax: 'lax', None: 'no_restriction'}[cookie.sameSite];
    if (Number(cookie.expires) > 0) set.expirationDate = Number(cookie.expires);
    return set;
  });
}

// What the extension gets: the page to load, its cookies, its own origin's storage, and the snapshot (never a password: the server never takes one).
export function forExtension(handoff) {
  const url = String(handoff?.url || '');
  let origin = '';
  try { origin = new URL(url).origin; } catch { return null; }
  const local = (handoff.storage?.origins || []).find(each => each.origin === origin)?.localStorage || [];
  return {url, cookies: cookiesFor(url, handoff.storage?.cookies), localStorage: Object.fromEntries(local.map(item => [item.name, item.value])),
    sessionStorage: handoff.sessionStorage || {}, snapshot: {fields: handoff.snapshot?.fields || [], files: handoff.snapshot?.files || []}};
}

// Kept under every address the tab may first show: the job's link, its form address and the page the night ended on.
export function keep(handoff, addresses, now = Date.now()) {
  const ready = forExtension(handoff);
  if (!ready) return false;
  const keys = [...new Set([...addresses, ready.url].map(pageKey).filter(Boolean))];
  const entry = {handoff: ready, keys, at: now};
  for (const key of keys) pending.set(key, entry);
  return true;
}

// The extension's ask for the tab at `url`: the hand-off once (then it is gone under every key), or null.
export function take(url, now = Date.now()) {
  const entry = pending.get(pageKey(url));
  if (!entry) return null;
  for (const key of entry.keys) pending.delete(key);
  return now - entry.at > WAIT_MS ? null : entry.handoff;
}

export const clear = () => pending.clear();   // tests
