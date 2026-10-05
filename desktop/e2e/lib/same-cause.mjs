// One cause, several findings (5 Oct 2026: #275 "raw HTML 502 shown" came from the AI screenshot review, and #277 "raw technical text from the failed Notion call is shown"
// from the suite's own step, seconds apart in one run, one fix). A failed step of a suite and a screenshot or layout finding filed by the same run on the same suite are very
// likely the same defect seen twice. They are not merged (a step can fail for its own reason): the step's issue is linked to the earlier one and labelled, and the numbers count it
// as a duplicate, not as a second bug. Pure.
export const POSSIBLE_DUPLICATE = 'possible-duplicate';

// The same suite and run is not enough: #298 (Telegram refuses the digest) was linked to #295 (the Gmail check's Google sign-in) on that alone, two different defects. The two must
// also share at least two words that name the thing (Notion, HTML, Telegram, Google…), not the generic ones every finding uses.
const GENERIC = new Set('about after again also because before being check could does doing error errors failed failing from have here into just line lines more nothing other page pane people person says shown shows step still that their them then there these this those what when which while with without would your jobs run runs text found says same'.split(' '));
export const wordsOf = text => new Set((String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(word => !GENERIC.has(word)));
export const sharedWords = (a, b) => { const left = wordsOf(a), shared = []; for (const word of wordsOf(b)) if (left.has(word)) shared.push(word); return shared; };
export const NEEDED_WORDS = 2;

// created: [{number, source, suite, view, text}] the issues this run filed -> [{later, earlier, shared}]
export function sameCauseLinks(created = []) {
  const links = [];
  for (const item of created.filter(row => row.source === 'suite-failure' && row.suite)) {
    const earlier = created.find(row => row.number !== item.number && row.source !== 'suite-failure' && row.suite === item.suite && row.view !== item.view
      && (row.text === undefined || item.text === undefined || sharedWords(row.text, item.text).length >= NEEDED_WORDS));
    if (earlier) links.push({later: item.number, earlier: earlier.number});
  }
  return links;
}

export const sameCauseComment = (earlier, runUrl) => `Possibly the same cause as #${earlier}: the same run (${runUrl}) and the same suite also filed it from a screenshot or layout reading. This one is the suite's own step failing; if #${earlier} is fixed and this stays clean in the next run, it was one defect. Not merged automatically: a step can also fail for its own reason.`;
