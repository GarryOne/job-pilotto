// Which tab may the extension touch, and with which page? Chrome reuses a tab id after its tab closes, and the
// extension keeps per-tab state (`from:<id>`, `job:<id>`) in session storage, so an id that comes back showing
// something else must never inherit that work: on 1 Oct 2026 a fill's "Claude is answering 1 more question…" box
// was painted onto a Google search page, and the submitted-check would read the text of any other host.
//
// Kept free of chrome.* so the decisions can be tested (like report-alarm.js): the callers pass URLs.

export const pageKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');

// The panel and the fill run only on a tab the desktop app opened (#jobpilotto-fill) or has already armed.
// A page the user is just browsing, Calendly included, is not one of those.
export const tabArmed = ({url, armed} = {}) => !!armed || String(url || '').includes('#jobpilotto-fill');

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

// A Greenhouse /confirmation or Lever /thanks page, as host + job id + path. Null for anything else,
// including a form page and a page whose text merely says "thank you". Query strings are dropped.
export function confirmationOf(url) {
  try {
    const parsed = new URL(String(url));
    const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const path = parts.at(-1) || '';
    if (path !== 'confirmation' && path !== 'thanks') return null;
    return {host: parsed.hostname, id: parts.at(-2) || '', path};
  } catch {
    return null;
  }
}

// Why a confirmation page was not marked, or null when this tab's stored job owns it (the mark path
// logs that itself). The silent return here is what left the 1 Oct 2026 Anthropic confirmation with
// no [extension] line: the tab's saved job was gone, so nothing was written.
export function missedConfirmation({url, job} = {}) {
  const page = confirmationOf(url);
  if (!page) return null;
  if (!job) return {text: 'confirmation page, no job stored on this tab: not marked', fields: page};
  if (!forJob(url, job)) {
    let stored = '';
    try { stored = new URL(String(job)).pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1) || ''; } catch { stored = ''; }
    return {text: 'confirmation page is not the job stored on this tab: not marked', fields: {...page, stored}};
  }
  return null;
}

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
