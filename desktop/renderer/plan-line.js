// The one honest line about Pro on the free-allowance screen (Settings → License), while Pro is off (owner, 16 Oct 2026): what the free trial is and what comes after,
// no button, no banner, no pop-up. The ONE place that decides it: when the Pro plan is on (state.proMode 'test' or 'live', set by the plan reader of the Pro build),
// the line goes and the real plan block takes its place. A key holder (founder, friend) is never told about a price. Guard: test/plan-line.test.js.
export const PRO_PRICE = '$29';   // the full price; the launch price and the real figures come from the site when Pro is on

export function planLine(state = {}) {
  if (state.licensed || ['test', 'live'].includes(state.proMode)) return null;
  return `Free trial: ${state.limit || 20} applications or 60 days. Then Pro: ${PRO_PRICE} one-time, no subscription (coming soon).`;
}
