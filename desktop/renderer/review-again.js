// Interviews → a reviewed row's ⋯ "Review again": its menu entry (busy while it runs) and the message after it.
// The same review as the first one (window.pilot.interviews.review), re-run on the transcript saved in Notion: it
// replaces the review and fills only the job's empty fields (src/ai/interviews.py review_again). One AI call, so the
// menu press is the ask; it never runs by itself.
export const LABEL = 'Review again · updates the job (about $0.08)';
export const BUSY = 'Reviewing again…';
export const TITLE = 'Claude reviews the saved transcript again (one call, about $0.03-0.08): the review is replaced and the '
  + "call's facts (salary, contract, visa…) fill the job's empty fields. Stage and filled fields are left as they are.";

// The menu entry for a row, or null (not reviewed yet: the row's own Review button does it).
export function againItem(row, busy, run) {
  if (!row?.overall) return null;
  return busy ? {label: BUSY, title: 'Claude is reviewing this interview again', run: () => {}} : {label: LABEL, title: TITLE, run};
}

export const START = 'Claude is reviewing the interview again (about a minute)…';

// [text, tone] for the page's message line after the call returns.
export function doneMessage(result) {
  if (!result?.ok) return [`Review again failed: ${result?.error || 'no answer'}. The job was not changed.`, 'error'];
  if (result.cloud) return ['Reviewing again on GitHub: the new review replaces the old one on the Notion page in a few minutes.', 'ok'];
  return [`${result.summary}. The review on the Notion page was replaced.`, 'ok'];
}
