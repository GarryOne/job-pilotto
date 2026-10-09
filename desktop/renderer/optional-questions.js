// Which optional questions the session page's "Optional questions" card lists (pages/session-optional.js): the form's optional fields still empty,
// as the panel reports them (extension/review.js `optional`, never a consent). Pure, so test/session-optional.test.js runs it without a window.
// None on a closed tab or an account page; none already listed in "Needs your attention".
export function optionalLabels(state, {gone = false, listed = []} = {}) {
  if (gone || !state || state.account) return [];
  return [...new Set(state.optional || [])].filter(label => label && !listed.includes(label));
}
