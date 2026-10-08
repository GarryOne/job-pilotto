// One tab per application (owner, 8 Oct 2026: Manor's Apply opened the sign-in in a second tab, and the app lost track of which
// tab was the application). Before the extension presses Apply, a link or form aimed at a new tab is aimed at this one, so the
// browser goes there itself (a form keeps its posted data, the page loads once). A tab the page still opens by script right
// after the press is followed as the application and the posting's tab closes; nothing is loaded twice. A tab the user opens,
// or one a page opens later (a sign-in pop-up, a PDF), is left alone.
export const FOLD_MS = 10 * 1000;
// The posting tab to close for `tab` (just created), or null. `pressed`: tab id → {at, url}, when and where the extension pressed
// Apply. `postingUrl`: what that tab shows now: once it moved on (a link was pointed at it), it is the application, never closed.
export function postingToClose(tab, pressed, postingUrl, now = Date.now(), key = url => String(url || '').split('#')[0]) {
  const opener = tab?.openerTabId;
  const press = opener == null ? null : pressed.get(opener);
  if (!press || now - press.at > FOLD_MS) return null;
  return key(postingUrl) === key(press.url) ? opener : null;
}
