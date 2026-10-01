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

// What an armed tab is showing, from counts only. A password field is an account page: Claude signs in or
// creates the account, and the extension never types it. Several fields, a textarea or a file input is the
// application form. Anything smaller is a page Claude still has to click through (Apply, Next).
export function pageRole({fields = 0, passwords = 0, files = 0, textareas = 0} = {}) {
  if ((Number(passwords) || 0) > 0) return 'account';
  if ((Number(files) || 0) > 0 || (Number(textareas) || 0) > 0 || (Number(fields) || 0) >= 3) return 'form';
  return 'no-form';
}

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

// How long to watch after a submit press. A redirect can be the confirmation, and so can the same page
// once its content changes. After this, an unchanged form is not a submission.
export const SUBMIT_WAIT_MS = 20 * 1000;
// A confirmation page that comes later than that (a slow submit, a CAPTCHA) after a press is still read, up to this long after it.
export const LATE_CONFIRMATION_MS = 3 * 60 * 1000;
// A loading line ("Submitting…") is not the outcome. The page must sit still for this long, or the wait must end.
export const SUBMIT_SETTLE_MS = 2 * 1000;

// A short hash of what the page is showing. The text itself is not kept.
export function pageFingerprint({title, headings, text, inputs} = {}) {
  const body = [title || '', ...(headings || []), String(inputs ?? ''), String(text || '').slice(0, 800)].join('\n');
  let hash = 2166136261;
  for (let i = 0; i < body.length; i++) hash = Math.imul(hash ^ body.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

// Whether to ask the AI. A submit press, then either a new address or different content. The path is not evidence,
// and a redirect is not required: a confirmation message on the same page counts once the content has changed.
export function submissionOutcome({at, now = Date.now(), from, to, before, after, stableFor = 0} = {}) {
  let host = '';
  let path = '';
  try {
    const url = new URL(String(to || from || ''));
    host = url.hostname;
    path = url.pathname.replace(/\/+$/, '').slice(-80);
  } catch { /* not a url */ }
  if (!at) return {ask: false, why: 'no submit', host, path};
  if (now - at > SUBMIT_WAIT_MS || now < at) return {ask: false, why: 'submit too old', host, path};
  const redirected = !!(from && to && !samePage(from, to));
  const edited = !!(before && after && before !== after);
  if (!redirected && !edited) return {ask: false, why: now - at >= SUBMIT_WAIT_MS ? 'unchanged' : 'waiting', host, path};
  if (stableFor < SUBMIT_SETTLE_MS && now - at < SUBMIT_WAIT_MS) return {ask: false, why: 'waiting', host, path};
  return {ask: true, why: redirected ? 'redirect' : 'content', host, path};
}

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
  // An embedded Greenhouse form: …/embed/job_app/confirmation?for=<board>&token=<job id>.
  try { if (confirmationOf(current) && [...new URL(String(current)).searchParams.values()].includes(id)) return true; } catch { /* not a url */ }
  try {
    return new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(confirmation|thanks)`).test(String(current));
  } catch {
    return false;
  }
}
