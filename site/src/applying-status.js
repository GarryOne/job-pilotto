// One status per pool row or run, from one function (owner, 14 Oct 2026: a hold is not "not working"): works, held on purpose, site problem, needs a fix, or not run.
// Every view of a row (the pool table's Result, Rung and dots, the By-hand-runs bars, the tiles, the Fixed tab's run marks) reads this, never the step reached alone.
// Guard: test/applying-status.test.js.

export const STATES = ['works', 'held', 'site', 'fix', 'unrun'];
export const STATE_WORD = {works: 'Works', held: 'Held on purpose', site: 'Site problem', fix: 'Needs a fix', unrun: 'Not run yet'};
// The notes the runner writes on purpose (desktop/e2e/lib/smoke.mjs parseLive): each is a rule the site or the posting set, never a fix.
const HOLDS = [[/^account-first: held/, 'account-first'], [/^eligibility stop:/, 'eligibility'], [/^login wall: held/, 'login wall'], [/^applies by email: told/, 'applies by email'], [/^page tells how to apply: told/, 'page tells how']];
const SITE_REFUSED = /^site refused: retry later/;
const EARLY = ['none', 'posting', 'account'];

// A hold that verifies a fix on the Fixed tab (owner, 14 Oct 2026): every hold is the accepted end of a run except the eligibility stop, which is about the posting against the profile and says
// nothing about the site (7e38ed8, 11 Oct 2026: counted as clean, it made Ashby "Regressed": a stop before any field read as a clean run).
export const isCleanHold = status => status.state === 'held' && status.rule !== 'eligibility';

// A documented hold: the run stopped here on purpose. A site that refused us (retry later) is a site problem (the notes of one hold list are the notes of one status), never a fix.
export const isHold = note => SITE_REFUSED.test(note || '') || HOLDS.some(([pattern]) => pattern.test(note || ''));

// run: {reached, note, regression, short}. -> {state, rule}: rule says which hold or which site problem (a few words), '' when there is none.
export function rowStatus(run) {
  const note = run.note || '';
  const hold = HOLDS.find(([pattern]) => pattern.test(note));
  if (hold) return {state: 'held', rule: hold[1]};
  if (SITE_REFUSED.test(note)) return {state: 'site', rule: 'site refused'};
  if (note) return {state: 'site', rule: 'posting gone'};   // any other note: a posting gone, or no posting
  if (!run.reached) return {state: 'unrun', rule: ''};
  if (run.reached === 'code/bot') return {state: 'held', rule: 'code or bot check'};
  if (run.regression || run.short || EARLY.includes(run.reached)) return {state: 'fix', rule: ''};
  return {state: 'works', rule: ''};
}
