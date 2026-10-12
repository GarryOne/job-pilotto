// The fixed endings of an application (the outcome contract, owner 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a). Every application ends in exactly one;
// every dead end and every "the person is needed" answer names one; the resolution score counts them. Pure (no chrome API, no storage), so the extension, the app, the test harness
// and the site read the same list: import it, never copy the words. Guard: worker/test/endings.test.js.
//   ready        the form is reached; everything left is the person's choice or a proposal
//   told         the page says how to apply another way (email, phone, in person) or that the job is closed: quoted from the page
//   handed       a bot check, a sign-in, an SMS or emailed code: names exactly what the person must do, and resumes by itself after
//   blind        a control or page the AI could not see (recorded as data: the queue for perception fixes)
//   data_missing an answer the person must give once (asked once, can be remembered)
//   site_broken  the page could not be read, errors, a posting gone: retried, then told plainly
//   unresolved   anything else: a stop with no reason, a field we missed, a loop: a counted bug
export const ENDINGS = ['ready', 'told', 'handed', 'blind', 'data_missing', 'site_broken', 'unresolved'];
export const UNRESOLVED = 'unresolved';
export const isEnding = value => ENDINGS.includes(value);
// The resolution score's numerator: every ending but 'unresolved' (the person knows exactly what is left, or the site is out of our hands).
export const resolved = value => isEnding(value) && value !== UNRESOLVED;

// The ending each "can't reach" reason names (extension/fill-flow.js and account-step.js stuck(); the app reads the same reasons: desktop/lib/session-flow.js). A wall is 'handed'
// only when the run names exactly what the person must do (needs: a bot check, the account step's need); with no named need it is a stop with no reason. Guard: worker/test/endings.test.js
// fails when the extension sends a reason that is not here.
export const STUCK_REASONS = ['email', 'told', 'other', 'account', 'no-form', 'incomplete', 'site_broken'];
export function endingOfStuck(why, needs = '') {
  if (why === 'email' || why === 'told') return 'told';
  if (why === 'site_broken') return 'site_broken';   // an error page or one that could not be read, loaded again first (ladder/site-broken.js)
  if (why === 'account' || why === 'no-form') return String(needs || '').trim() ? 'handed' : UNRESOLVED;
  return UNRESOLVED;   // other (the ladder ended with nothing to say), incomplete (nothing filled, required fields left), anything not listed
}
