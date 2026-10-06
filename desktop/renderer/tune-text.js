// The words of the Tune my strategy dialog, kept free of the DOM (like weekly-card.js) so the tests can check them.
const VERB = {drop_role: 'Stop searching for', drop_place: 'Stop searching in', exclude_title: 'Skip job titles with'};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A proposal's headline: what changes, in the user's words.
export const proposalTitle = item => `${VERB[item.kind] || 'Change'} “${item.label}”`;

// The line under it: the counts it rests on (the engine's own sentence when it sent no counts).
export const proposalCounts = item => (item.dismissed != null ? `${item.dismissed} dismissed · ${item.engaged || 0} kept or applied` : item.why || '');

// The header under the title: what the proposals were read from (a lead and its counts), or why there are none yet.
export function basisParts(answer) {
  const b = answer.basis || {};
  if (!b.jobs) return {lead: 'No results to learn from yet: save, dismiss or apply to some jobs first.', counts: ''};
  const counts = `${b.dismissed} dismissed · ${b.engaged} kept or applied · ${plural(b.interviews, 'interview')}`;
  const lead = `Based on ${plural(b.jobs, 'job')} you acted on.`;
  return answer.proposals?.length ? {lead, counts}
    : {lead: `${lead} Nothing to change: no role, place or title word has ${b.min_dismissed}+ dismissals and none kept.`, counts};
}

// The Apply button names how many ticked changes it writes.
export const applyLabel = ticked => (ticked ? `Apply ${plural(ticked, 'change')}` : 'Apply changes');
