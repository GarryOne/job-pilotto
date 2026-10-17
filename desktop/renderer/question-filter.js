// Which open questions are worth showing, ONE rule for every list of them (owner, 17 Oct 2026: Jobs → Answer once held the same junk as Profile → Needs review):
// a question shows only when it has a readable label, the AI judged it reusable across jobs (lib/question-verdicts.js keeps that verdict per question), and the
// standard answers do not already cover it (then it shows with the proposed answer to accept). Nothing is deleted: the rest is "hidden" behind a link.
// Pure (no DOM, no AI); guarded by test/question-filter.test.js.
export const keyOf = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A form field's own id where no label was readable ("text-3219", "tel-3519", "question_12"): one token with a digit, no spaces. By shape, no words.
export const looksLikeFieldId = text => {
  const label = String(text || '').replace(/^[\s*]+|[\s*]+$/g, '');
  return !label || (!/\s/.test(label) && /\d/.test(label) && /^[\w.:[\]-]+$/.test(label));
};

// verdicts: {[keyOf(question)]: {reuse: 'reusable' | 'one_job' | 'consent', covered_by: '' | an answered question, proposal: its answer, asked: how many forms}}.
// rows: anything with .question. → {shown: rows (covered ones carry .proposal; most-asked first), hidden: rows}.
export function visibleQuestions(rows, verdicts = {}) {
  const shown = [], hidden = [];
  for (const row of rows) {
    const verdict = verdicts[keyOf(row.question)];
    if (looksLikeFieldId(row.question) || (verdict && verdict.reuse !== 'reusable')) hidden.push(row);
    else shown.push(verdict?.covered_by && verdict.proposal ? {...row, proposal: verdict.proposal, coveredBy: verdict.covered_by} : row);
  }
  shown.sort((a, b) => (verdicts[keyOf(b.question)]?.asked || 0) - (verdicts[keyOf(a.question)]?.asked || 0));
  return {shown, hidden};
}
