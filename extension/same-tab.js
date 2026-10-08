// Apply in the same tab: a tab opened by a page right after the extension pressed its Apply button is that page's next step,
// so it is loaded in the posting's own tab and the new tab is closed (owner, 8 Oct 2026: Manor's Apply opened the sign-in in a
// second tab, and the app lost track of which tab was the application). Only then: a tab the user opens, or one a page opens
// later (a sign-in pop-up, a PDF), is left alone.
export const FOLD_MS = 10 * 1000;
// May `tab` (just created) be folded into its opener? `pressedAt`: when the extension pressed Apply in each tab (id → ms).
export function foldInto(tab, pressedAt, now = Date.now()) {
  const opener = tab?.openerTabId;
  if (opener == null || !pressedAt.has(opener)) return null;
  return now - pressedAt.get(opener) <= FOLD_MS ? opener : null;
}
// The address to load in the opener: a web page only (not about:blank while the new tab is still being set up, not a
// download or a chrome:// page).
export const foldableUrl = url => /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
