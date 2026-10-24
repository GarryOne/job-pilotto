// The one promise every Pro offer repeats, in one place (owner, 24 Oct 2026: "emphasize that it's not subscription based, but one time payment"): never "lifetime".
export const PROMISE = 'One-time payment, no subscription';
export const promise = () => PROMISE.toLowerCase();   // mid-sentence: "Pro is a one-time payment, no subscription"
// The green badge by the price (components: .ui-pill tone-good), as plain data for the renderers and the test.
export const BADGE = `✓ ${PROMISE}`;
