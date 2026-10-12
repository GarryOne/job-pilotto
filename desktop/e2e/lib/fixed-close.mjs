// A Finder issue closed by a fix: "Fixes #N" in a commit or a merged pull request closes it as completed with no verdict, so the stats never counted it
// as a real bug (12 Oct 2026: #360 and #400). The labels a verdict would have set. Pure; fixed-close.mjs (issue-fixed.yml) applies them. Guarded by test/fixed-close.test.mjs.

// {labels: [names], stateReason: 'COMPLETED' | 'NOT_PLANNED' | …, closer: the ClosedEvent's closer (a Commit or a PullRequest) or null}
// -> {add: [labels], comment} or null (not a Finder issue, not closed by a fix, or a verdict already said why).
export function labelsForClose({labels = [], stateReason = '', closer = null} = {}) {
  if (!labels.includes('auto-ui') || stateReason !== 'COMPLETED') return null;
  if (labels.some(name => name.startsWith('resolution:'))) return null;   // apply-verdict.sh labels before it closes
  const fix = closer?.__typename === 'Commit' ? `commit ${String(closer.oid || '').slice(0, 7)}`
    : closer?.__typename === 'PullRequest' && closer.merged ? `pull request #${closer.number}` : '';
  if (!fix) return null;
  return {add: [...(labels.includes('confirmed') ? [] : ['confirmed']), 'resolution:fixed'],
    comment: `✅ Closed by a fix (${fix}${closer.url ? `: ${closer.url}` : ''}), so it counts as a real bug, fixed. A wrong call? Reopen it and give it a verdict (desktop/e2e/apply-verdict.sh).`};
}
