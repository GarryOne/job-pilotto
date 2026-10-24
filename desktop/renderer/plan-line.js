// The one honest line about Pro on the free-allowance screen (Settings → Plan), while Pro is off (owner, 16 Oct 2026): what the free trial is and what comes after,
// no button, no banner, no pop-up. The ONE place that decides it: when the Pro plan is on (state.proMode 'test' or 'live', set by the plan reader of the Pro build),
// the line goes and the real plan block takes its place. A key holder (founder, friend, from before the keys were retired) is never told about a price. Guard: test/plan-line.test.js.
import {promise} from './pro-promise.js';
export const PRO_PRICE = '€9';   // the lowest Pro price (Pro €9, Pro + AI €19); the real figures come from the site when Pro is on

export function planLine(state = {}) {
  if (state.licensed || ['test', 'live'].includes(state.proMode)) return null;
  return `Then Pro from ${PRO_PRICE}: ${promise()} (coming soon).`;
}

// The trial-wall dialog's lead (its heading already says the trial is over): the same plan line, without "Then". With Pro on, the Plan page holds the offer.
export function endedLine(state = {}) {
  if (['test', 'live'].includes(state.proMode)) return 'Upgrade to Pro in Settings → Plan.';
  return `Pro from ${PRO_PRICE}: ${promise()} (coming soon).`;
}

// The Pro card with the waitlist button shows while Pro is off (same gate as planLine); with Pro on the real plan block takes its place.
export const showsProWaitlist = state => planLine(state) !== null;
// The ONE switch for payments (owner, 17 Oct 2026: "on the first 1-2 users we'll enable the Stripe payment"): false = the Pro button joins the waitlist; the checkout comes later.
export const PRO_CHECKOUT = false;
