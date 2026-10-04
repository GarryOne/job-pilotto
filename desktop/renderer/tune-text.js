// The words of the Tune my strategy dialog, kept free of the DOM (like weekly-card.js) so the tests can check them.
const VERB = {drop_role: 'Stop searching for', drop_place: 'Stop searching in', exclude_title: 'Skip job titles with'};

// A proposal's headline: what changes, in the user's words.
export const proposalTitle = item => `${VERB[item.kind] || 'Change'} “${item.label}”`;

// The line under the title: what the proposals were read from, or why there are none yet.
export function basisLine(answer) {
  const b = answer.basis || {};
  if (!b.jobs) return 'No results to learn from yet: save, dismiss or apply to some jobs first.';
  const read = `Read from ${b.jobs} job${b.jobs === 1 ? '' : 's'} you acted on: ${b.dismissed} dismissed, ${b.engaged} kept or applied, ${b.interviews} interview${b.interviews === 1 ? '' : 's'}.`;
  return answer.proposals?.length ? read : `${read} Nothing to change: no role, place or title word has ${b.min_dismissed}+ dismissals and none kept.`;
}
