// Which open questions are worth showing, ONE rule for every list of them (owner, 17 Oct 2026: Jobs → Answer once held the same junk as Profile → Needs review):
// a question shows only when it has a readable label, the AI judged it reusable across jobs (lib/question-verdicts.js keeps that verdict per question), and the
// standard answers do not already cover it (then it shows with the proposed answer to accept). Nothing is deleted: the rest is "hidden" behind a link.
// Pure (no DOM, no AI); guarded by test/question-filter.test.js.
export const keyOf = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The queue items that come from Your details (lib/details-review.js), not from a form: the Profile banner adds them to its own count of the answers page.
export const detailsIn = list => (list || []).filter(row => row?.details);
// The answer "Keep as is" on an answer the AI found unclear (lib/details-review.js): never asked again for that value.
export const KEEP_AS_IS = 'Keep as is';

// A form field's own id where no label was readable ("text-3219", "tel-3519", "question_12"): one token with a digit, no spaces. By shape, no words.
export const looksLikeFieldId = text => {
  const label = String(text || '').replace(/^[\s*]+|[\s*]+$/g, '');
  return !label || (!/\s/.test(label) && /\d/.test(label) && /^[\w.:[\]-]+$/.test(label));
};

// A question that means a fact of Your details ({reuse: 'details', fact}) is answered from there and never shown (owner, 17 Oct 2026): it is counted apart (fromDetails),
// not "hidden". Same-topic wordings (any language) are ONE item: the first carries the others in .also, and answering it answers them all.
// verdicts: {[keyOf(question)]: {reuse: 'reusable' | 'one_job' | 'consent' | 'details', covered_by: '' | an answered question, proposal: its answer, asked: how many forms}}.
// rows: anything with .question. → {shown: rows (covered ones carry .proposal; most-asked first), hidden: rows}.
export function visibleQuestions(rows, verdicts = {}) {
  const shown = [], hidden = [], fromDetails = [];
  for (const row of rows) {
    const verdict = verdicts[keyOf(row.question)];
    if (verdict?.reuse === 'details' && !looksLikeFieldId(row.question)) fromDetails.push(row);
    else if (looksLikeFieldId(row.question) || (verdict && verdict.reuse !== 'reusable')) hidden.push(row);
    else shown.push(verdict?.covered_by && verdict.proposal ? {...row, proposal: verdict.proposal, coveredBy: verdict.covered_by} : row);
  }
  // value first: a question that blocked a fill, then the most asked
  const weight = row => { const v = verdicts[keyOf(row.question)] || {}; return (v.blocked ? 1e6 : 0) + (v.asked || 0); };
  shown.sort((a, b) => weight(b) - weight(a));
  const byTopic = new Map(), one = [];
  for (const row of shown) {
    const topic = (verdicts[keyOf(row.question)] || {}).topic;
    const first = topic && byTopic.get(topic);
    if (first) first.also = [...(first.also || []), row];
    else { const copy = {...row}; one.push(copy); if (topic) byTopic.set(topic, copy); }
  }
  return {shown: one, hidden, fromDetails};
}
