// Which tab may the extension touch, and with which page? Chrome reuses a tab id after its tab closes, and the
// extension keeps per-tab state (`from:<id>`, `job:<id>`) in session storage, so an id that comes back showing
// something else must never inherit that work: on 1 Oct 2026 a fill's "Claude is answering 1 more question…" box
// was painted onto a Google search page, and the submitted-check would read the text of any other host.
//
// Kept free of chrome.* so the decisions can be tested (like report-alarm.js): the callers pass URLs.

export const pageKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');

// The URL's origin, or '' when it isn't a URL.
export function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return '';
  }
}

// The same page, ignoring the fill marker (#jobpilotto-fill) and a trailing slash.
export const samePage = (a, b) => !!a && !!b && pageKey(a) === pageKey(b);

// The same site: what a fill may keep painting on while a form moves between its own steps (the ATS redirects
// /apply to /apply/step2), but never another site.
export const sameSite = (a, b) => !!originOf(a) && originOf(a) === originOf(b);

// This job's own page, or the confirmation page a site shows after submitting it (Greenhouse …/<job id>/confirmation,
// Lever …/<job id>/thanks): the two places an email-side "you submitted" signal is expected from.
export function forJob(current, job) {
  if (!current || !job) return false;
  if (samePage(current, job)) return true;
  const id = String(job).replace(/\/+$/, '').split('/').pop();
  if (!id) return false;
  try {
    return new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(confirmation|thanks)`).test(String(current));
  } catch {
    return false;
  }
}
