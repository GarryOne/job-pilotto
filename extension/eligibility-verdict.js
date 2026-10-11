// The AI's own eligibility verdict on a fill, and why a "not eligible" did not stop it, for the fill's log line (background.js "filled the form"). Before
// (11 Oct 2026) the line said only {ineligible:false}, the outcome after a kit had skipped the stop, and it was read as "the AI judged eligible".
// Guard: desktop/test/eligibility-verdict.test.js.

// ai: the fill's AI answer ({eligible}) or null; askedAnyway: the person pressed "Fill anyway"; kit: a drafted kit decided (kitStance: withKit or
// skipEligibility); checkOff: Settings -> "Check eligibility before filling" is off.
// -> {aiEligible: true | false | null (no verdict), forced: 'fill anyway' | 'kit' | 'check off' | '' (only when the AI said not eligible and the fill went on)}
export function verdictFields({ai = null, askedAnyway = false, kit = false, checkOff = false} = {}) {
  const aiEligible = typeof ai?.eligible === 'boolean' ? ai.eligible : null;
  const forced = aiEligible !== false ? '' : askedAnyway ? 'fill anyway' : kit ? 'kit' : checkOff ? 'check off' : '';
  return {aiEligible, forced};
}
