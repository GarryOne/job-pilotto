// One cause, several findings (5 Oct 2026: #275 "raw HTML 502 shown" came from the AI screenshot review, and #277 "raw technical text from the failed Notion call is shown"
// from the suite's own step, seconds apart in one run, one fix). A failed step of a suite and a screenshot or layout finding filed by the same run on the same suite are very
// likely the same defect seen twice. They are not merged (a step can fail for its own reason): the step's issue is linked to the earlier one and labelled, and the numbers count it
// as a duplicate, not as a second bug. Pure.
export const POSSIBLE_DUPLICATE = 'possible-duplicate';

// created: [{number, source, suite, view}] the issues this run filed -> [{later, earlier}]
export function sameCauseLinks(created = []) {
  const links = [];
  for (const item of created.filter(row => row.source === 'suite-failure' && row.suite)) {
    const earlier = created.find(row => row.number !== item.number && row.source !== 'suite-failure' && row.suite === item.suite && row.view !== item.view);
    if (earlier) links.push({later: item.number, earlier: earlier.number});
  }
  return links;
}

export const sameCauseComment = (earlier, runUrl) => `Possibly the same cause as #${earlier}: the same run (${runUrl}) and the same suite also filed it from a screenshot or layout reading. This one is the suite's own step failing; if #${earlier} is fixed and this stays clean in the next run, it was one defect. Not merged automatically: a step can also fail for its own reason.`;
